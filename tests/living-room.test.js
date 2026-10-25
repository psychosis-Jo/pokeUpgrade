const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLivingRoom } = require('../minigame/living-room');

test('客厅图片异步加载和失败不阻塞牌局，重绘保留牌张与队伍信息', () => {
  const pending = [], labels = [], drawn = [], cards = [];
  let renders = 0;
  const room = createLivingRoom({
    wx: { createImage: () => { const im = { width: 420, height: 460 }; pending.push(im); return im; } },
    ctx: { drawImage: (...args) => drawn.push(args) }, box() {},
    text: label => labels.push(label), lineCards: list => cards.push(...list),
    requestRender: () => renders++,
    colors: { bg: '#fff', ink: '#222', team: '#367e95', red: '#b83249', muted: '#665b4f' },
  });
  const state = { players: [0, 1, 2, 3].map(i => ({ name: '牌友' + i })),
    hands: [[{}], [{}], [{}], [{}]], effects: [], phase: 'playing', turn: 0, dealer: 0, trick: [] };
  room.background(); room.table(state);
  assert.ok(labels.includes('队友 1张'));
  assert.equal(drawn.length, 0);
  pending.forEach((im, i) => {
    assert.ok(fs.existsSync(path.join(__dirname, '../minigame', im.src)));
    if (i === 3) im.onerror(); else im.onload();
  });
  assert.equal(renders, 7);
  assert.ok(room.failed.has('left'));
  room.background(); room.table(state);
  assert.ok(drawn.length >= 5);
  state.trick = [0, 1, 2, 3].map(player => ({ player,
    cards: Array.from({ length: 24 }, (_, i) => ({ id: `${player}-${i}`, rank: 'K', suit: '♣' })) }));
  room.table(state);
  assert.equal(cards.length, 96);
});
