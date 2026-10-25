const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../minigame/round');
const R = require('../minigame/rules');
function rng(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function advance(game) {
  const s = game.state;
  switch (s.phase) {
    case 'lobby': game.act('start'); break;
    case 'dealing': game.act('tick'); break;
    case 'calling': game.act('pass'); break;
    case 'call-window': game.act('pass'); break;
    case 'vote': game.act('vote', false); break;
    case 'bury':
      if (s.dealer === 0) { s.hands[0].slice(0, 8).forEach(c => game.act('select', c.id)); game.act('bury'); }
      else game.act('tick');
      break;
    case 'playing':
      if (s.turn === 0) { game.act('hint'); game.act('play'); }
      else game.act('tick');
      break;
    case 'trick': game.act('continue'); break;
    default: break;
  }
}
test('100种随机种子打完整局，牌数与原始分守恒，结算仅一次', () => {
  let ownDealer = 0, ownWins = 0, tractorCount = 0;
  for (let seed = 1; seed <= 100; seed++) {
    let saves = 0;
    const game = createGame({ random: rng(seed), saveProgress: () => saves++ });
    const s = game.state;
    for (let step = 0; s.phase !== 'result' && step < 1000; step++) {
      if (seed % 2 === 0 && s.phase === 'dealing' && s.dealer < 0) {
        const card = s.hands[0].find(c => c.rank === s.level);
        if (card) game.act('trump', card.suit);
      }
      if (s.phase === 'playing') {
        const lead = s.trick.length ? s.trick[0].cards : [];
        const cards = R.suggest(s.hands[s.turn], lead, s);
        assert.equal(R.validatePlay(s.hands[s.turn], cards, lead, s), '');
        if (R.shape(cards, s)?.type === 'tractor') tractorCount++;
      }
      advance(game);
      if (['bury', 'playing', 'trick', 'result'].includes(s.phase)) {
        const all = [...s.hands.flat(), ...s.bottom, ...s.captured,
          ...(s.phase === 'playing' ? s.trick.flatMap(t => t.cards) : [])];
        assert.equal(all.length, 108, `seed=${seed} phase=${s.phase}`);
        assert.equal(new Set(all.map(c => c.id)).size, 108);
        assert.equal(R.points(all), 200);
      }
    }
    assert.equal(s.phase, 'result', `卡住 seed=${seed}`);
    assert.ok(s.hands.every(h => h.length === 0));
    assert.equal(s.captured.length, 100); assert.equal(s.bottom.length, 8);
    assert.equal(s.teamScores[0] + s.teamScores[1] + R.points(s.bottom), 200);
    assert.equal(s.result.ordinaryScore, s.teamScores[1 - s.dealer % 2]);
    assert.equal(saves, 1);
    assert.equal(s.score, s.result.ordinaryScore + s.result.bottomPoints * s.result.multiplier);
    const score = s.score; game.act('continue'); assert.equal(s.score, score); assert.equal(saves, 1);
    if (s.dealer === 0) ownDealer++;
    if (s.result.winningParity === 0) ownWins++;
    game.act('use');
    assert.equal(s.phase, 'reward'); assert.equal(s.effects.length, 1);
    game.act('use'); assert.equal(s.effects.length, 1);
    game.act('next'); assert.equal(s.phase, 'dealing'); assert.equal(s.effects.length, 1);
  }
  assert.ok(ownDealer && ownWins && tractorCount);
});
test('本机等级恢复、非法叫主/扣底和重复行动被拒绝', () => {
  const game = createGame({ random: rng(7), progress: [{ level: 'K', badges: 3 }] });
  assert.equal(game.state.players[0].level, 'K');
  assert.equal(game.state.players[0].badges, 3);
  game.act('start'); const before = game.state.hands[0].length;
  game.act('trump', '♥'); assert.equal(game.state.dealer, -1);
  game.act('play'); game.act('bury'); assert.equal(game.state.hands[0].length, before);
});
test('有级牌才能叫主、首叫即庄且不能反主，扣底张数严格校验', () => {
  const g = createGame({ random: rng(5) }), s = g.state;
  g.act('start');
  s.hands[0] = [{ suit: '♥', rank: s.level, id: 'level' }];
  g.act('trump', '♠'); assert.equal(s.dealer, -1);
  g.act('trump', '♥'); assert.equal(s.dealer, 0); assert.equal(s.trump, '♥');
  s.hands[0].push({ suit: '♠', rank: s.level, id: 'another-level' });
  g.act('trump', '♠'); assert.equal(s.trump, '♥');
  s.phase = 'bury'; const count = s.hands[0].length;
  g.act('select', 'level'); g.act('bury');
  assert.equal(s.phase, 'bury'); assert.equal(s.hands[0].length, count);
});
test('投票3票重发，不足3票按持牌候选选庄，系统指定不可放弃', () => {
  const values = [0.1, 0.1, 0.9];
  const g = createGame({ random: () => values.length ? values.shift() : 0.1 }), s = g.state;
  s.phase = 'vote'; g.act('vote', true);
  assert.equal(s.phase, 'dealing'); assert.equal(s.dealt, 0);
  const h = createGame({ random: () => 0.9 }), t = h.state;
  t.phase = 'vote'; t.level = '2';
  t.hands = [[], [], [{ suit: '♠', rank: '2', id: 'eligible' }], []];
  t.bottom = R.createDeck().slice(0, 8);
  h.act('vote', false);
  assert.equal(t.phase, 'bury'); assert.equal(t.dealer, 2); assert.equal(t.trump, '♠');
  assert.deepEqual(t.votes, [false, false, false, false]);
  h.act('pass'); h.act('vote', true); assert.equal(t.phase, 'bury'); assert.equal(t.dealer, 2);
});
test('庄家队友赢末墩不抠底，闲家拖拉机抠底，达到A即保存徽章', () => {
  function fixture(winner, score, cards) {
    let saved;
    const g = createGame({ saveProgress: p => { saved = p; } }), s = g.state;
    Object.assign(s, { phase: 'trick', dealer: 0, trump: '♥', level: '2', score,
      trickWinner: winner, trick: [{ player: 0, cards }], bottom: [{ suit: '♣', rank: 'K', id: 'bottom' }] });
    s.players[0].level = 'K'; s.players[2].level = 'Q';
    g.act('continue');
    return { g, s, saved };
  }
  const single = [{ suit: '♣', rank: '5', id: 'lead' }];
  const a = fixture(2, 40, single);
  assert.equal(a.s.score, 40); assert.equal(a.s.result.multiplier, 0);
  assert.deepEqual(a.saved[0], { level: '2', badges: 1 });
  assert.equal(a.saved[2].level, 'K');
  const tractor = ['5', '6'].flatMap(rank => [0, 1].map(i => ({ suit: '♣', rank, id: rank + i })));
  const b = fixture(1, 50, tractor);
  assert.equal(b.s.result.multiplier, 8); assert.equal(b.s.score, 130);
  assert.equal(b.s.result.progress.levels, 2); assert.equal(b.saved[1].level, '4');
});
test('真人非法跟牌不扣牌、不加分、不推进回合', () => {
  const g = createGame(), s = g.state;
  Object.assign(s, { phase: 'playing', trump: '♥', level: '2', turn: 0,
    trick: [{ player: 3, cards: [{ suit: '♣', rank: 'A', id: 'lead' }] }] });
  s.hands[0] = [{ suit: '♣', rank: '5', id: 'club' }, { suit: '♥', rank: '6', id: 'heart' }];
  g.act('select', 'heart'); g.act('play');
  assert.equal(s.turn, 0); assert.equal(s.hands[0].length, 2); assert.equal(s.trick.length, 1); assert.equal(s.score, 0);
  assert.match(s.toast, /必须跟/);
  assert.equal(s.error, s.toast);
  g.act('clear'); g.act('select', 'club'); g.act('play');
  assert.equal(s.error, '');
  assert.equal(s.turn, 1); assert.equal(s.hands[0].length, 1); assert.equal(s.trick.length, 2);
});
test('分牌只归赢墩队：庄家队友赢墩不增加闲家抓分，闲家赢墩只加一次', () => {
  for (const dealer of [0, 1, 2, 3]) {
    for (const winner of [0, 1, 2, 3]) {
      const g = createGame(), s = g.state;
      Object.assign(s, { phase: 'playing', dealer, turn: 0, trump: '♥', level: '2' });
      s.hands = [0, 1, 2, 3].map(i => [
        { suit: '♣', rank: i === winner ? 'A' : ['5', '10', 'K'][i < winner ? i : i - 1], id: `card-${i}` },
      ]);
      for (let i = 0; i < 4; i++) {
        if (i === 0) { g.act('select', s.hands[0][0].id); g.act('play'); }
        else g.act('tick');
      }
      assert.equal(s.trickWinner, winner);
      assert.equal(s.trickPoints, 25);
      assert.equal(s.teamScores[winner % 2], 25);
      assert.equal(s.teamScores[1 - winner % 2], 0);
      assert.equal(s.score, winner % 2 === dealer % 2 ? 0 : 25);
      assert.match(s.toast, winner % 2 === dealer % 2 ? /闲家不加分/ : /闲家.*25/);
      g.act('tick'); g.act('play');
      assert.equal(s.teamScores[winner % 2], 25);
    }
  }
});
test('电脑不会在发牌时抢先定庄，真人始终有最终叫庄确认环节', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const g = createGame({ random: rng(seed) }), s = g.state;
    g.act('start');
    for (let step = 0; step < 100 && s.phase !== 'calling'; step++) {
      if (s.phase === 'call-window') g.act('pass');
      else g.act('tick');
      assert.equal(s.dealer, -1);
    }
    assert.equal(s.phase, 'calling');
    assert.equal(s.dealt, 100);
    for (let i = 0; i < 10; i++) g.act('tick');
    assert.equal(s.phase, 'calling');
    assert.equal(s.dealer, -1);
  }
});
test('摸到可叫级牌时暂停等待真人，叫主后拿8张底牌并自行扣回8张', () => {
  const g = createGame({ random: rng(2) }), s = g.state;
  g.act('start');
  // 让真人在第一批牌中拿到级牌，避免测试依赖随机牌序。
  const index = s.deck.findIndex(c => c.rank === s.level);
  [s.deck[0], s.deck[index]] = [s.deck[index], s.deck[0]];
  g.act('tick'); assert.equal(s.phase, 'call-window');
  const dealt = s.dealt;
  for (let i = 0; i < 10; i++) g.act('tick');
  assert.equal(s.dealt, dealt); assert.equal(s.dealer, -1);
  g.act('trump', s.hands[0].find(c => c.rank === s.level).suit);
  while (s.phase === 'dealing') g.act('tick');
  assert.equal(s.phase, 'bury'); assert.equal(s.dealer, 0);
  assert.equal(s.hands[0].length, 33); assert.equal(s.pickedBottom.length, 8);
  assert.ok(s.pickedBottom.every(c => s.hands[0].some(h => h.id === c.id)));
  const buried = s.hands[0].slice(3, 11).map(c => c.id);
  buried.forEach(id => g.act('select', id)); g.act('bury');
  assert.equal(s.phase, 'playing'); assert.equal(s.hands[0].length, 25);
  assert.deepEqual(s.bottom.map(c => c.id).sort(), buried.sort());
});
