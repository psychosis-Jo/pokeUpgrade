const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('小游戏配置及入口文件有效', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../project.config.json'), 'utf8'));
  assert.equal(config.compileType, 'game');
  // 开发者工具统一使用 miniprogramRoot 指定源码目录，小游戏也不例外。
  assert.equal(config.miniprogramRoot, 'minigame/');
  assert.equal(config.minigameRoot, undefined);
  const root = path.join(__dirname, '..', config.miniprogramRoot);
  assert.ok(fs.existsSync(path.join(root, 'game.js')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8')).deviceOrientation, 'portrait');
});

for (const width of [320, 390, 768]) {
  test(`Canvas 真实整局触摸、等级保存和后台暂停：${width}px`, () => {
    const labels = [];
    const drawings = [];
    const handlers = {};
    const pending = new Map();
    let id = 0;
    let clock = 0;
    let instance;
    let seed = 4;
    const storage = {};
    const context = {};
    for (const method of ['setTransform', 'fillRect', 'translate', 'scale', 'beginPath', 'moveTo', 'arcTo', 'closePath', 'fill']) {
      context[method] = () => {};
    }
    context.fillText = (label, x, y) => { labels.push(label); drawings.push({ label, x, y }); };
    const height = 844;
    const info = { windowWidth: width, windowHeight: height, screenHeight: height, pixelRatio: 2,
      safeArea: { top: 24, bottom: 810 } };
    const canvas = { width: 0, height: 0, getContext: () => context };
    const sandbox = {
      require: name => {
        const mod = require(path.join(__dirname, '../minigame', name));
        if (name !== './round') return mod;
        return { ...mod, createGame: options => {
          instance = mod.createGame({ ...options, random: () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;
          } }); return instance;
        } };
      },
      Date: { now: () => clock },
      wx: { createCanvas: () => canvas, getWindowInfo: () => info,
        getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; },
        getMenuButtonBoundingClientRect: () => ({ bottom: 48 }),
        onTouchStart: fn => { handlers.touch = fn; }, onShow: fn => { handlers.show = fn; },
        onHide: fn => { handlers.hide = fn; }, onWindowResize: fn => { handlers.resize = fn; } },
      requestAnimationFrame: fn => { pending.set(++id, fn); return id; },
      cancelAnimationFrame: key => pending.delete(key),
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../minigame/game.js'), 'utf8'), sandbox);
    assert.equal(canvas.width, width * 2);
    const scale = Math.min(width / 375, (height - 56 - 34) / 760);
    function flush() {
      clock += 700;
      const callbacks = [...pending.values()]; pending.clear();
      labels.length = 0; callbacks.forEach(fn => fn());
    }
    function tap(x, y) {
      handlers.touch({ touches: [{ clientX: (width - 375 * scale) / 2 + x * scale, clientY: 56 + y * scale }] });
      flush();
    }
    tap(150, 690);
    assert.equal(instance.state.phase, 'dealing');
    handlers.hide(); assert.equal(pending.size, 0);
    const dealt = instance.state.dealt;
    handlers.touch({ touches: [{ clientX: 100, clientY: 100 }] });
    assert.equal(instance.state.dealt, dealt);
    handlers.show(); flush();
    for (let step = 0; step < 1000 && instance.state.phase !== 'result'; step++) {
      const s = instance.state;
      if (s.phase === 'calling' || s.phase === 'call-window') tap(150, 428);
      else if (s.phase === 'vote') tap(250, 340);
      else if (s.phase === 'bury' && s.dealer === 0) {
        for (let i = 0; i < 8; i++) tap(33 + i * 30, 510);
        tap(250, 690);
      } else if (s.phase === 'playing' && s.turn === 0) {
        tap(50, 690); tap(250, 690);
      } else if (s.phase === 'trick') tap(150, 690);
      else flush();
    }
    assert.equal(instance.state.phase, 'result');
    assert.equal(storage['upgrade-personal-progress-v1'].length, 4);
    const originalResult = instance.state.result, originalScore = instance.state.score;
    instance.state.score = 75;
    instance.state.result = { ...originalResult, winningParity: 0, progress: { side: 'dealer', levels: 0 } };
    handlers.resize(); flush();
    assert.ok(labels.includes('我方守庄成功'));
    assert.ok(labels.includes('守庄成功，本局不升级'));
    assert.ok(labels.includes('闲家75分 · 41～79分：守庄成功，不升级'));
    instance.state.result = originalResult; instance.state.score = originalScore;
    tap(150, 690);
    assert.equal(instance.state.phase, 'reward');
    assert.ok(labels.includes('这一局，留下个记号。'));
    handlers.hide(); assert.equal(pending.size, 0);
    handlers.show(); flush();
    tap(150, 690); assert.ok(['dealing', 'call-window'].includes(instance.state.phase));
    handlers.resize(); flush(); assert.ok(labels.some(label => label.startsWith('本局采用')));
    // 最长手牌规模的出牌也应完整显示，且不侵入下一行玩家名称或赢墩提示。
    instance.state.phase = 'trick';
    instance.state.trump = '♥'; instance.state.level = '6';
    instance.state.hands[0] = [
      { id: 'main', suit: '♥', rank: '10' }, { id: 'level', suit: '♣', rank: '6' },
      { id: 'joker', suit: 'J', rank: 'BJ' },
    ];
    instance.state.trick = [0, 1, 2, 3].map(player => ({ player,
      cards: Array.from({ length: 24 }, (_, j) => ({ id: `${player}-${j}`, suit: '♣', rank: 'K' })) }));
    drawings.length = 0; handlers.resize(); flush();
    assert.ok(labels.some(label => label.startsWith('队友 ')));
    for (const mark of ['主', '级', '王']) assert.ok(labels.includes(mark));
    const played = drawings.filter(d => d.label === '♣K');
    assert.equal(played.length, 96);
    for (let player = 0; player < 4; player++) {
      const row = played.slice(player * 24, (player + 1) * 24);
      assert.ok(row.every(d => d.x >= 30 && d.x < 345 && d.y > 201 + player * 51 && d.y < 201 + (player + 1) * 51));
    }
    instance.state.trick = [
      { player: 1, cards: [{ suit: '♥', rank: '10', id: 'lead' }] },
      { player: 2, cards: [{ suit: '♣', rank: '6', id: 'winner' }] },
    ];
    instance.state.trickWinner = 2;
    handlers.resize(); flush();
    assert.ok(labels.includes('♣6是副级牌，同型主牌中最大'));
  });
}
