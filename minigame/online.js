const R = require('./rules');
const config = require('./online-config');
const EFFECTS = { graffiti: '头像涂鸦', dance: '挑衅舞', mute: '禁言演示标记', title: '临时称号' };
function createOnline({ wx, text, box, button, hit, lineCards, requestRender, colors: C, room }) {
  let enabled = false, state = null, selected = [], socket = null, uid = '', status = '', busy = false;
  let seq = 0, generation = 0, reconnect = null, hidden = false, pendingInvite = null, showPrevious = false;
  const pending = new Map();
  const id = () => `${Date.now()}-${++seq}-${Math.random().toString(36).slice(2)}`;
  function notify(message) {
    status = /RunTransaction/.test(message)
      ? '好友房连接失败：数据库事务权限不足，请管理员修复' : message;
    requestRender();
  }
  function send(type, value, extra = {}) {
    if (!socket || !uid) { notify('连接尚未就绪，请稍候'); return; }
    const requestId = id();
    const m = { id: requestId, type, value, version: state?.version, ...extra };
    pending.set(requestId, { type, sent: Date.now() });
    socket.send({ data: JSON.stringify(m), fail: () => { pending.delete(requestId); notify('发送失败，请重连'); } });
  }
  function share() {
    if (!state) return;
    wx.shareAppMessage({ title: '来熟人局升级，一起打牌', query: `room=${state.code}&invite=${state.invite}` });
  }
  async function connect() {
    if (busy || hidden) return; busy = true; const gen = ++generation; uid = '';
    if (socket) { const old = socket; socket = null; old.close({}); }
    notify('正在连接好友房…');
    try {
      let token;
      if (config.webGuest) {
        // Browser identity is issued and verified by the server, separate from WeChat.
      } else if (config.localUrl) {
        if (!config.localPlayer) throw Error('本地联调请配置唯一localPlayer');
        const login = await new Promise((resolve, reject) => wx.request({
          url: config.localUrl.replace(/^ws/, 'http').replace(/\/ws$/, '/dev-login'), method: 'POST',
          data: { name: config.localPlayer }, success: r => r.statusCode === 200 ? resolve(r.data) : reject(Error('本地登录失败')), fail: reject,
        }));
        token = login.token;
      } else {
        if (!config.env) throw Error('好友房尚未部署，请先配置云环境ID');
        if (!wx.cloud) throw Error('当前微信版本不支持云开发');
        wx.cloud.init({ env: config.env });
        const login = await wx.cloud.callFunction({ name: 'login' }); token = login.result.token;
      }
      if (gen !== generation || hidden) return;
      let task;
      if (config.localUrl) task = wx.connectSocket({ url: config.localUrl });
      else if (config.wsUrl) task = wx.connectSocket({ url: config.wsUrl });
      else {
        const container = await wx.cloud.connectContainer({ config: { env: config.env }, service: config.service, path: '/ws' });
        task = container.socketTask;
      }
      if (gen !== generation || hidden) { task.close({}); return; }
      socket = task;
      task.onOpen(() => {
        if (gen !== generation) return;
        let credential;
        if (config.webGuest) {
          try { credential = wx.getStorageSync('upgrade-browser-identity-v1'); }
          catch { notify('浏览器存储不可用，离开页面后可能无法找回身份'); }
        }
        task.send({ data: JSON.stringify(config.webGuest ? { type: 'guest', id: id(), credential } : { type: 'auth', id: id(), token }) });
      });
      task.onMessage(event => {
        if (gen !== generation) return;
        let m; try { m = JSON.parse(event.data); } catch { notify('服务器消息无法读取'); return; }
        if (m.type === 'state') {
          if (state && state.code === m.state.code && m.state.version < state.version) return;
          if (m.state.removed) { state = null; selected = []; notify('你已离开房间'); }
          else {
            const changedGame = state?.game?.id !== m.state.game?.id;
            if (changedGame) showPrevious = false;
            const firstSync = !state;
            state = m.state;
            const held = new Set(state.game?.hand.map(c => c.id) || []); selected = selected.filter(x => held.has(x));
            if (firstSync) notify('房间已同步');
          }
        } else if (m.type === 'ack') {
          let identitySaved = true;
          if (config.webGuest && m.credential) {
            try { wx.setStorageSync('upgrade-browser-identity-v1', m.credential); }
            catch { identitySaved = false; }
          }
          const req = pending.get(m.id); pending.delete(m.id);
          if (req && ['play', 'bury'].includes(req.type)) selected = [];
          if (req?.type === 'invite') share();
          if (m.profile) {
            uid = m.profile.uid; notify(identitySaved ? '已登录好友房' : '身份无法保存，请勿关闭页面');
            if (pendingInvite && !m.profile.room) { const invite = pendingInvite; pendingInvite = null; send('join', null, invite); }
          }
        } else { pending.delete(m.id); notify(m.error || '请求未完成'); }
        requestRender();
      });
      task.onError(() => { if (gen === generation) notify('连接异常，请检查网络或云托管配置'); });
      task.onClose(event => {
        if (gen !== generation) return;
        socket = null; uid = ''; pending.clear();
        notify('连接断开，正在恢复…');
        if (event.code === 4002) { notify('账号已在其他设备连接，请手动重连'); return; }
        if (enabled && !hidden) reconnect = setTimeout(connect, 2000);
      });
    } catch (error) { notify(error.message || error.errMsg || '连接失败，请重试'); }
    finally { if (gen === generation) busy = false; }
  }
  function enter(query) {
    enabled = true;
    if (query?.room) pendingInvite = { code: query.room, invite: query.invite };
    connect(); requestRender();
  }
  function action(type, value) {
    if (type === 'enter') return enter();
    if (type === 'back') {
      if (state) return notify('请先离开房间，再返回人机练习');
      enabled = false; generation++; clearTimeout(reconnect); socket?.close({}); socket = null; busy = false; requestRender(); return;
    }
    if (type === 'reconnect') return connect();
    if (type === 'join-code') {
      if (!wx.showKeyboard) return notify('当前环境不支持输入，请使用微信邀请加入');
      const cleanup = () => {
        wx.offKeyboardConfirm(confirm); wx.offKeyboardComplete(complete);
      };
      const confirm = r => {
        const code = (r.value || '').trim();
        cleanup(); wx.hideKeyboard({});
        if (!/^\d{6}$/.test(code)) return notify('请输入6位数字房间码');
        if (!uid) {
          pendingInvite = { code };
          return notify(`已记住房间码 ${code}，尚未登录；请重新连接后加入`);
        }
        send('join', null, { code });
      };
      const complete = () => { cleanup(); };
      wx.onKeyboardConfirm(confirm); wx.onKeyboardComplete(complete);
      wx.showKeyboard({ defaultValue: '', maxLength: 6, multiple: false, confirmHold: false, confirmType: 'done',
        fail: () => { cleanup(); notify('键盘打开失败，请重试或使用微信邀请加入'); } });
      return;
    }
    if (type === 'share') { if (state?.host === uid) send('invite'); else share(); return; }
    if (type === 'leave') {
      wx.showModal({ title: '离开房间？', content: state?.game && !['result', 'reward'].includes(state.game.phase)
        ? '本局由托管完成，结果仍计入你的等级；局后释放座位。' : '离开后可以重新加入。',
      success: r => { if (r.confirm) send('leave'); } }); return;
    }
    if (type === 'kick') {
      wx.showModal({ title: '请出这位玩家？', content: '对方需要你的新邀请才能再次加入。', success: r => { if (r.confirm) send('kick', value); } }); return;
    }
    if (type === 'select') { selected = selected.includes(value) ? selected.filter(x => x !== value) : [...selected, value]; requestRender(); return; }
    if (type === 'clear') { selected = []; requestRender(); return; }
    if (type === 'previous') { showPrevious = !showPrevious; requestRender(); return; }
    if (type === 'hint' && state?.game) {
      const s = state.game; selected = R.suggest(s.hand, s.trick.length ? s.trick[0].cards : [], s).map(c => c.id);
      notify('已推荐合法牌，确认后再出牌'); return;
    }
    if (type === 'choice') return send(type, { ...state.game.choice, ...value });
    if (['play', 'bury'].includes(type)) {
      if (type === 'play') {
        const s = state.game;
        const error = R.validatePlay(s.hand, s.hand.filter(c => selected.includes(c.id)), s.trick.length ? s.trick[0].cards : [], s);
        if (error) return notify(error);
      }
      return send(type, selected);
    }
    send(type, value);
  }
  const b = (label, x, y, w, h, action, value, highlight = false, on = true) => button(label, x, y, w, h, 'online:' + action, value, highlight, on);
  function dealScreen() {
    const s = state.game;
    box(14, 10, 347, 96, '#fff6e8', 18);
    text('熟人局升级', 28, 33, 21, C.ink);
    text(`房间 ${state.code} · 你在${state.seat + 1}号位`, 28, 59, 12, C.muted);
    b('离开', 298, 24, 48, 32, 'leave');
    const name = state.members[s.levelPlayer]?.name || '牌友';
    text(`采用${name.slice(0, 8)}的等级 · 本局打 ${s.level}`, 28, 86, 13, C.gold);
    const seconds = Math.max(0, Math.ceil((s.deadline - state.serverTime) / 1000));
    room?.dealing({ players: state.members, counts: s.counts, seat: state.seat,
      level: s.level, dealer: s.dealer, trump: s.trump, dealt: s.dealt, phase: s.phase });
    box(14, 384, 347, 65, '#fff6e8', 14);
    R.SUITS.forEach((suit, i) => {
      const eligible = s.dealer < 0 && s.hand.some(c => c.rank === s.level && c.suit === suit);
      b(`${suit} ${eligible ? '叫主' : '暂无'}`, 22 + i * 84, 394, 76, 43, 'trump', suit, eligible, eligible);
    });
    box(14, 456, 347, 270, '#f4e7cc', 18);
    drawHand(s);
    const dealer = s.dealer < 0 ? '' : s.dealer === state.seat ? '你' : state.members[s.dealer].name.slice(0, 8);
    text(dealer ? `${dealer}已叫${s.trump}主，发完牌后扣底` : s.phase === 'calling' ? `最后叫主 ${seconds}秒 · 首个叫主者坐庄` : `摸到对应花色的 ${s.level}，就能叫主`, 187, 688, 13, C.gold, 'center');
    text('两副牌 · 每人25张 · 庄家另取8张底牌', 187, 710, 10, C.muted, 'center');
  }
  function drawHand(s) {
    text(`你的手牌${s.hand.length}张 · 已选${selected.length}张`, 22, 470, 12, C.gold);
    const selectable = s.phase === 'bury' && s.dealer === state.seat || s.phase === 'playing' && s.turn === state.seat;
    s.hand.forEach((c, i) => {
      const x = 22 + i % 11 * 30, y = 492 + Math.floor(i / 11) * 54 - (selected.includes(c.id) ? 7 : 0);
      if (selected.includes(c.id)) box(x - 2, y - 2, 31, 52, '#367e95', 5);
      box(x, y, 27, 48, '#fffbf2', 4);
      const color = ['♥', '♦'].includes(c.suit) || c.rank === 'BJ' ? '#bb3939' : '#22392d';
      text(c.rank === 'SJ' ? '小' : c.rank === 'BJ' ? '大' : c.rank, x + 3, y + 13, 14, color);
      text(c.suit === 'J' ? '王' : c.suit, x + 3, y + 31, 16, color);
      if (R.category(c, s) === 'T') text(c.suit === 'J' ? '王' : c.rank === s.level ? '级' : '主', x + 22, y + 38, 8, '#8a641b', 'center');
      if (selectable) hit({ x, y, w: 27, h: 48, action: 'online:select', value: c.id });
    });
    if (selectable) {
      b('清空', 22, 670, 65, 46, 'clear');
      if (s.phase === 'playing') b('提示', 95, 670, 65, 46, 'hint');
      b(s.phase === 'bury' ? `扣底 ${selected.length}/8` : `出牌 ${selected.length}张`, 170, 670, 177, 46,
        s.phase === 'bury' ? 'bury' : 'play', null, true, s.phase !== 'bury' || selected.length === 8);
    }
  }
  function waitingRoom() {
    const me = state.members[state.seat], host = state.host === uid, s = state.game;
    const count = state.members.filter(Boolean).length;
    box(14, 10, 347, 108, '#fff6e8', 18);
    text('熟人局升级', 28, 34, 21, C.ink);
    text('好友房', 28, 59, 12, C.muted);
    b('邀请朋友', 218, 24, 82, 35, 'share');
    b('离开', 306, 24, 42, 35, 'leave');
    text(`房间 ${state.code}`, 28, 92, 19, C.gold);
    text(`已入座 ${count}/4`, 336, 92, 12, C.muted, 'right');
    box(38, 128, 299, 32, '#fff6e8', 12);
    text(s ? '再来一局，还是这桌朋友。' : '朋友慢慢来，牌桌给你留着。', 187, 144, 16, C.ink, 'center');
    const positions = [[140, 381], [248, 268], [140, 163], [32, 268]];
    room?.picture('table', 83, 245, 209, 165);
    box(130, 297, 115, 54, '#fff6e8', 16);
    text('对家是队友', 187, 316, 14, C.gold, 'center');
    text('凑一桌，就开局', 187, 337, 11, C.muted, 'center');
    state.members.forEach((p, i) => {
      const relative = (i - state.seat + 4) % 4;
      const [x, y] = positions[relative], ally = relative % 2 === 0;
      box(x, y, 95, 113, p ? '#fff6e8' : '#eee0c9', 16);
      const art = ['self-avatar', 'right', 'teammate', 'left'][relative];
      if (p) {
        if (!room?.picture(art, x + 19, y + 3, 57, 53)) {
          box(x + 28, y + 8, 39, 39, '#ead8ba', 16);
          text(p.name.slice(0, 1), x + 47, y + 29, 19, C.gold, 'center');
        }
      } else text('+', x + 47, y + 29, 28, '#a6947d', 'center');
      const name = p ? (i === state.seat ? '你' : p.name).slice(0, 6) : '留个座位';
      text(name, x + 47, y + 62, 13, C.ink, 'center');
      text(`${i + 1}号位 · ${ally ? '我方' : '对手'}`, x + 47, y + 80, 10, ally ? C.team : C.red, 'center');
      text(!p ? '等待朋友' : p.bot ? '电脑 · 自动出牌' : !p.online ? '断线 / 托管' : p.ready ? '已准备' : '未准备', x + 47, y + 98, 10, p?.ready ? C.team : C.muted, 'center');
      if (p && host && p.uid !== uid) b(p.bot ? '移除电脑' : '请出', x + 12, y + 116, 71, 25, 'kick', p.uid);
    });
    box(14, 532, 347, 183, '#fff6e8', 18);
    text(`你的等级 ${me.level} · 徽章 ${me.badges}`, 28, 555, 13, C.gold);
    text('联机进度独立保存', 28, 576, 11, C.muted);
    if (host && count < 4) {
      b('电脑补齐空位', 28, 592, 319, 38, 'fill-bots');
      text('电脑自动准备，开局前可移除', 187, 644, 11, C.muted, 'center');
    } else {
      text(count < 4 ? '还缺朋友？房主可以添加电脑补位' : '人已到齐，准备好就开局', 187, 614, 13, C.muted, 'center');
      text(host ? '所有人准备后，由你开局' : '准备后等房主开局', 187, 644, 11, C.muted, 'center');
    }
    b(me.ready ? '取消准备' : '准备好了', 28, 662, host ? 153 : 319, 40, 'ready', !me.ready, !me.ready);
    if (host) b('开始牌局', 193, 662, 154, 40, 'start', null, true, state.members.every(p => p?.ready));
    if (s?.effects.length) {
      const e = s.effects[0];
      text(`${state.members[e.actor]?.name || '赢家'}使用${EFFECTS[e.type]} · ${state.members[e.target]?.name || '牌友'}自己也可见`, 187, 516, 10, C.gold, 'center');
    }
    if (!uid) b('重新连接', 252, 542, 95, 36, 'reconnect');
  }
  function draw() {
    if (!enabled) return false;
    const waiting = state && (!state.game || state.game.phase === 'reward');
    const dealing = state?.game && ['dealing', 'calling'].includes(state.game.phase);
    room?.background(!state || waiting || dealing);
    if (dealing) {
      dealScreen();
      status.match(/.{1,29}/g)?.slice(0, 2).forEach((line, i) => text(line, 22, 733 + i * 14, 11, C.gold));
      return true;
    }
    if (waiting) {
      waitingRoom();
      status.match(/.{1,29}/g)?.slice(0, 2).forEach((line, i) => text(line, 22, 733 + i * 14, 11, C.gold));
      return true;
    }
    text('♠ 熟人局升级 · 好友房', 20, 24, 22, C.gold);
    text('云端等级 · 四人对战 · 暂无真实语音', 20, 54, 12, C.muted);
    if (!state) {
      box(14, 10, 347, 78, '#fff6e8', 18);
      text('熟人局升级 · 好友房', 28, 36, 21, C.ink);
      text('和朋友凑一桌，认真打牌，开心整蛊', 28, 65, 12, C.muted);
      room?.picture('table', 94, 97, 187, 121);
      box(14, 218, 347, 241, '#fff6e8', 18);
      box(14, 648, 347, 80, '#fff6e8', 18);
      b('创建房间', 22, 230, 325, 50, 'create', null, true, !!uid);
      b('输入房间码加入', 22, 300, 325, 50, 'join-code');
      b('重新连接', 22, 390, 325, 46, 'reconnect');
      b('返回人机练习', 22, 670, 325, 46, 'back');
    } else {
      const s = state.game;
      text(`房间 ${state.code} · 你在${state.seat + 1}号位`, 22, 82, 13, C.gold);
      if (!uid) b('重连', 165, 98, 55, 30, 'reconnect');
      b('邀请', 230, 98, 55, 30, 'share'); b('离开', 292, 98, 55, 30, 'leave');
      const levelName = s ? state.members[s.levelPlayer]?.name || '本局玩家' : '';
      text(s ? `采用${levelName}的等级 · 打${s.level} · ${s.trump || '未定'}主` : '对家组队，四人准备后房主开局', 22, 115, 11, C.gold);
      state.members.forEach((p, i) => {
        const x = 22 + i * 85, ally = i % 2 === state.seat % 2;
        const color = ally ? C.team : C.red;
        box(x, 130, 18, 16, color, 4);
        text(String(i + 1), x + 9, 132, 10, C.ink, 'center');
        text(p ? `${i === state.seat ? '你' : p.name}${s?.dealer === i ? '·庄' : ''}` : '等待入座', x, 150, 10, color);
        text(p ? `${ally ? '我方' : '对手'} ${s ? s.counts[i] + '张' : p.ready ? '已准备' : '未准备'}` : '空位', x, 168, 10, color);
        const effect = s?.effects.find(e => (e.type === 'dance' ? e.actor : e.target) === i);
        if (p) text(p.bot ? '电脑 · 自动出牌' : !p.online ? '断线/托管' : effect ? ({ graffiti: '✎涂鸦', dance: '♪挑衅舞', mute: '禁言标记', title: '接招王' }[effect.type]) : `等级${p.level} · 徽章${p.badges}`, x, 182, 9, C.gold);
        if (p && state.host === uid && p.uid !== uid && (!s || ['result', 'reward'].includes(s.phase))) b(p.bot ? '移除电脑' : '请出', x, 191, 62, 24, 'kick', p.uid);
      });
      {
        const seconds = Math.max(0, Math.ceil((s.deadline - state.serverTime) / 1000));
        text(`闲家${s.score}/80 · 庄家队${s.teamScores[s.dealer % 2] || 0}分 · 剩余${seconds}秒`, 22, 225, 12, C.muted);
        if (s.phase === 'vote') {
          text('无人叫主：3票同意重新发牌', 22, 270, 18, C.gold);
          const voted = Object.prototype.hasOwnProperty.call(s.votes, state.seat);
          b('同意重发', 22, 320, 155, 45, 'vote', true, false, !voted);
          b('继续这副牌', 192, 320, 155, 45, 'vote', false, false, !voted);
          text(`已有${Object.keys(s.votes).length}人投票，超时算不同意`, 22, 390, 12, C.muted);
        } else if (s.phase === 'bury') {
          text(s.dealer === state.seat ? '拿到8张底牌，请任选8张扣回' : '等待庄家扣底', 22, 275, 19, C.gold);
          if (s.dealer === state.seat) lineCards(s.pickedBottom, 22, 325, 8, 12, 40);
        } else if (['playing', 'trick'].includes(s.phase)) {
          const trick = showPrevious ? s.previousTrick : s.trick;
          text(`第${s.round}墩 · ${s.turn === state.seat ? '轮到你' : '等待牌友'}`, 22, 250, 15, C.gold);
          trick.forEach((t, i) => {
            const y = 276 + i * 42;
            text(`${t.player === state.seat ? '你' : state.members[t.player]?.name || '牌友'}${s.phase === 'trick' && s.trickWinner === t.player && !showPrevious ? '·赢' : ''}`, 22, y, 10, C.gold);
            lineCards(t.cards, 100, y, 11, 11, 22);
          });
          if (s.phase === 'trick' && !showPrevious) text(`${s.trickPoints}分 · ${R.explainTrick(s.trick, s.trickWinner, s)}`, 22, 438, 10, C.gold);
          if (s.previousTrick.length) b(showPrevious ? '返回本墩' : '上一墩', 265, 239, 82, 24, 'previous');
        } else if (s.phase === 'result') {
          const r = s.result;
          text(`${r.winningParity === state.seat % 2 ? '我方' : '对方'}${r.progress.side === 'dealer' ? '守庄成功' : '上台成功'}`, 22, 270, 23, C.gold);
          text(`${r.ordinaryScore} + ${r.bottomPoints} × ${r.multiplier} = ${s.score}分`, 22, 310, 15);
          text(r.progress.levels ? `获胜队升${r.progress.levels}级` : '41～79分：守庄成功，本局不升级', 22, 340, 14, C.gold);
          s.result.changes.forEach((c, i) => text(`${state.members[i]?.name || '牌友'} ${c.before}→${c.after} · 新徽章${c.badges}`, 22, 375 + i * 22, 12));
          text('底牌公开', 22, 476, 12, C.gold); lineCards(s.bottom, 22, 500, 8, 11, 40);
          if (r.winningParity === state.seat % 2) {
            [0, 1, 2, 3].filter(i => i % 2 !== r.winningParity).forEach((i, n) => b(state.members[i]?.name || '牌友', 22 + n * 170, 530, 155, 32, 'choice', { target: i }, s.choice.target === i));
            Object.keys(EFFECTS).forEach((e, i) => b(EFFECTS[e], 22 + i % 2 * 170, 572 + Math.floor(i / 2) * 40, 155, 34, 'choice', { effect: e }, s.choice.effect === e));
            b('确认互动卡（全队共一张）', 22, 670, 325, 46, 'use', null, true);
          } else text('等待赢家选择互动卡，超时自动放弃', 22, 565, 14, C.muted);
        }
        if (!['result'].includes(s.phase)) {
          drawHand(s);
        }
      }
    }
    // Long errors wrap instead of disappearing off the edge of the screen.
    Array.from(status).join('').match(/.{1,29}/g)?.slice(0, 2).forEach((line, i) => text(line, 22, 733 + i * 14, 11, C.gold));
    return true;
  }
  function hide() { hidden = true; generation++; busy = false; clearTimeout(reconnect); socket?.close({}); socket = null; uid = ''; }
  function show(query) { hidden = false; if (query?.room && !enabled) enter(query); else if (enabled) connect(); }
  return { enter, action, draw, hide, show, enabled: () => enabled };
}
module.exports = { createOnline };
