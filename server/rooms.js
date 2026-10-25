const crypto = require('node:crypto');
const G = require('./round');
const R = require('../minigame/rules');
const active = r => r.game && !['result', 'reward'].includes(r.game.phase);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
class Rooms {
  constructor(store, options = {}) {
    this.store = store; this.owner = options.owner || crypto.randomUUID();
    this.now = options.now || Date.now; this.random = options.random || Math.random;
  }
  async profile(tx, uid) {
    let p = await tx.get('profiles', uid);
    if (!p) { p = { uid, name: '牌友' + uid.slice(0, 4), level: '2', badges: 0, room: null }; await tx.set('profiles', uid, p); }
    return p;
  }
  async current(uid) { return this.store.transaction(async tx => this.profile(tx, uid)); }
  async create(uid) {
    return this.store.transaction(async tx => {
      const p = await this.profile(tx, uid); if (p.room) throw Error('请先返回或离开已有房间');
      let code;
      for (let i = 0; i < 20; i++) { code = String(crypto.randomInt(100000, 1000000)); if (!await tx.get('rooms', code)) break; code = null; }
      if (!code) throw Error('房间创建繁忙，请重试');
      const now = this.now();
      const r = { code, host: uid, members: [this.member(p, now), null, null, null], version: 0,
        invite: crypto.randomBytes(18).toString('hex'), blocked: {}, requests: [], game: null,
        lease: { owner: this.owner, until: now + 15000 }, closed: false };
      p.room = code; await tx.set('profiles', uid, p); await tx.set('rooms', code, r); return r;
    });
  }
  member(p, now) { return { uid: p.uid, name: p.name, level: p.level, badges: p.badges, joined: now, ready: false, disconnected: now, departing: false }; }
  async join(uid, code, invite) {
    return this.store.transaction(async tx => {
      const r = await tx.get('rooms', code); if (!r || r.closed) throw Error('房间不存在或已关闭');
      const p = await this.profile(tx, uid);
      if (r.members.some(p => p && p.uid === uid)) return r;
      this.lease(r);
      if (p.room && p.room !== code) throw Error('请先离开已有房间');
      if (invite && invite !== r.invite) throw Error('邀请已失效');
      if (r.blocked[uid] && (!invite || invite !== r.invite || invite === r.blocked[uid])) throw Error('你已被请出，需要房主重新邀请');
      if (active(r)) throw Error('牌局进行中，不能入座');
      const seat = r.members.indexOf(null); if (seat < 0) throw Error('房间已满');
      r.members[seat] = this.member(p, this.now()); delete r.blocked[uid];
      // A changed table cannot reuse a settled round's interaction or readiness.
      r.game = null; r.members.filter(Boolean).forEach(m => { m.ready = false; });
      p.room = code; r.version++; await tx.set('profiles', uid, p); await tx.set('rooms', code, r); return r;
    });
  }
  lease(r) {
    const now = this.now();
    if (r.lease.owner !== this.owner && r.lease.until > now) throw Error('房间正在其他连接处理，请稍后重连');
    if (r.lease.owner !== this.owner) {
      r.members.filter(Boolean).forEach(m => { m.disconnected = now; });
      r.version++;
    }
    if (r.lease.owner !== this.owner || r.lease.until - now <= 5000) r.lease = { owner: this.owner, until: now + 15000 };
  }
  async change(code, uid, request) {
    return this.store.transaction(async tx => {
      const r = await tx.get('rooms', code); if (!r || r.closed) throw Error('房间已关闭');
      this.lease(r);
      const seat = r.members.findIndex(p => p && p.uid === uid); if (seat < 0) throw Error('你不在此房间');
      const member = r.members[seat];
      const key = hash(uid + ':' + request.id);
      if (r.requests.includes(key)) return r;
      if (request.version !== r.version) throw Error('牌局已更新，请按最新状态重试');
      if (member.departing) throw Error('你已离开，当前由托管完成牌局');
      const { type, value } = request;
      if (type === 'ready' && !active(r)) {
        if (r.game && r.game.phase !== 'reward') throw Error('请等待互动环节结束');
        member.ready = !!value;
      } else if (type === 'start' && uid === r.host && !active(r)) {
        if (r.game && r.game.phase !== 'reward') throw Error('请等待互动环节结束');
        if (!r.members.every(p => p && p.ready && !p.departing)) throw Error('需要四人准备');
        for (const m of r.members) {
          const p = await this.profile(tx, m.uid); m.level = p.level; m.badges = p.badges; m.ready = false;
        }
        const effects = r.game?.effects || [];
        r.game = G.start(r.members, this.now(), this.random); r.game.effects = effects;
      } else if (type === 'leave') {
        if (active(r)) { member.departing = true; member.disconnected = this.now() - 30000; }
        else await this.remove(tx, r, seat);
      } else if (type === 'kick' && uid === r.host && !active(r)) {
        const target = r.members.findIndex(p => p && p.uid === value && p.uid !== uid);
        if (target < 0) throw Error('不能请出该玩家');
        r.blocked[value] = r.invite; await this.remove(tx, r, target);
      } else if (type === 'invite' && uid === r.host) r.invite = crypto.randomBytes(18).toString('hex');
      else if (r.game) G.action(r.game, r.members, seat, type, value, this.now(), this.random);
      else throw Error('当前不能执行此操作');
      r.requests.push(key); r.requests = r.requests.slice(-512); r.version++;
      await tx.set('rooms', code, r); return r;
    });
  }
  async remove(tx, r, seat) {
    const m = r.members[seat], p = await this.profile(tx, m.uid);
    p.room = null; await tx.set('profiles', m.uid, p); r.members[seat] = null;
    if (r.host === m.uid) r.host = r.members.filter(Boolean).sort((a, b) => a.joined - b.joined)[0]?.uid || null;
    r.closed = !r.host;
    r.members.filter(Boolean).forEach(m => { m.ready = false; });
  }
  async presence(code, uid, online) {
    return this.store.transaction(async tx => {
      const r = await tx.get('rooms', code); if (!r || r.closed) throw Error('房间已关闭'); this.lease(r);
      const p = r.members.find(p => p && p.uid === uid); if (!p) throw Error('你不在此房间');
      if (p.departing && online) throw Error('你已离开本局');
      p.disconnected = online ? null : this.now();
      r.version++; await tx.set('rooms', code, r); return r;
    });
  }
  async tick(code) {
    return this.store.transaction(async tx => {
      const r = await tx.get('rooms', code); if (!r || r.closed) return r;
      const oldLease = r.lease.until;
      this.lease(r); const now = this.now(); let changed = false;
      if (active(r)) {
        const s = r.game, actor = s.phase === 'bury' ? s.dealer : s.phase === 'playing' ? s.turn : -1;
        if (actor >= 0) {
          const m = r.members[actor];
          if (m.disconnected !== null && now - m.disconnected >= 30000) s.deadline = Math.min(s.deadline, now);
        }
      }
      if (r.game) {
        const wasResult = !!r.game.result;
        changed = G.tick(r.game, r.members, now, this.random);
        if (!wasResult && r.game.result) {
          // Profiles and the settled room are committed atomically: retries cannot award twice.
          for (const m of r.members) {
            const p = await this.profile(tx, m.uid); p.level = m.level; p.badges = m.badges;
            await tx.set('profiles', m.uid, p);
          }
          for (let i = 0; i < 4; i++) if (r.members[i]?.departing) await this.remove(tx, r, i);
        }
      }
      if (changed) r.version++;
      if (changed || r.lease.until !== oldLease) await tx.set('rooms', code, r);
      return r;
    });
  }
  view(r, uid) {
    const seat = r.members.findIndex(p => p && p.uid === uid);
    if (seat < 0) return { code: r.code, removed: true, version: r.version };
    const g = r.game;
    const view = { code: r.code, host: r.host, seat, version: r.version, serverTime: this.now(),
      invite: r.invite, members: r.members.map(p => p ? { uid: p.uid, name: p.name, level: p.level, badges: p.badges,
        ready: p.ready, online: p.disconnected === null, departing: p.departing } : null), game: null };
    if (g) {
      const { deck, hands, bottom, pickedBottom, ...publicGame } = g;
      view.game = { ...publicGame, hand: R.sortHand(hands[seat], g), counts: hands.map(h => h.length),
        bottom: g.result ? bottom : [], pickedBottom: seat === g.dealer && g.phase === 'bury' ? pickedBottom : [] };
    }
    return view;
  }
}
module.exports = { Rooms };
