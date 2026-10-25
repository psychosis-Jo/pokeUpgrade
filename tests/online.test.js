const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const { LocalStore } = require('../server/store');
const { Rooms } = require('../server/rooms');
const G = require('../server/round');
const R = require('../minigame/rules');
const { sign, verify, guestCredential, restoreGuest } = require('../server/auth');
const { createServer } = require('../server');
const uid = i => crypto.createHash('sha256').update(String(i)).digest('hex');
const secret = 'integration-test-secret-at-least-32-characters';
const rng = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

test('房主电脑补齐、移除与真人房主转交，不为电脑创建档案', async () => {
  const store = new LocalStore(); await store.init();
  const rooms = new Rooms(store); let r = await rooms.create(uid(0));
  r = await rooms.join(uid(1), r.code);
  const act = (who, type, value) => rooms.change(r.code, who, { id: crypto.randomUUID(), version: r.version, type, value });
  await assert.rejects(act(uid(1), 'fill-bots'), /房主/);
  r = await act(uid(0), 'fill-bots');
  assert.equal(r.members.filter(p => p.bot).length, 2);
  assert.ok(r.members.filter(p => p.bot).every(p => p.ready));
  assert.equal(rooms.view(r, uid(0)).members[2].bot, true);
  const bot = r.members[2].uid;
  r = await act(uid(0), 'kick', bot);
  r = await rooms.join(uid(2), r.code);
  assert.equal(r.members[2].uid, uid(2));
  assert.ok(r.members[3].ready);
  r = await act(uid(0), 'leave');
  assert.equal(r.host, uid(1));
  r = await act(uid(1), 'leave');
  r = await act(uid(2), 'leave');
  assert.equal(r.closed, true);
  assert.equal(Object.keys(store.data.profiles).length, 3);
});

test('一真人三电脑完整对局：快速合法出牌、分数守恒、真人结算幂等', async () => {
  const store = new LocalStore(); await store.init(); let clock = 1000;
  const rooms = new Rooms(store, { now: () => clock, random: rng(19) });
  let r = await rooms.create(uid(0));
  const act = async (type, value) => { r = await rooms.change(r.code, uid(0), { id: crypto.randomUUID(), version: r.version, type, value }); };
  await act('fill-bots'); await act('ready', true); await act('start');
  await assert.rejects(act('fill-bots'), /当前|牌局/);
  for (let step = 0; step < 2500 && !r.game.result; step++) {
    const s = r.game;
    if (s.phase === 'bury' && s.dealer === 0) await act('bury', s.hands[0].slice(0, 8).map(c => c.id));
    else if (s.phase === 'playing' && s.turn === 0) await act('play', R.suggest(s.hands[0], s.trick[0]?.cards || [], s).map(c => c.id));
    else { clock += 250; r = await rooms.tick(r.code); }
  }
  assert.ok(r.game.result);
  assert.ok(clock < 400000, '电脑不应等待真人30秒出牌时限');
  assert.equal(r.game.teamScores.reduce((a, b) => a + b) + R.points(r.game.bottom), 200);
  assert.equal(Object.keys(store.data.profiles).length, 1);
  assert.ok(r.members.filter(p => p.bot).every(p => p.level === '2' && p.badges === 0));
  const profile = structuredClone(store.data.profiles[uid(0)]);
  clock = r.game.deadline; r = await rooms.tick(r.code);
  assert.deepEqual(store.data.profiles[uid(0)], profile);
  await act('ready', true); await act('start');
  assert.equal(r.game.phase, 'dealing');
});

async function setup(store = new LocalStore(), options = {}) {
  await store.init(); let clock = 100000, n = 0;
  const rooms = new Rooms(store, { owner: 'test', now: () => clock, random: rng(4), ...options });
  let r = await rooms.create(uid(0));
  for (let i = 1; i < 4; i++) r = await rooms.join(uid(i), r.code);
  const get = () => store.transaction(tx => tx.get('rooms', r.code));
  const act = async (i, type, value, extra = {}) => {
    const current = await get();
    return rooms.change(r.code, uid(i), { id: String(++n), version: current.version, type, value, ...extra });
  };
  for (let i = 0; i < 4; i++) await act(i, 'ready', true);
  return { rooms, store, code: r.code, get, act, time: t => { clock = t; } };
}
test('可信会话拒绝篡改、伪造和过期身份', () => {
  const token = sign(uid(1), secret, 1000);
  assert.equal(verify(token, secret, 1001), uid(1));
  assert.throws(() => verify(token + 'x', secret, 1001));
  assert.throws(() => verify(token, secret, 1000 + 7200000));
  assert.throws(() => verify(sign('fake', secret, 1000), secret, 1001));
});
test('浏览器恢复凭证隔离普通会话，拒绝篡改及过期', () => {
  const credential = guestCredential(uid(1), secret, 1000);
  assert.equal(restoreGuest(credential, secret, 1001), uid(1));
  assert.throws(() => restoreGuest(credential + 'x', secret, 1001));
  assert.throws(() => restoreGuest(credential, secret, 1000 + 180 * 86400000));
  assert.throws(() => verify(credential, secret, 1001));
  assert.throws(() => restoreGuest(sign(uid(1), secret, 1000), secret, 1001));
});
test('无人叫主投票3票重发，超时定庄、扣底及出牌均自动推进', () => {
  const players = Array.from({ length: 4 }, () => ({ level: '2', badges: 0 }));
  const random = rng(12); let s = G.start(players, 0, random);
  while (s.phase === 'dealing') G.tick(s, players, s.deadline, random);
  assert.equal(s.phase, 'calling');
  G.tick(s, players, s.deadline, random); assert.equal(s.phase, 'vote');
  const oldId = s.id;
  for (let i = 0; i < 3; i++) G.action(s, players, i, 'vote', true, s.deadline - 1, random);
  assert.equal(s.phase, 'dealing'); assert.notEqual(s.id, oldId);
  while (s.phase === 'dealing') G.tick(s, players, s.deadline, random);
  G.tick(s, players, s.deadline, random);
  G.tick(s, players, s.deadline, random); assert.equal(s.phase, 'bury');
  assert.equal(s.hands[s.dealer].length, 33);
  G.tick(s, players, s.deadline, random); assert.equal(s.phase, 'playing');
  assert.equal(s.bottom.length, 8);
  G.tick(s, players, s.deadline, random); assert.equal(s.trick.length, 1);
});
test('失败事务回滚全部修改，后续请求仍可保存', async () => {
  const store = new LocalStore(); await store.init();
  await assert.rejects(store.transaction(async tx => {
    await tx.set('profiles', 'test', { level: 'A' }); throw Error('save failed');
  }), /save failed/);
  assert.equal(await store.transaction(tx => tx.get('profiles', 'test')), null);
  await store.transaction(tx => tx.set('profiles', 'test', { level: '2' }));
  assert.equal((await store.transaction(tx => tx.get('profiles', 'test'))).level, '2');
});
test('并发抢座、房主转移、请出后旧邀请失效且新邀请可入座', async () => {
  const store = new LocalStore(); await store.init();
  const rooms = new Rooms(store), r = await rooms.create(uid(0));
  await rooms.join(uid(1), r.code); await rooms.join(uid(2), r.code);
  const results = await Promise.allSettled([rooms.join(uid(3), r.code), rooms.join(uid(4), r.code)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  let current = await store.transaction(tx => tx.get('rooms', r.code));
  const removed = current.members[3].uid, oldInvite = current.invite;
  current = await rooms.change(r.code, uid(0), { id: 'kick', version: current.version, type: 'kick', value: removed });
  await assert.rejects(rooms.join(removed, r.code, oldInvite), /重新邀请/);
  current = await rooms.change(r.code, uid(0), { id: 'invite', version: current.version, type: 'invite' });
  await rooms.join(removed, r.code, current.invite);
  current = await store.transaction(tx => tx.get('rooms', r.code));
  current = await rooms.change(r.code, uid(0), { id: 'leave', version: current.version, type: 'leave' });
  assert.notEqual(current.host, uid(0));
  assert.equal((await rooms.current(uid(0))).room, null);
});
test('四人并发叫主仅首个成功，快照隔离暗牌，非法ID及重复操作不改牌', async () => {
  const f = await setup(); let s = (await f.act(0, 'start')).game;
  f.time(s.deadline); let r = await f.rooms.tick(f.code);
  while (r.game.phase === 'dealing') { f.time(r.game.deadline); r = await f.rooms.tick(f.code); }
  const callers = r.game.hands.map((h, seat) => ({ seat, card: h.find(c => c.rank === r.game.level) })).filter(x => x.card);
  const requests = callers.map(({ seat, card }, i) => f.rooms.change(f.code, uid(seat), { id: 'call' + i, version: r.version, type: 'trump', value: card.suit }));
  const results = await Promise.allSettled(requests);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  r = await f.get(); const dealer = r.game.dealer;
  for (let i = 0; i < 4; i++) {
    const view = f.rooms.view(r, uid(i));
    assert.equal(view.game.hands, undefined); assert.equal(view.game.deck, undefined);
    assert.equal(view.game.hand.length, i === dealer ? 33 : 25);
    assert.equal(view.game.pickedBottom.length, i === dealer ? 8 : 0);
    assert.equal(view.game.bottom.length, 0);
    const own = new Set(view.game.hand.map(c => c.id));
    for (const c of r.game.hands[(i + 1) % 4]) assert.equal(own.has(c.id), false);
  }
  const ids = r.game.hands[dealer].slice(0, 8).map(c => c.id);
  const request = { id: 'bury-once', version: r.version, type: 'bury', value: ids };
  const once = await f.rooms.change(f.code, uid(dealer), request);
  const twice = await f.rooms.change(f.code, uid(dealer), request);
  assert.equal(twice.version, once.version); assert.equal(twice.game.hands[dealer].length, 25);
  await assert.rejects(f.act(dealer, 'play', ['not-held']), /不是你的手牌/);
  assert.equal((await f.get()).version, twice.version);
});
test('20种种子四人完整对局、200分守恒、结算幂等与互动卡首确认生效', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const random = rng(seed), players = [0, 1, 2, 3].map(() => ({ level: 'K', badges: 0 }));
    let now = 1000, s = G.start(players, now, random);
    for (let step = 0; step < 500 && !s.result; step++) {
      if (s.phase === 'calling') {
        const seat = s.hands.findIndex(h => h.some(c => c.rank === s.level));
        G.action(s, players, seat, 'trump', s.hands[seat].find(c => c.rank === s.level).suit, now, random);
      } else if (s.phase === 'bury') G.action(s, players, s.dealer, 'bury', s.hands[s.dealer].slice(0, 8).map(c => c.id), now, random);
      else if (s.phase === 'playing') G.action(s, players, s.turn, 'play', R.suggest(s.hands[s.turn], s.trick[0]?.cards || [], s).map(c => c.id), now, random);
      else { now = s.deadline; G.tick(s, players, now, random); }
    }
    assert.ok(s.result); assert.equal(s.teamScores[0] + s.teamScores[1] + R.points(s.bottom), 200);
    assert.equal(s.score, s.result.ordinaryScore + s.result.bottomPoints * s.result.multiplier);
    const before = structuredClone(players), winner = s.result.winningParity;
    G.action(s, players, winner, 'use', null, now, random);
    assert.throws(() => G.action(s, players, winner + 2, 'use', null, now, random));
    assert.equal(s.effects.length, 1); G.tick(s, players, now + 100000, random);
    assert.deepEqual(players, before);
  }
});
test('断线30秒托管，重连不撤销出牌，重启后租约隔离并恢复云端成绩', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'upgrade-test-'));
  const file = path.join(dir, 'state.json');
  try {
    const f = await setup(new LocalStore(file)); let r = await f.act(0, 'start');
    while (r.game.phase === 'dealing') { f.time(r.game.deadline); r = await f.rooms.tick(f.code); }
    const caller = r.game.hands.findIndex(h => h.some(c => c.rank === r.game.level));
    r = await f.act(caller, 'trump', r.game.hands[caller].find(c => c.rank === r.game.level).suit);
    r = await f.act(caller, 'bury', r.game.hands[caller].slice(0, 8).map(c => c.id));
    await f.rooms.presence(f.code, uid(caller), false);
    const before = r.game.hands[caller].length;
    f.time(r.game.deadline); r = await f.rooms.tick(f.code);
    assert.ok(r.game.hands[caller].length < before);
    const count = r.game.hands[caller].length;
    r = await f.rooms.presence(f.code, uid(caller), true);
    assert.equal(r.game.hands[caller].length, count);
    const recovered = new LocalStore(file); await recovered.init();
    let now = r.lease.until - 1;
    const other = new Rooms(recovered, { owner: 'other', now: () => now });
    await assert.rejects(other.presence(f.code, uid(0), true), /其他连接/);
    now += 2; r = await other.presence(f.code, uid(0), true);
    assert.equal(r.game.hands[caller].length, count);
    // Finish through server-owned timers, then reload the persisted settlement.
    for (let step = 0; step < 500 && !r.game.result; step++) { now = Math.max(now + 1, r.game.deadline); r = await other.tick(f.code); }
    assert.ok(r.game.result);
    const profile = await other.current(uid(0));
    const again = new LocalStore(file); await again.init();
    const restarted = new Rooms(again, { owner: 'other', now: () => now + 1 });
    await restarted.tick(f.code);
    assert.deepEqual(await restarted.current(uid(0)), profile);
    assert.equal(profile.level, r.members[0].level);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

async function wireClient(url, token, expectedType = 'ack') {
  const ws = new WebSocket(url), waiting = new Map(); let seq = 0, state;
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'state') state = m.state;
    if (['ack', 'error'].includes(m.type) && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const request = m => new Promise((resolve, reject) => {
    const id = 'wire-' + ++seq;
    const timeout = setTimeout(() => { waiting.delete(id); reject(Error('请求超时')); }, 3000);
    waiting.set(id, reply => { clearTimeout(timeout); resolve(reply); }); ws.send(JSON.stringify({ ...m, id }));
  });
  const login = await request(typeof token === 'object' ? token : { type: 'auth', token });
  assert.equal(login.type, expectedType);
  return { ws, request, login, state: () => state };
}
test('浏览器匿名身份由服务器生成，恢复原房间且不能伪造他人身份', async () => {
  const store = new LocalStore(); await store.init();
  const app = createServer({ store, secret, webGuest: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${app.server.address().port}/ws`, clients = [];
  try {
    const first = await wireClient(url, { type: 'guest', uid: uid(1) }); clients.push(first);
    assert.notEqual(first.login.profile.uid, uid(1));
    await first.request({ type: 'create' }); const code = first.state().code;
    const second = await wireClient(url, { type: 'guest' }); clients.push(second);
    assert.notEqual(second.login.profile.uid, first.login.profile.uid);
    assert.equal((await second.request({ type: 'guest', credential: first.login.credential })).type, 'error');
    const restored = await wireClient(url, { type: 'guest', credential: first.login.credential }); clients.push(restored);
    assert.equal(restored.login.profile.uid, first.login.profile.uid);
    assert.equal(restored.state().code, code);
    const invalid = await wireClient(url, { type: 'guest', credential: first.login.credential + 'x' }, 'error'); clients.push(invalid);
    assert.equal((await invalid.request({ type: 'create' })).type, 'error');
  } finally { for (const c of clients) c.ws.terminate(); await app.close(); }
});
test('默认不开启网页身份，不能绕过微信登录创建房间', async () => {
  const store = new LocalStore(); await store.init();
  const app = createServer({ store, secret });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let client;
  try {
    client = await wireClient(`ws://127.0.0.1:${app.server.address().port}/ws`, { type: 'guest' }, 'error');
    assert.match(client.login.error, /尚未开放/);
    assert.equal((await client.request({ type: 'create' })).type, 'error');
  } finally { client?.ws.terminate(); await app.close(); }
});
test('四个真实WebSocket客户端入房并完成整局，外来身份与非回合操作被拒绝', async () => {
  const store = new LocalStore(); await store.init(); let now = 100000;
  const app = createServer({ store, secret, webGuest: true, now: () => now, random: rng(8) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${app.server.address().port}/ws`, clients = [];
  try {
    for (let i = 0; i < 4; i++) clients.push(await wireClient(url, { type: 'guest' }));
    await clients[0].request({ type: 'create' }); const code = clients[0].state().code;
    for (let i = 1; i < 4; i++) assert.equal((await clients[i].request({ type: 'join', code })).type, 'ack');
    const get = () => store.transaction(tx => tx.get('rooms', code));
    const act = async (i, type, value) => clients[i].request({ type, value, version: (await get()).version });
    for (let i = 0; i < 4; i++) await act(i, 'ready', true);
    await act(0, 'start'); let r = await get();
    for (let step = 0; step < 500 && !r.game.result; step++) {
      const s = r.game;
      if (s.phase === 'calling') {
        const caller = s.hands.findIndex(h => h.some(c => c.rank === s.level));
        assert.equal((await act(caller, 'trump', s.hands[caller].find(c => c.rank === s.level).suit)).type, 'ack');
      } else if (s.phase === 'bury') {
        assert.equal((await act(s.dealer, 'bury', s.hands[s.dealer].slice(0, 8).map(c => c.id))).type, 'ack');
      } else if (s.phase === 'playing') {
        assert.equal((await act((s.turn + 1) % 4, 'play', [s.hands[s.turn][0].id])).type, 'error');
        assert.equal((await act(s.turn, 'play', R.suggest(s.hands[s.turn], s.trick[0]?.cards || [], s).map(c => c.id))).type, 'ack');
      } else { now = s.deadline; await app.advance(code); }
      r = await get();
    }
    assert.ok(r.game.result);
    for (const c of clients) {
      await c.request({ type: 'sync' });
      assert.equal(c.state().game.score, r.game.score);
      assert.equal(c.state().game.hands, undefined);
      assert.equal(c.state().game.bottom.length, 8);
    }
    const outsider = await wireClient(url, sign(uid(7), secret)); clients.push(outsider);
    assert.equal((await outsider.request({ type: 'play', value: [] })).type, 'error');
    assert.equal((await outsider.request({ type: 'join', code })).type, 'error');
  } finally { for (const c of clients) c.ws.terminate(); await app.close(); }
});
