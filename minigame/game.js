const { createGame, EFFECTS } = require('./round');
const R = require('./rules');
const { createOnline } = require('./online');
const { createLivingRoom } = require('./living-room');
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
let storageWarning = '';
let progress;
try { progress = wx.getStorageSync('upgrade-personal-progress-v1'); } catch (error) { storageWarning = '本机存储不可用'; }
const game = createGame({ progress, saveProgress: value => {
  try { wx.setStorageSync('upgrade-personal-progress-v1', value); }
  catch (error) { storageWarning = '等级保存失败，本次仅会话有效'; }
} });
const C = { bg: '#102621', panel: '#1b3930', gold: '#e6c57b', ink: '#f6f0df', muted: '#a9bdb0', red: '#ed8882', team: '#86d4bf' };
let areas = [], viewport = { scale: 1, x: 0, y: 0 }, visible = true, frame = null;
let lastAuto = Date.now();
let animationOn = true;
const W = 375, H = 760;
const online = createOnline({ wx, text, box, button, lineCards, requestRender, colors: C,
  hit: area => areas.push(area) });
const warm = { bg: '#f5ebdd', panel: '#ead8ba', gold: '#825421', ink: '#283238', muted: '#665b4f', red: '#b83249', team: '#236b80' };
const room = createLivingRoom({ wx, ctx, text, box, lineCards, requestRender, colors: warm });
function text(label, x, y, size = 14, color = C.ink, align = 'left') {
  ctx.fillStyle = color; ctx.font = `${size}px sans-serif`; ctx.textAlign = align;
  ctx.textBaseline = 'middle'; ctx.fillText(String(label), x, y);
}
function box(x, y, w, h, color, radius = 10) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
}
function button(label, x, y, w, h, action, value, selected = false, enabled = true) {
  const local = !action.startsWith('online:');
  const primary = local && enabled && selected;
  box(x, y, w, h, primary ? '#e99a39' : selected ? C.gold : C.panel);
  text(label, x + w / 2, y + h / 2, 14, !enabled ? C.muted : primary ? '#283238' : selected ? C.bg : C.ink, 'center');
  if (enabled) areas.push({ x, y, w, h, action, value });
}
function heading(kicker, title, sub) {
  text(kicker, 22, 115, 12, C.gold); text(title, 22, 151, 26);
  text(sub, 22, 184, 12, C.muted);
}
function label(card) { return card.rank === 'SJ' ? '小王' : card.rank === 'BJ' ? '大王' : card.suit + card.rank; }
function lineCards(cards, x, y, perLine = 10, size = 12, step = 29) {
  cards.forEach((c, i) => {
    const cx = x + i % perLine * step, cy = y + Math.floor(i / perLine) * (size + 5);
    box(cx - 2, cy - size / 2 - 1, step - 2, size + 3, '#f7f2e7', 3);
    text(label(c), cx, cy, size,
      c.suit === '♥' || c.suit === '♦' || c.rank === 'BJ' ? '#b52f36' : '#223129');
  });
}
function hand(s, selectable = false) {
  box(14, 456, 347, 202, '#f4e7cc', 14);
  text(`你的手牌 ${s.hands[0].length} 张 · 已选 ${s.selected.length} 张`, 22, 464, 13, C.gold);
  s.hands[0].forEach((c, i) => {
    const x = 22 + i % 11 * 30, y = 488 + Math.floor(i / 11) * 54 - (s.selected.includes(c.id) ? 7 : 0);
    if (s.selected.includes(c.id)) box(x - 2, y - 2, 31, 52, '#367e95', 5);
    box(x, y, 27, 48, '#f7f2e7', 4);
    const red = c.suit === '♥' || c.suit === '♦' || c.rank === 'BJ';
    const color = red ? '#bb3939' : '#22392d';
    text(c.rank === 'SJ' ? '小' : c.rank === 'BJ' ? '大' : c.rank, x + 4, y + 14, 15, color);
    text(c.suit === 'J' ? '王' : c.suit, x + 4, y + 32, 17, color);
    if (R.category(c, s) === 'T') {
      text(c.suit === 'J' ? '王' : c.rank === s.level ? '级' : '主', x + 22, y + 38, 8, '#8a641b', 'center');
    }
    if (selectable) areas.push({ x, y, w: 27, h: 48, action: 'select', value: c.id });
  });
}
function effectFor(s, player) {
  return s.effects.find(e => e.target === player);
}
function seats(s) {
  [0, 1, 2, 3].forEach((i) => {
    const x = 22 + i * 85, p = s.players[i], e = effectFor(s, i);
    let mark = e ? ({ graffiti: '✎', mute: '×', title: '接招王', dance: '♪' }[e.type]) : '';
    const teamColor = i % 2 === 0 ? C.team : C.red;
    text(`${p.name}${s.dealer === i ? '·庄' : ''}`, x, 149, 11, teamColor);
    text(`${i === 0 ? '你' : i === 2 ? '队友' : '对手'} ${s.hands[i].length}张 ${mark}`, x, 167, 10, teamColor);
    if (s.turn === i) text('行动中', x, 181, 9, C.gold);
  });
}
function needsAuto(s) {
  return s.phase === 'dealing' || s.phase === 'bury' && s.dealer !== 0 ||
    s.phase === 'playing' && s.turn !== 0;
}
function render() {
  frame = null;
  if (!visible) return;
  const s = game.state;
  if (needsAuto(s) && Date.now() - lastAuto >= (s.phase === 'dealing' ? 240 : 650)) {
    game.act('tick'); lastAuto = Date.now();
  }
  areas = [];
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const width = info.windowWidth, height = info.windowHeight, ratio = info.pixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, width, height);
  let top = Math.max(12, info.safeArea ? info.safeArea.top : 24);
  if (wx.getMenuButtonBoundingClientRect) {
    const menu = wx.getMenuButtonBoundingClientRect(); if (menu && menu.bottom) top = Math.max(top, menu.bottom + 8);
  }
  const bottom = info.safeArea ? Math.max(12, (info.screenHeight || height) - info.safeArea.bottom) : 16;
  const scale = Math.min(width / W, (height - top - bottom) / H);
  viewport = { scale, x: (width - W * scale) / 2, y: top };
  ctx.translate(viewport.x, viewport.y); ctx.scale(scale, scale);
  Object.assign(C, { bg: '#102621', panel: '#1b3930', gold: '#e6c57b', ink: '#f6f0df', muted: '#a9bdb0', red: '#ed8882', team: '#86d4bf' });
  if (online.draw()) return;
  Object.assign(C, warm);
  room.background();
  text('♠ 熟人局升级', 20, 24, 23, C.gold);
  text('本地人机 · 你与对家陈皮组队', 20, 51, 12, C.muted);
  button(s.voice ? '模拟语音：开' : '模拟语音：关', 245, 10, 110, 40, 'voice');
  text(s.phase !== 'lobby' && s.levelPlayer !== undefined
    ? `本局采用${s.players[s.levelPlayer].name}的等级 · 打${s.level} · 本机保存`
    : '真实随机牌局 · 等级仅保存在本机', 20, 79, 12, C.gold);
  if (s.phase === 'lobby') {
    heading('FRIENDS TABLE · 人机练习', '今晚，来一局升级。', '两副牌 · 不反主 · 不甩牌 · 完整结算');
    s.players.forEach((p, i) => {
      const x = 25 + i % 2 * 170, y = 230 + Math.floor(i / 2) * 130;
      box(x, y, 155, 112, C.panel); text(p.name, x + 18, y + 30, 20, C.gold);
      text(`等级 ${p.level} · 徽章 ${p.badges}`, x + 18, y + 63, 13);
      text(i % 2 === 0 ? '你的队伍' : '对手队伍', x + 18, y + 88, 12, C.muted);
    });
    text('三名电脑按合法规则行动，不是固定脚本', 187, 552, 13, C.muted, 'center');
    text('好友联机请进入房间 · 暂无真实语音', 187, 579, 13, C.muted, 'center');
    button('开始这一局 →', 25, 670, 325, 46, 'start', null, true);
    button('好友联机房间 →', 25, 612, 325, 42, 'online:enter');
  } else if (['dealing', 'calling', 'call-window', 'vote', 'bury'].includes(s.phase)) {
    text(`本局打 ${s.level} · ${s.trump || '尚未定主'}`, 22, 113, 16, C.gold); seats(s);
    if (['dealing', 'calling', 'call-window'].includes(s.phase)) {
      text(s.phase === 'call-window' ? '你摸到级牌了，可以叫庄' : s.phase === 'dealing' ? `正在发牌 ${s.dealt} / 100` : '叫庄环节：请选择主花色', 22, 222, 22);
      const canCall = s.hands[0].some(c => c.rank === s.level);
      text(s.dealer >= 0 ? `${s.players[s.dealer].name}已叫主，不允许反主` : !canCall && s.phase === 'calling' ? '你没有级牌，无法主动叫庄，请点不叫' : '有对应级牌才能叫庄；你不叫后电脑才参与', 22, 255, 12, C.muted);
      R.SUITS.forEach((suit, i) => {
        const eligible = s.dealer < 0 && s.hands[0].some(c => c.rank === s.level && c.suit === suit);
        button(`${suit} ${eligible ? '叫庄' : '不可叫'}`, 22 + i % 2 * 170, 292 + Math.floor(i / 2) * 60,
          155, 46, 'trump', suit, eligible, eligible);
      });
      if (s.phase === 'calling') button('不叫 →', 22, 413, 325, 34, 'pass');
      if (s.phase === 'call-window') button('这次不叫，继续发牌 →', 22, 413, 325, 34, 'pass');
    } else if (s.phase === 'vote') {
      text('无人叫主，是否重新发牌？', 22, 230, 22);
      text('至少3票同意，否则系统指定主花色和庄家', 22, 268, 12, C.muted);
      button('同意重新发牌', 22, 316, 155, 54, 'vote', true);
      button('继续这副牌', 192, 316, 155, 54, 'vote', false, true);
    } else {
      text(s.dealer === 0 ? '请选择8张牌扣底' : `${s.players[s.dealer].name}正在扣底…`, 22, 236, 23);
      text('底牌不公开；末墩闲家获胜会抠底', 22, 277, 13, C.muted);
      if (s.dealer === 0) {
        text('你拿到的8张底牌（已加入下方手牌）', 22, 322, 13, C.gold);
        lineCards(s.pickedBottom, 22, 352, 8, 13, 41);
        text('现在共33张，任意选8张重新扣回，留下25张', 22, 398, 12, C.muted);
      }
    }
    hand(s, s.phase === 'bury' && s.dealer === 0);
    if (s.phase === 'bury' && s.dealer === 0) {
      button('清空', 22, 670, 75, 46, 'clear');
      button(`确认扣底 ${s.selected.length} / 8`, 107, 670, 240, 46, 'bury', null, s.selected.length === 8, s.selected.length === 8);
    }
  } else if (s.phase === 'playing' || s.phase === 'trick') {
    text(`第${s.round}墩 · ${s.trump}主 · 打${s.level} · 你是${s.dealer % 2 === 0 ? '庄家方' : '闲家方'}`, 22, 108, 14, C.gold);
    text(`闲家${s.dealer % 2 ? '（我方）' : '（对方）'} ${s.score}/80 · 庄家队累计 ${s.teamScores[s.dealer % 2]}分`, 22, 128, 12, C.muted);
    room.table(s);
    if (s.phase === 'trick') {
      text(`${s.players[s.trickWinner].name}赢墩 · 本墩${s.trickPoints}分 → ${s.trickWinner % 2 === s.dealer % 2 ? '庄家方' : '闲家方'}`,
        187, 452, 10, C.gold, 'center');
      text(R.explainTrick(s.trick, s.trickWinner, s), 22, 647, 10, C.muted);
    }
    if (s.error) {
      box(30, 252, 315, 137, '#fff1e1', 14);
      text('这手牌暂时不能出', 46, 276, 18, '#a33727');
      const chars = Array.from(s.error);
      for (let i = 0; i < chars.length; i += 19) {
        text(chars.slice(i, i + 19).join(''), 46, 307 + Math.floor(i / 19) * 21, 14);
      }
      text('重新选牌，或点「推荐」选择合法牌', 46, 369, 13, C.gold);
    }
    if (s.phase === 'playing' && s.trick.length) {
      const lead = R.shape(s.trick[0].cards, s);
      text(`首出：${lead.category === 'T' ? '主牌' : lead.category + '副牌'}${{ single: '单张', pair: '对子', tractor: '拖拉机' }[lead.type]} · 需跟${lead.count}张`, 22, 448, 11, C.gold);
    }
    hand(s, s.phase === 'playing' && s.turn === 0);
    if (s.phase === 'trick') {
      button(s.hands[0].length ? '下一墩 →' : '查看结算 →', 22, 670, 325, 46, 'continue', null, true);
    } else if (s.turn === 0) {
      button('推荐', 22, 670, 70, 46, 'hint'); button('清空', 102, 670, 65, 46, 'clear');
      button(`出牌 ${s.selected.length}张 →`, 177, 670, 170, 46, 'play', null, true);
    } else text(`${s.players[s.turn].name}正在出牌…`, 187, 692, 16, C.gold, 'center');
  } else if (s.phase === 'result') {
    const r = s.result;
    const outcome = r.progress.side === 'dealer' ? '守庄成功' : '上台成功';
    heading('ROUND COMPLETE · 真实结算', `${r.winningParity === 0 ? '我方' : '对方'}${outcome}`,
      `闲家 ${r.ordinaryScore} + 底分 ${r.bottomPoints} × ${r.multiplier} = ${s.score}分`);
    text(r.multiplier ? `闲家抠底加${r.bottomPoints * r.multiplier}分（末墩分已计入抓分）` : '庄家方赢末墩，底分不加入闲家抓分', 22, 199, 11, C.muted);
    text(r.progress.levels ? `${r.progress.side === 'dealer' ? '庄家方' : '闲家方'}升 ${r.progress.levels} 级` : '守庄成功，本局不升级', 22, 219, 20, C.gold);
    const range = s.score === 0 ? '0分：庄家升3级' : s.score <= 40 ? '1～40分：庄家升1级' : s.score < 80 ? '41～79分：守庄成功，不升级' : '80分起闲家升1级，每多40分加1级（最多4级）';
    text(`闲家${s.score}分 · ${range}`, 22, 238, 10, C.muted);
    s.players.forEach((p, i) => {
      const ch = r.changes[i];
      text(`${p.name}：${ch.before} → ${ch.after}   徽章 ${p.badges}${ch.badges ? '（新增）' : ''}`, 22, 266 + i * 29, 14);
    });
    text('底牌公开', 22, 385, 12, C.gold); lineCards(s.bottom, 22, 412, 8, 13, 41);
    if (r.winningParity === 0) {
      text('赢家队伍 · 一张互动卡', 22, 456, 14, C.gold);
      [1, 3].forEach((p, i) => button(s.players[p].name, 22 + i * 170, 478, 155, 38, 'target', p, s.target === p));
      Object.keys(EFFECTS).forEach((e, i) => button(EFFECTS[e], 22 + i % 2 * 170, 531 + Math.floor(i / 2) * 52,
        155, 40, 'effect', e, s.effect === e));
      button('确认使用这张卡 →', 22, 670, 325, 46, 'use', null, true);
    } else {
      text('电脑队伍已自动选择互动卡', 187, 550, 16, C.gold, 'center');
      button('查看对手的互动卡 →', 22, 670, 325, 46, 'use', null, true);
    }
  } else if (s.phase === 'reward') {
    const e = s.effects[0], actor = s.players[e.actor].name;
    heading('ONE CARD · 一张互动卡', '这一局，留下个记号。', `${actor}队伍对${s.players[e.target].name}使用「${EFFECTS[e.type]}」`);
    box(25, 235, 325, 230, C.panel, 28);
    const isDance = e.type === 'dance';
    text(isDance ? actor : s.players[e.target].name, 187, 286, 23, C.gold, 'center');
    text({ graffiti: '✎ ╳ ✎', dance: '♪  ♫  ♪', mute: '× 禁言标记', title: '本局接招王' }[e.type],
      187 + (isDance && animationOn ? Math.sin(Date.now() / 170) * 15 : 0), 356, 32, C.gold, 'center');
    text('本地效果 · 不会采集或限制真实麦克风', 187, 422, 12, C.muted, 'center');
    if (isDance) button(animationOn ? '关闭动画' : '开启动画', 107, 493, 160, 40, 'animation');
    text('默认留在房间，下一局继续', 187, 568, 16, C.gold, 'center');
    text('涂鸦、称号与禁言标记持续至下一局结束', 187, 601, 12, C.muted, 'center');
    button('再来一局 →', 25, 670, 325, 46, 'next', null, true);
  }
  const dance = s.effects.find(e => e.type === 'dance');
  if (dance && s.phase === 'dealing' && animationOn) text('♪', 345 + Math.sin(Date.now() / 170) * 5, 115, 24, C.gold);
  text(storageWarning || s.toast, 187, 741, 11, C.muted, 'center');
  if (needsAuto(s) || animationOn && dance && ['reward', 'dealing'].includes(s.phase)) requestRender();
}
function requestRender() { if (frame === null && visible) frame = requestAnimationFrame(render); }
wx.onTouchStart(event => {
  const touch = event.touches[0]; if (!touch || !visible) return;
  const x = (touch.clientX - viewport.x) / viewport.scale, y = (touch.clientY - viewport.y) / viewport.scale;
  const area = areas.slice().reverse().find(a => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h);
  if (area) {
    if (area.action.startsWith('online:')) online.action(area.action.slice(7), area.value);
    else if (area.action === 'animation') animationOn = !animationOn;
    else game.act(area.action, area.value);
    lastAuto = Date.now(); requestRender();
  }
});
wx.onShow(event => { visible = true; lastAuto = Date.now(); online.show(event?.query); requestRender(); });
wx.onHide(() => { online.hide(); visible = false; if (frame !== null) cancelAnimationFrame(frame); frame = null; });
if (wx.onWindowResize) wx.onWindowResize(requestRender);
if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
const launch = wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : null;
if (launch?.query?.room) online.enter(launch.query);
render();
