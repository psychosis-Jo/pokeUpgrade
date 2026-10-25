const R = require('./rules');
const EFFECTS = { graffiti: '头像涂鸦', dance: '挑衅舞', mute: '下一局禁言', title: '临时称号' };
const NAMES = ['你', '临时牌友', '陈皮', '小北']; // 下→右→上→左，逆时针
function createGame(options = {}) {
  const random = options.random || Math.random;
  const saved = options.progress;
  const players = NAMES.map((name, i) => ({ name,
    level: saved && saved[i] && R.LEVELS.includes(saved[i].level) ? saved[i].level : '2',
    badges: saved && saved[i] && Number.isInteger(saved[i].badges) && saved[i].badges >= 0 ? saved[i].badges : 0 }));
  const state = { phase: 'lobby', players, voice: false, hands: [[], [], [], []], selected: [],
    level: '2', trump: '', dealer: -1, turn: -1, round: 1, score: 0, teamScores: [0, 0], trick: [],
    bottom: [], pickedBottom: [], offeredSuits: [], deck: [], dealt: 0, captured: [], votes: [], effects: [],
    effect: 'dance', target: 1, error: '', toast: '本地人机 · 对家陈皮是你的队友', result: null };
  const pick = pool => pool[Math.floor(random() * pool.length)];
  function start() {
    const levelPlayer = Math.floor(random() * 4);
    Object.assign(state, { phase: 'dealing', hands: [[], [], [], []], selected: [],
      level: players[levelPlayer].level, levelPlayer, trump: '', dealer: -1, turn: -1,
      round: 1, score: 0, teamScores: [0, 0], trick: [], bottom: [], pickedBottom: [], offeredSuits: [], deck: R.shuffle(R.createDeck(), random),
      dealt: 0, captured: [], votes: [], result: null, effect: 'dance', target: 1, error: '',
      toast: `本局采用${players[levelPlayer].name}的等级，打 ${players[levelPlayer].level}` });
  }
  function sort() { state.hands = state.hands.map(h => R.sortHand(h, state)); }
  function call(player, suit) {
    if (state.dealer !== -1 || !R.SUITS.includes(suit) || !state.hands[player].some(c => c.rank === state.level && c.suit === suit)) return false;
    state.trump = suit; state.dealer = player;
    state.toast = `${players[player].name}叫${suit}主，成为庄家`;
    sort(); return true;
  }
  function enterBury() {
    state.pickedBottom = state.bottom.slice();
    state.hands[state.dealer].push(...state.bottom); state.bottom = [];
    state.phase = 'bury'; state.selected = []; sort();
    state.toast = `${players[state.dealer].name}坐庄，选8张扣底`;
  }
  function bury(ids) {
    const hand = state.hands[state.dealer];
    if (ids.length !== 8 || new Set(ids).size !== 8 || ids.some(id => !hand.some(c => c.id === id))) {
      state.toast = '请恰好选择8张底牌'; return;
    }
    state.bottom = hand.filter(c => ids.includes(c.id));
    state.hands[state.dealer] = hand.filter(c => !ids.includes(c.id));
    state.selected = []; state.phase = 'playing'; state.turn = state.dealer;
    state.toast = '扣底完成，庄家领出';
  }
  function settle() {
    const ordinaryScore = state.score;
    const lastWinner = state.trickWinner;
    const multiplier = lastWinner % 2 !== state.dealer % 2 ? R.bottomMultiplier(state.trick[0].cards, state) : 0;
    const bottomPoints = R.points(state.bottom);
    state.score += bottomPoints * multiplier;
    const progress = R.calculateRoundProgress(state.score);
    const winningParity = progress.side === 'dealer' ? state.dealer % 2 : 1 - state.dealer % 2;
    const changes = players.map((p, i) => {
      const before = p.level;
      const gain = i % 2 === winningParity ? progress.levels : 0;
      const next = R.nextLevel(p.level, gain);
      p.level = next.level; p.badges += next.badges;
      return { before, after: p.level, gain, badges: next.badges };
    });
    state.result = { ordinaryScore, multiplier, bottomPoints, winningParity, progress, changes };
    state.phase = 'result'; state.effects = []; state.selected = [];
    state.toast = state.score < 80 ? '庄家方守庄成功' : '闲家方上台成功';
    if (options.saveProgress) options.saveProgress(players.map(p => ({ level: p.level, badges: p.badges })));
    if (winningParity !== 0) { state.target = pick([0, 2]); state.effect = pick(Object.keys(EFFECTS)); }
  }
  function play(player, cards) {
    if (state.phase !== 'playing' || state.turn !== player) return false;
    const lead = state.trick.length ? state.trick[0].cards : [];
    const error = R.validatePlay(state.hands[player], cards, lead, state);
    if (error) { state.toast = error; state.error = error; return false; }
    state.error = '';
    const ids = new Set(cards.map(c => c.id));
    state.hands[player] = state.hands[player].filter(c => !ids.has(c.id));
    state.trick.push({ player, cards }); state.selected = [];
    if (state.trick.length < 4) { state.turn = (player + 1) % 4; state.toast = `轮到${players[state.turn].name}出牌`; }
    else {
      let winner = state.trick[0];
      state.trick.slice(1).forEach(entry => { if (R.beats(entry.cards, winner.cards, lead.length ? lead : cards, state)) winner = entry; });
      const trickCards = state.trick.flatMap(t => t.cards), score = R.points(trickCards);
      state.captured.push(...trickCards); state.trickWinner = winner.player; state.trickPoints = score;
      state.teamScores[winner.player % 2] += score;
      if (winner.player % 2 !== state.dealer % 2) state.score += score;
      state.phase = 'trick'; state.turn = -1;
      state.toast = winner.player % 2 === state.dealer % 2
        ? `${players[winner.player].name}赢墩，庄家方收${score}分，闲家不加分`
        : `${players[winner.player].name}赢墩，闲家加${score}分，累计${state.score}分`;
    }
    return true;
  }
  function useEffect() {
    if (state.phase !== 'result') return;
    state.effects.push({ type: state.effect, target: state.target, actor: state.result.winningParity, expiresAfterRound: true });
    state.phase = 'reward'; state.toast = `已使用「${EFFECTS[state.effect]}」`;
  }
  function tick() {
    if (state.phase === 'dealing') {
      // 最后一批发完后仍可能停在叫主窗口，恢复时不要重复发牌。
      if (state.dealt === 100) { finishDeal(); return; }
      for (let i = 0; i < 4; i++) state.hands[i].push(state.deck[state.dealt++]);
      const newSuits = state.hands[0].filter(c => c.rank === state.level && !state.offeredSuits.includes(c.suit)).map(c => c.suit);
      if (state.dealer < 0 && newSuits.length) {
        state.offeredSuits.push(...newSuits); sort(); state.phase = 'call-window';
        state.toast = '你摸到了级牌，发牌已暂停：可以叫主或继续发牌'; return;
      }
      // 人机演示中，电脑等真人完成最终叫庄选择后才参与，避免抢过操作窗口。
      sort();
      if (state.dealt === 100) finishDeal();
    } else if (state.phase === 'bury' && state.dealer !== 0) {
      const cards = state.hands[state.dealer].slice().sort((a, b) =>
        (R.category(a, state) === 'T') - (R.category(b, state) === 'T') || R.points([b]) - R.points([a]) || R.power(a, state) - R.power(b, state));
      bury(cards.slice(0, 8).map(c => c.id));
    } else if (state.phase === 'playing' && state.turn !== 0) {
      const lead = state.trick.length ? state.trick[0].cards : [];
      play(state.turn, R.suggest(state.hands[state.turn], lead, state));
    }
  }
  function finishDeal() {
    state.bottom = state.deck.slice(100); state.deck = [];
    if (state.dealer >= 0) enterBury(); else { state.phase = 'calling'; state.toast = '发牌结束，你可叫主或不叫'; }
  }
  function act(action, value) {
    if (action === 'voice') { state.voice = !state.voice; state.toast = '语音模拟开关，不采集麦克风'; }
    if (action === 'start' && state.phase === 'lobby' || action === 'next' && state.phase === 'reward') start();
    if (action === 'tick') tick();
    if (action === 'trump' && ['dealing', 'calling', 'call-window'].includes(state.phase)) {
      if (!call(0, value)) state.toast = state.dealer >= 0 ? '已确定庄家，不能反主' : '你尚未持有该花色级牌';
      else if (state.phase === 'calling') enterBury();
      else if (state.phase === 'call-window') state.phase = 'dealing';
    }
    if (action === 'pass' && state.phase === 'call-window') { state.phase = 'dealing'; state.toast = '继续发牌'; return; }
    if (action === 'pass' && state.phase === 'calling') {
      for (let i = 1; i < 4 && state.dealer < 0; i++) {
        const suits = state.hands[i].filter(c => c.rank === state.level).map(c => c.suit);
        if (suits.length && random() < 0.6) call(i, pick(suits));
      }
      if (state.dealer >= 0) enterBury();
      else { state.phase = 'vote'; state.toast = '无人叫主，至少3票同意才重新发牌'; }
    }
    if (action === 'vote' && state.phase === 'vote') {
      state.votes = [!!value, ...[1, 2, 3].map(() => random() < 0.5)];
      const count = state.votes.filter(Boolean).length;
      if (count >= 3) { start(); state.toast = `${count}票同意，重新发牌`; }
      else {
        state.trump = pick(R.SUITS);
        const eligible = [0, 1, 2, 3].filter(i => state.hands[i].some(c => c.rank === state.level && c.suit === state.trump));
        state.dealer = pick(eligible.length ? eligible : [0, 1, 2, 3]);
        enterBury(); state.toast = `${count}票同意，不重发；系统指定${players[state.dealer].name}坐庄`;
      }
    }
    if (action === 'select' && (state.phase === 'bury' && state.dealer === 0 || state.phase === 'playing' && state.turn === 0)) {
      if (state.hands[0].some(c => c.id === value)) {
        state.error = '';
        state.selected = state.selected.includes(value) ? state.selected.filter(id => id !== value) : [...state.selected, value];
      }
    }
    if (action === 'clear') { state.selected = []; state.error = ''; }
    if (action === 'hint' && state.phase === 'playing' && state.turn === 0) {
      state.error = '';
      state.selected = R.suggest(state.hands[0], state.trick.length ? state.trick[0].cards : [], state).map(c => c.id);
      state.toast = '已选出一组合法牌，你可以调整后出牌';
    }
    if (action === 'bury' && state.phase === 'bury' && state.dealer === 0) bury(state.selected);
    if (action === 'play' && state.phase === 'playing' && state.turn === 0) play(0, state.hands[0].filter(c => state.selected.includes(c.id)));
    if (action === 'continue' && state.phase === 'trick') {
      if (state.hands.every(h => !h.length)) settle();
      else { state.phase = 'playing'; state.turn = state.trickWinner; state.round++; state.trick = []; state.toast = `${players[state.turn].name}领出`; }
    }
    if (state.phase === 'result' && state.result.winningParity === 0) {
      if (action === 'effect' && Object.prototype.hasOwnProperty.call(EFFECTS, value)) state.effect = value;
      if (action === 'target' && [1, 3].includes(value)) state.target = value;
      if (action === 'use') useEffect();
    }
    if (state.phase === 'result' && state.result.winningParity !== 0 && action === 'use') useEffect();
  }
  return { state, act };
}
module.exports = { createGame, EFFECTS, NAMES };
