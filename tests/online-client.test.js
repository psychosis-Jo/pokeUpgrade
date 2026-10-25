const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const R = require('../minigame/rules');
const source = fs.readFileSync(require.resolve('../minigame/online'), 'utf8');
function fixture(config) {
  const module = { exports: {} }, labels = [], hits = [], buttons = [], sent = [], events = {};
  const wx = {
    cloud: { init() {}, callFunction: async () => ({ result: { token: 'signed-token' } }),
      connectContainer: async () => ({ socketTask: task }) },
    showModal: opts => opts.success({ confirm: true, content: '123456' }),
    shareAppMessage: opts => { events.share = opts; },
    showKeyboard: opts => { events.keyboard = opts; }, hideKeyboard() {},
    onKeyboardConfirm: fn => { events.confirm = fn; }, offKeyboardConfirm() {},
    onKeyboardComplete: fn => { events.complete = fn; }, offKeyboardComplete() {},
  };
  const task = { onOpen: fn => { events.open = fn; }, onMessage: fn => { events.message = fn; },
    onClose: fn => { events.close = fn; }, onError: fn => { events.error = fn; },
    send: ({ data }) => sent.push(JSON.parse(data)), close() {} };
  vm.runInNewContext(source, { module, require: name => name === './rules' ? R : config,
    Date, Math, Set, Map, setTimeout, clearTimeout });
  const client = module.exports.createOnline({ wx, text: label => labels.push(label), box() {},
    button: (...args) => buttons.push(args), hit: area => hits.push(area), lineCards() {},
    requestRender() {}, colors: {} });
  const message = m => events.message({ data: JSON.stringify(m) });
  return { client, labels, hits, buttons, sent, events, message };
}
test('未配置云环境时好友房提示配置，人机入口可返回', async () => {
  const f = fixture({ env: '' }); f.client.enter(); await Promise.resolve();
  assert.equal(f.client.draw(), true);
  assert.ok(f.labels.some(s => s.includes('好友房尚未部署')));
  f.client.action('back'); assert.equal(f.client.draw(), false);
});
test('小游戏云登录、邀请入房、手牌点击、合法提示和出牌确认', async () => {
  const f = fixture({ env: 'test-env', service: 'upgrade-game' });
  f.client.enter({ room: '123456', invite: 'ticket' });
  await new Promise(resolve => setImmediate(resolve));
  f.client.draw(); assert.equal(typeof f.events.open, 'function', f.labels.join(' | '));
  f.events.open(); assert.equal(f.sent[0].token, 'signed-token');
  f.message({ type: 'ack', profile: { uid: 'me', room: null } });
  assert.equal(f.sent[1].type, 'join'); assert.equal(f.sent[1].invite, 'ticket');
  f.client.action('join-code');
  assert.equal(f.events.keyboard.maxLength, 6);
  const beforeInput = f.sent.length;
  f.events.confirm({ value: '12' }); assert.equal(f.sent.length, beforeInput);
  f.client.action('join-code'); f.events.confirm({ value: '654321' });
  assert.equal(f.sent.at(-1).code, '654321');
  const card = { suit: '♣', rank: '5', id: 'held-card' };
  const state = { code: '123456', invite: 'ticket', host: 'me', seat: 0, version: 10, serverTime: 1000,
    members: [0, 1, 2, 3].map(i => ({ uid: i ? String(i) : 'me', name: '牌友' + i, ready: true, online: true, level: '2', badges: 0 })),
    game: { phase: 'playing', level: '2', levelPlayer: 2, trump: '♥', dealer: 0, turn: 0,
      score: 0, teamScores: [0, 0], hand: [card], counts: [1, 1, 1, 1], round: 1, trick: [],
      previousTrick: [], effects: [], deadline: 31000 } };
  f.message({ type: 'state', state }); f.client.draw();
  assert.ok(f.labels.some(s => s.includes('采用牌友2的等级')));
  assert.equal(f.hits[0].value, 'held-card');
  f.client.action('hint'); f.client.action('play');
  assert.equal(f.sent.at(-1).type, 'play');
  assert.deepEqual(Array.from(f.sent.at(-1).value), ['held-card']);
  assert.equal(f.sent.at(-1).version, 10);
  f.message({ type: 'state', state: { ...state, version: 9 } });
  f.client.action('play'); assert.equal(f.sent.at(-1).version, 10);
  f.message({ type: 'error', error: '必须跟同花色' });
  f.message({ type: 'state', state });
  f.client.draw(); assert.ok(f.labels.includes('必须跟同花色'));
  f.client.hide(); f.events.close({ code: 1000 });
});
