const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../minigame/rules');
const c = (suit, rank, copy = 0) => ({ suit, rank, id: `${suit}${rank}-${copy}` });
const pair = (s, r) => [c(s, r), c(s, r, 1)];
const ctx = { trump: '♥', level: '7' };

test('赢墩解释涵盖副级牌、同大先出、杀牌和普通副牌', () => {
  const trick = cards => cards.map((cards, player) => ({ player, cards }));
  assert.match(R.explainTrick(trick([pair('♥', '8'), pair('♣', '7')]), 1, ctx), /副级牌/);
  assert.match(R.explainTrick(trick([pair('♣', '7'), pair('♠', '7')]), 0, ctx), /同大.*先出/);
  assert.match(R.explainTrick(trick([pair('♣', 'A'), pair('♥', '2')]), 1, ctx), /主牌杀牌/);
  assert.match(R.explainTrick(trick([pair('♣', '8'), pair('♣', 'A')]), 1, ctx), /♣A最大/);
});

test('长拖拉机必须保留最长段，缺门杀牌须完整同型，花色不足用尽后不能混杀', () => {
  const lead = [...pair('♣', '9'), ...pair('♣', '10'), ...pair('♣', 'J')];
  const hand = [...pair('♣', '2'), ...pair('♣', '3'), ...pair('♣', '4'), ...pair('♣', 'K')];
  assert.equal(R.validatePlay(hand, hand.slice(0, 6), lead, ctx), '');
  assert.ok(R.validatePlay(hand, [...hand.slice(0, 4), ...pair('♣', 'K')], lead, ctx));
  const cut = [...pair('♥', '2'), ...pair('♥', '3'), ...pair('♥', '4')];
  assert.equal(R.validatePlay(cut, cut, lead, ctx), '');
  assert.equal(R.beats(cut, lead, lead, ctx), true);
  const broken = [...pair('♥', '2'), ...pair('♥', '3'), ...pair('♥', 'K')];
  assert.equal(R.validatePlay(broken, broken, lead, ctx), '');
  assert.equal(R.beats(broken, lead, lead, ctx), false);
  const short = [c('♣', 'A'), ...cut];
  assert.ok(R.validatePlay(short, cut, lead, ctx));
  const mixed = [short[0], ...cut.slice(0, 5)];
  assert.equal(R.validatePlay(short, mixed, lead, ctx), '');
  assert.equal(R.beats(mixed, lead, lead, ctx), false);
});

test('升级分段边界与跨A余步保持一致', () => {
  for (const [score, side, levels] of [
    [0, 'dealer', 3], [1, 'dealer', 1], [40, 'dealer', 1],
    [41, 'dealer', 0], [79, 'dealer', 0], [80, 'defender', 1],
    [119, 'defender', 1], [120, 'defender', 2], [239, 'defender', 4], [240, 'defender', 4],
  ]) assert.deepEqual(R.calculateRoundProgress(score), { side, levels });
  assert.deepEqual(R.nextLevel('K', 1), { level: '2', badges: 1 });
  assert.deepEqual(R.nextLevel('K', 3), { level: '4', badges: 1 });
});

test('两副牌108个ID、200分，洗牌不改原数组', () => {
  const deck = R.createDeck();
  assert.equal(deck.length, 108); assert.equal(new Set(deck.map(x => x.id)).size, 108);
  assert.equal(R.points(deck), 200);
  const ids = deck.map(x => x.id); R.shuffle(deck, () => 0.5); assert.deepEqual(deck.map(x => x.id), ids);
});
test('拖拉机跳过级牌，同大副级不能相连，不同花色不能凑对', () => {
  assert.equal(R.shape([...pair('♣', '6'), ...pair('♣', '8')], ctx).type, 'tractor');
  assert.equal(R.shape([...pair('♣', '7'), ...pair('♠', '7')], ctx), null);
  assert.equal(R.shape([c('♣', '7'), c('♠', '7')], ctx), null);
  assert.equal(R.shape([...pair('♥', 'A'), ...pair('♣', '7')], ctx).type, 'tractor');
  assert.equal(R.shape([...pair('♥', '7'), ...pair('J', 'SJ')], ctx).type, 'tractor');
});
test('强制跟花色、对子和拖拉机；缺门才可杀', () => {
  const lead = pair('♣', '9');
  const hand = [...pair('♣', '8'), c('♣', 'A'), c('♥', 'A')];
  assert.ok(R.validatePlay(hand, [hand[2], hand[3]], lead, ctx));
  assert.ok(R.validatePlay(hand, [hand[0], hand[2]], lead, ctx));
  assert.equal(R.validatePlay(hand, hand.slice(0, 2), lead, ctx), '');
  const tractor = [...pair('♣', '9'), ...pair('♣', '10')];
  const holding = [...pair('♣', '5'), ...pair('♣', '6'), ...pair('♣', 'K')];
  assert.ok(R.validatePlay(holding, [...pair('♣', '5'), ...pair('♣', 'K')], tractor, ctx));
  assert.equal(R.validatePlay(holding, holding.slice(0, 4), tractor, ctx), '');
  assert.ok(R.beats(pair('♥', '2'), lead, lead, ctx));
  assert.equal(R.beats([c('♥', 'A'), c('♥', 'K')], lead, lead, ctx), false);
  assert.equal(R.beats(lead, lead, lead, ctx), false);
});
test('花色不足用尽，最长连续段后尽量跟对，牌ID不可重复', () => {
  const lead = [...pair('♠', '9'), ...pair('♠', '10'), ...pair('♠', 'J')];
  const holding = [...pair('♠', '3'), ...pair('♠', '4'), ...pair('♠', 'K'), c('♥', '8')];
  const suggested = R.suggest(holding, lead, ctx);
  assert.equal(R.validatePlay(holding, suggested, lead, ctx), '');
  assert.ok(R.validatePlay(holding, [...holding.slice(0, 5), holding[6]], lead, ctx));
  assert.ok(R.validatePlay(holding, [holding[0], holding[0]], [], ctx));
});
test('抠底倍数与达到A当局徽章，超过200仍最多升4级', () => {
  assert.equal(R.bottomMultiplier([c('♣', 'A')], ctx), 2);
  assert.equal(R.bottomMultiplier(pair('♣', 'A'), ctx), 4);
  assert.equal(R.bottomMultiplier([...pair('♣', '9'), ...pair('♣', '10'), ...pair('♣', 'J')], ctx), 16);
  assert.deepEqual(R.nextLevel('K', 1), { level: '2', badges: 1 });
  assert.deepEqual(R.nextLevel('Q', 3), { level: '3', badges: 1 });
  assert.equal(R.calculateRoundProgress(400).levels, 4);
});
test('主副大小完整链、平大不超越、缺门垫牌不争胜', () => {
  const chain = [c('♥', 'A'), c('♣', '7'), c('♥', '7'), c('J', 'SJ'), c('J', 'BJ')];
  for (let i = 1; i < chain.length; i++) assert.ok(R.beats([chain[i]], [chain[i - 1]], [chain[0]], ctx));
  assert.equal(R.beats([c('♦', '7')], [c('♣', '7')], [chain[0]], ctx), false);
  assert.equal(R.beats([c('♦', 'A')], [c('♣', '3')], [c('♣', '3')], ctx), false);
});
test('伪造ID对应牌面、混花色首出、散对甩牌均拒绝', () => {
  const card = c('♣', '3');
  assert.ok(R.validatePlay([card], [{ ...card, rank: 'A' }], [], ctx));
  const mixed = [c('♣', '3'), c('♦', '3')];
  assert.ok(R.validatePlay(mixed, mixed, [], ctx));
  const disconnected = [...pair('♣', '3'), ...pair('♣', '5')];
  assert.ok(R.validatePlay(disconnected, disconnected, [], ctx));
});
test('截图场景：红桃2是主牌，持有梅花主牌时不能跟红桃6对子', () => {
  const context = { trump: '♣', level: '2' };
  const hand = [c('J', 'SJ'), c('♣', '2'), c('♣', 'A'), c('♣', 'J'), ...pair('♥', '6')];
  const lead = pair('♥', '2');
  assert.match(R.validatePlay(hand, pair('♥', '6'), lead, context), /主牌.*2.*主牌/);
  assert.equal(R.validatePlay(hand, R.suggest(hand, lead, context), lead, context), '');
});
