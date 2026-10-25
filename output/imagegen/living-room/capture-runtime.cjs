// Headless Canvas inspection of the actual client; not a WeChat device test.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/Users/Adun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '../../../minigame');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await page.setContent('<body style="margin:0"><canvas></canvas></body>');
    const sources = Object.fromEntries(['game', 'round', 'rules', 'online', 'online-config', 'living-room']
      .map(name => [name, fs.readFileSync(path.join(root, name + '.js'), 'utf8')]));
    const assets = Object.fromEntries(fs.readdirSync(path.join(root, 'assets/living-room')).map(name => [
      'assets/living-room/' + name,
      `data:image/${name.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${fs.readFileSync(path.join(root, 'assets/living-room', name)).toString('base64')}`,
    ]));
    await page.evaluate(({ sources, assets }) => {
      const canvas = document.querySelector('canvas');
      canvas.style.width = '390px'; canvas.style.height = '844px';
      let resized, game;
      window.wx = {
        createCanvas: () => canvas,
        getStorageSync() {}, setStorageSync() {},
        getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenHeight: 844, pixelRatio: 2, safeArea: { top: 24, bottom: 810 } }),
        getMenuButtonBoundingClientRect: () => ({ bottom: 48 }),
        onTouchStart() {}, onShow() {}, onHide() {}, onWindowResize: fn => { resized = fn; },
      };
      window.wx.createImage = () => {
        const im = new Image();
        Object.defineProperty(im, 'src', { set(value) { im.setAttribute('src', assets[value]); } });
        return im;
      };
      const cache = {};
      function load(name) {
        name = name.replace('./', '');
        if (cache[name]) return cache[name].exports;
        const mod = cache[name] = { exports: {} };
        new Function('require', 'module', 'exports', sources[name])(load, mod, mod.exports);
        if (name === 'round') {
          const create = mod.exports.createGame;
          mod.exports.createGame = options => { game = create(options); return game; };
        }
        return mod.exports;
      }
      load('game');
      const hand = [];
      for (const suit of ['♥', '♠', '♦', '♣']) for (const rank of ['2', '5', '9', '10', 'K', 'A'])
        hand.push({ id: suit + rank, suit, rank });
      hand.push({ id: 'joker', suit: 'J', rank: 'BJ' });
      Object.assign(game.state, { phase: 'trick', trump: '♥', level: '2', dealer: 0, turn: 0, levelPlayer: 0,
        score: 35, trickWinner: 2, trickPoints: 15, selected: ['♥K'], round: 3,
        trick: [2, 1, 0, 3].map((player, i) => ({ player, cards: [{ id: 'played' + i, suit: '♥', rank: ['A', 'K', '10', '5'][i] }] })) });
      game.state.hands[0] = hand;
      game.state.hands[1] = hand.slice(0, 12);
      game.state.hands[2] = hand.slice(0, 13);
      game.state.hands[3] = hand.slice(0, 11);
      window.captureState = count => {
        game.state.hands[0] = Array.from({ length: count }, (_, i) => ({ ...hand[i % hand.length], id: 'held-' + i }));
        if (count === 33) { game.state.phase = 'bury'; game.state.pickedBottom = game.state.hands[0].slice(0, 8); }
        resized();
      };
      resized();
    }, { sources, assets });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, 'runtime-playing.png') });
    await page.evaluate(() => window.captureState(33));
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(__dirname, 'runtime-bury.png') });
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
