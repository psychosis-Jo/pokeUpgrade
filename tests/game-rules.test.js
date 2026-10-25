const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveNoTrumpVote,
  calculateRoundProgress,
  nextLevel,
  selectLevelPlayer,
} = require('../miniprogram/utils/game-rules');

test('三票同意时重新发牌', () => {
  assert.deepEqual(resolveNoTrumpVote([true, true, true, false]), {
    action: 'redeal',
  });
});

test('不足三票时按系统主花色从持牌玩家中选庄家', () => {
  const result = resolveNoTrumpVote(
    [true, false, false, false],
    {
      trumpSuit: 'heart',
      levelRank: '7',
      hands: [
        [{ suit: 'spade', rank: '7' }],
        [{ suit: 'heart', rank: '7' }],
        [{ suit: 'heart', rank: '7' }],
        [{ suit: 'club', rank: '7' }],
      ],
      random: () => 0.99,
    },
  );

  assert.deepEqual(result, {
    action: 'assign',
    trumpSuit: 'heart',
    dealerIndex: 2,
  });
});

test('无人持有对应级牌时从全桌随机庄家', () => {
  const result = resolveNoTrumpVote(
    [false, false, false, false],
    {
      trumpSuit: 'diamond',
      levelRank: '9',
      hands: [[], [], [], []],
      random: () => 0.51,
    },
  );

  assert.equal(result.dealerIndex, 2);
});

test('结算分数映射到正确升级方和级数', () => {
  assert.deepEqual(calculateRoundProgress(0), { side: 'dealer', levels: 3 });
  assert.deepEqual(calculateRoundProgress(40), { side: 'dealer', levels: 1 });
  assert.deepEqual(calculateRoundProgress(79), { side: 'dealer', levels: 0 });
  assert.deepEqual(calculateRoundProgress(80), { side: 'defender', levels: 1 });
  assert.deepEqual(calculateRoundProgress(120), { side: 'defender', levels: 2 });
  assert.deepEqual(calculateRoundProgress(200), { side: 'defender', levels: 4 });
});

test('个人达到 A 后获得徽章并从 2 开始新一轮', () => {
  assert.deepEqual(nextLevel('K', 1), { level: 'A', badges: 0 });
  assert.deepEqual(nextLevel('A', 1), { level: '2', badges: 1 });
});

test('使用可注入随机数选定本局等级玩家', () => {
  assert.equal(selectLevelPlayer(4, () => 0.74), 2);
});
