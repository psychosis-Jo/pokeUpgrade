(() => {
  const canvas = document.querySelector('canvas');
  let show = () => {}, hide = () => {};
  window.wx = {
    createCanvas: () => canvas,
    createImage: () => new Image(),
    getStorageSync: key => JSON.parse(localStorage.getItem(key) || 'null'),
    setStorageSync: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
    getWindowInfo: () => ({ windowWidth: innerWidth, windowHeight: innerHeight,
      screenHeight: innerHeight, pixelRatio: Math.min(devicePixelRatio || 1, 3),
      safeArea: { top: 16, bottom: innerHeight - 16 } }),
    onTouchStart: fn => canvas.addEventListener('pointerdown', event => {
      event.preventDefault();
      fn({ touches: [{ clientX: event.clientX, clientY: event.clientY }] });
    }),
    onShow: fn => { show = fn; }, onHide: fn => { hide = fn; },
    onWindowResize: fn => window.addEventListener('resize', fn),
  };
  document.addEventListener('visibilitychange', () => document.hidden ? hide() : show({}));
  const cache = {};
  function load(name) {
    name = name.replace('./', '');
    if (cache[name]) return cache[name].exports;
    if (!window.GAME_SOURCES[name]) throw new Error('Unknown game module: ' + name);
    const mod = cache[name] = { exports: {} };
    new Function('require', 'module', 'exports', window.GAME_SOURCES[name])(load, mod, mod.exports);
    return mod.exports;
  }
  load('game');
})();
