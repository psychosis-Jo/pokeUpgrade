const crypto = require('node:crypto');
const R = require('../minigame/rules');
const effects = ['graffiti', 'dance', 'mute', 'title'];
const pick = (xs, random) => xs[Math.floor(random() * xs.length)];
function start(players, now, random = Math.random) {
  const levelPlayer = Math.floor(random() * 4);
  return { id: crypto.randomUUID(), phase: 'dealing', levelPlayer, level: players[levelPlayer].level,
    trump: '', dealer: -1, hands: [[], [], [], []], deck: R.shuffle(R.createDeck(), random), dealt: 0,
    bottom: [], pickedBottom: [], trick: [], previousTrick: [], turn: -1, round: 1,
    score: 0, teamScores: [0, 0], votes: {}, effects: [], result: null, deadline: now + 240 };
}
function enterBury(s, now) {
  s.pickedBottom = s.bottom.slice(); s.hands[s.dealer].push(...s.bottom); s.bottom = [];
  s.phase = 'bury'; s.deadline = now + 60000;
}
function nextTrick(s, now) {
  s.previousTrick = s.trick; s.trick = []; s.turn = s.trickWinner;
  s.round++; s.phase = 'playing'; s.deadline = now + 30000;
}
function settle(s, players, now) {
  const ordinaryScore = s.score;
  const multiplier = s.trickWinner % 2 !== s.dealer % 2 ? R.bottomMultiplier(s.trick[0].cards, s) : 0;
  const bottomPoints = R.points(s.bottom); s.score += bottomPoints * multiplier;
  const progress = R.calculateRoundProgress(s.score);
  const winningParity = progress.side === 'dealer' ? s.dealer % 2 : 1 - s.dealer % 2;
  const changes = players.map((p, i) => {
    const before = p.level, gain = !p.bot && i % 2 === winningParity ? progress.levels : 0;
    const next = R.nextLevel(before, gain); p.level = next.level; p.badges += next.badges;
    return { before, after: p.level, gain, badges: next.badges };
  });
  s.result = { ordinaryScore, multiplier, bottomPoints, progress, winningParity, changes };
  s.effects = [];
  s.phase = 'result'; s.choice = { effect: 'dance', target: 1 - winningParity }; s.deadline = now + 30000;
}
function voteDone(s, players, now, random) {
  if (Object.values(s.votes).filter(Boolean).length >= 3) return Object.assign(s, start(players, now, random));
  s.trump = pick(R.SUITS, random);
  const eligible = [0, 1, 2, 3].filter(i => s.hands[i].some(c => c.rank === s.level && c.suit === s.trump));
  s.dealer = pick(eligible.length ? eligible : [0, 1, 2, 3], random); enterBury(s, now);
}
function action(s, players, seat, type, value, now, random = Math.random) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw Error('不在牌局中');
  if (type === 'trump' && ['dealing', 'calling'].includes(s.phase)) {
    if (s.dealer !== -1) throw Error('已定庄，不允许反主');
    if (!R.SUITS.includes(value) || !s.hands[seat].some(c => c.rank === s.level && c.suit === value)) throw Error('没有该花色级牌');
    s.dealer = seat; s.trump = value;
    if (s.phase === 'calling') enterBury(s, now);
  } else if (type === 'vote' && s.phase === 'vote') {
    if (Object.hasOwn(s.votes, seat)) throw Error('已经投票');
    if (typeof value !== 'boolean') throw Error('投票值无效');
    s.votes[seat] = value;
    if (Object.keys(s.votes).length === 4 || Object.values(s.votes).filter(Boolean).length >= 3) voteDone(s, players, now, random);
  } else if (type === 'bury' && s.phase === 'bury' && s.dealer === seat) {
    const cards = resolve(s.hands[seat], value);
    if (cards.length !== 8) throw Error('必须扣8张底牌');
    s.bottom = cards; s.hands[seat] = s.hands[seat].filter(c => !value.includes(c.id));
    s.pickedBottom = []; s.turn = seat; s.phase = 'playing'; s.deadline = now + 30000;
  } else if (type === 'play' && s.phase === 'playing' && s.turn === seat) {
    const cards = resolve(s.hands[seat], value), lead = s.trick.length ? s.trick[0].cards : [];
    const error = R.validatePlay(s.hands[seat], cards, lead, s); if (error) throw Error(error);
    s.hands[seat] = s.hands[seat].filter(c => !value.includes(c.id)); s.trick.push({ player: seat, cards });
    if (s.trick.length < 4) { s.turn = (seat + 1) % 4; s.deadline = now + 30000; }
    else {
      let win = s.trick[0];
      for (const t of s.trick.slice(1)) if (R.beats(t.cards, win.cards, s.trick[0].cards, s)) win = t;
      s.trickWinner = win.player; s.trickPoints = R.points(s.trick.flatMap(t => t.cards));
      s.teamScores[win.player % 2] += s.trickPoints;
      if (win.player % 2 !== s.dealer % 2) s.score += s.trickPoints;
      s.phase = 'trick'; s.deadline = now + 3000;
    }
  } else if (['choice', 'use'].includes(type) && s.phase === 'result' && seat % 2 === s.result.winningParity) {
    if (type === 'choice') {
      if (!value || !effects.includes(value.effect) || !Number.isInteger(value.target) || value.target < 0 || value.target > 3 || value.target % 2 === s.result.winningParity) throw Error('互动选择无效');
      s.choice = { effect: value.effect, target: value.target };
    } else { s.effects = [{ ...s.choice, type: s.choice.effect, actor: seat }]; s.phase = 'reward'; s.deadline = 0; }
  } else throw Error('当前不能执行此操作');
}
function resolve(hand, ids) {
  if (!Array.isArray(ids) || ids.length > 33 || new Set(ids).size !== ids.length) throw Error('牌ID无效');
  return ids.map(id => { const c = hand.find(c => c.id === id); if (!c) throw Error('不是你的手牌'); return c; });
}
function tick(s, players, now, random = Math.random) {
  if (botDue(s, players, now)) {
    if (s.phase === 'calling') {
      const seat = players.findIndex((p, i) => p.bot && s.hands[i].some(c => c.rank === s.level && R.SUITS.includes(c.suit)));
      action(s, players, seat, 'trump', s.hands[seat].find(c => c.rank === s.level && R.SUITS.includes(c.suit)).suit, now, random);
    } else if (s.phase === 'vote') {
      const seat = players.findIndex((p, i) => p.bot && !Object.hasOwn(s.votes, i));
      action(s, players, seat, 'vote', false, now, random);
    } else if (s.phase === 'bury') action(s, players, s.dealer, 'bury', s.hands[s.dealer].slice(0, 8).map(c => c.id), now, random);
    else action(s, players, s.turn, 'play', R.suggest(s.hands[s.turn], s.trick[0]?.cards || [], s).map(c => c.id), now, random);
    return true;
  }
  if (!s.deadline || now < s.deadline) return false;
  if (s.phase === 'dealing') {
    for (let i = 0; i < 4; i++) s.hands[i].push(s.deck[s.dealt++]);
    s.deadline = now + 240;
    if (s.dealt === 100) {
      s.bottom = s.deck.slice(100); s.deck = [];
      if (s.dealer >= 0) enterBury(s, now);
      else { s.phase = 'calling'; s.deadline = now + 15000; }
    }
  } else if (s.phase === 'calling') { s.phase = 'vote'; s.deadline = now + 20000; }
  else if (s.phase === 'vote') voteDone(s, players, now, random);
  else if (s.phase === 'bury') action(s, players, s.dealer, 'bury', s.hands[s.dealer].slice(0, 8).map(c => c.id), now, random);
  else if (s.phase === 'playing') action(s, players, s.turn, 'play', R.suggest(s.hands[s.turn], s.trick.length ? s.trick[0].cards : [], s).map(c => c.id), now, random);
  else if (s.phase === 'trick') {
    if (s.hands.every(h => !h.length)) settle(s, players, now); else nextTrick(s, now);
  } else if (s.phase === 'result') { s.phase = 'reward'; s.deadline = 0; }
  else return false;
  return true;
}
function botDue(s, players, now) {
  if (!s) return false;
  if (s.phase === 'calling') return now >= s.deadline - 13500 && players.some((p, i) => p?.bot && s.hands[i].some(c => c.rank === s.level && R.SUITS.includes(c.suit)));
  if (s.phase === 'vote') return now >= s.deadline - 18500 && players.some((p, i) => p?.bot && !Object.hasOwn(s.votes, i));
  if (s.phase === 'bury') return !!players[s.dealer]?.bot && now >= s.deadline - 58500;
  if (s.phase === 'playing') return !!players[s.turn]?.bot && now >= s.deadline - 28800;
  return false;
}
module.exports = { start, action, tick, botDue };
