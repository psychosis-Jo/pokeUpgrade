const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Rooms } = require('./rooms');
const { LocalStore, CloudStore } = require('./store');
const { sign, verify } = require('./auth');
// 兜底：任何未捕获的 Promise 拒绝只记录、不让进程退出，避免容器被 K8s 反复重启。
process.on('unhandledRejection', e => console.error('unhandledRejection:', e?.message || e));
function createServer({ store, secret, localLogin = false, now, random }) {
  if (!secret || secret.length < 32) throw Error('SESSION_SECRET至少32个字符');
  const rooms = new Rooms(store, { now, random });
  const clients = new Set(), watched = new Set(), cache = new Map();
  const recovery = store.activeRooms().then(codes => { for (const code of codes) watched.add(code); });
  recovery.catch(() => { console.error('Room recovery scan failed; check database permissions'); });
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (req.url === '/diag') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ envKeys: Object.keys(process.env).filter(k => /TENCENTCLOUD|SECRET|CLOUD_ENV|SESSION/i.test(k)), hasSecretId: !!process.env.TENCENTCLOUD_SECRETID, hasSecretKey: !!process.env.TENCENTCLOUD_SECRETKEY, cloudEnv: process.env.CLOUD_ENV })); }
    // No test identity endpoint exists in cloud deployments.
    if (localLogin && req.method === 'POST' && req.url === '/dev-login') {
      let body = ''; req.on('data', b => { body += b; if (body.length > 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const name = JSON.parse(body).name; if (typeof name !== 'string' || name.length > 80) throw Error();
          const uid = crypto.createHash('sha256').update('local:' + name).digest('hex');
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ token: sign(uid, secret), uid }));
        } catch { res.writeHead(400); res.end('bad request'); }
      }); return;
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16384 });
  const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  function broadcast(r) {
    if (!r) return;
    if (cache.has(r.code) && cache.get(r.code).version > r.version) return;
    cache.set(r.code, r);
    for (const ws of clients) if (ws.code === r.code && ws.uid) {
      send(ws, { type: 'state', state: rooms.view(r, ws.uid) });
      if (!r.members.some(p => p && p.uid === ws.uid)) ws.code = null;
    }
    if (r.closed) watched.delete(r.code);
  }
  wss.on('connection', ws => {
    clients.add(ws); ws.alive = true; ws.chain = Promise.resolve();
    const timeout = setTimeout(() => { if (!ws.uid) ws.close(4001, 'login required'); }, 10000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', raw => {
      ws.chain = ws.chain.then(async () => {
        let m;
        try {
          m = JSON.parse(raw.toString());
          if (!m || typeof m.id !== 'string' || m.id.length > 100 || !m.id.length) throw Error('请求编号无效');
          if (m.type === 'auth') {
            if (ws.uid) throw Error('已经登录');
            ws.uid = verify(m.token, secret); clearTimeout(timeout);
            // A single active connection per account prevents ambiguous presence/turn ownership.
            for (const old of clients) if (old !== ws && old.uid === ws.uid) { old.superseded = true; old.close(4002, 'another connection'); }
            const profile = await rooms.current(ws.uid);
            if (profile.room) {
              try { const r = await rooms.presence(profile.room, ws.uid, true); ws.code = r.code; watched.add(r.code); broadcast(r); }
              catch (e) { send(ws, { type: 'notice', error: e.message }); }
            }
            return send(ws, { type: 'ack', id: m.id, profile });
          }
          if (!ws.uid) throw Error('请先登录');
          let r;
          if (m.type === 'create') r = await rooms.create(ws.uid);
          else if (m.type === 'join') {
            if (!/^\d{6}$/.test(m.code)) throw Error('房间码应为6位数字');
            r = await rooms.join(ws.uid, m.code, m.invite);
          } else {
            if (!ws.code) throw Error('请先加入房间');
            if (m.type === 'sync') {
              r = await rooms.presence(ws.code, ws.uid, true);
            } else r = await rooms.change(ws.code, ws.uid, m);
          }
          if (['create', 'join'].includes(m.type)) {
            ws.code = r.code; watched.add(r.code); r = await rooms.presence(r.code, ws.uid, true);
          }
          broadcast(r); send(ws, { type: 'ack', id: m.id });
        } catch (e) {
          send(ws, { type: 'error', id: m?.id, error: e.message });
          if (ws.code) {
            const r = await store.transaction(tx => tx.get('rooms', ws.code));
            if (r) send(ws, { type: 'state', state: rooms.view(r, ws.uid) });
          }
        }
      }).catch(() => { send(ws, { type: 'notice', error: '服务暂时不可用，请重连' }); });
    });
    ws.on('close', () => {
      clearTimeout(timeout); clients.delete(ws);
      if (ws.code && ws.uid && !ws.superseded) ws.chain.then(() => rooms.presence(ws.code, ws.uid, false)).then(broadcast).catch(() => {});
    });
    ws.on('error', () => {});
  });
  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return; ticking = true;
    try {
      for (const code of watched) {
        try {
          const cached = cache.get(code), clock = now ? now() : Date.now();
          const g = cached?.game;
          const actor = g?.phase === 'bury' ? g.dealer : g?.phase === 'playing' ? g.turn : -1;
          const disconnected = actor >= 0 ? cached.members[actor]?.disconnected : null;
          const takeoverDue = disconnected != null && clock >= disconnected + 30000;
          if (cached && !takeoverDue && clock < cached.lease.until - 5000 && (!g?.deadline || clock < g.deadline)) {
            broadcast(cached); continue;
          }
          const r = await rooms.tick(code); broadcast(r);
          if (!r || r.closed || !r.members.some(m => m && m.disconnected === null) && (!r.game || r.game.phase === 'reward')) watched.delete(code);
        } catch (e) {
          for (const ws of clients) if (ws.code === code) send(ws, { type: 'notice', error: '房间恢复中，请稍后重新连接' });
          // Keep retrying after a previous instance's lease expires or the database recovers.
        }
      }
    } finally { ticking = false; }
  }, 250);
  const heartbeat = setInterval(() => {
    for (const ws of clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, 15000);
  async function close() {
    clearInterval(timer); clearInterval(heartbeat);
    for (const ws of clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  return { server, rooms, close, recovery, advance: async code => { const r = await rooms.tick(code); broadcast(r); return r; } };
}
async function main() {
  console.log('[diag] env keys:', Object.keys(process.env).filter(k => /TENCENTCLOUD|SECRET|CLOUD_ENV|SESSION/i.test(k)).join(','));
  const cloudMode = process.env.STORE === 'cloud';
  if (cloudMode && process.env.DEV_LOGIN === '1') throw Error('云部署禁止开发登录');
  let store;
  if (cloudMode) {
    const cloud = require('wx-server-sdk');
    // 云托管服务在 upgrade-test 环境、数据库在 cloud1 环境（跨环境），必须靠 CLOUD_ENV 显式指定目标环境，
    // 且需在云托管控制台手动配置 TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY（平台不会跨环境注入凭证）。
    cloud.init({ env: process.env.CLOUD_ENV }); store = new CloudStore(cloud.database());
  } else store = new LocalStore(process.env.DATA_FILE || './.local/upgrade.json');
  await store.init();
  const app = createServer({ store, secret: process.env.SESSION_SECRET, localLogin: !cloudMode && process.env.DEV_LOGIN === '1' });
  const port = Number(process.env.PORT || 8080);
  app.server.listen(port, cloudMode ? '0.0.0.0' : '127.0.0.1', () => console.log(`Upgrade server listening on ${port} (${cloudMode ? 'cloud' : 'local'})`));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { createServer };
