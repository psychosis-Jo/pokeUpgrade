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
    connectSocket: ({ url }) => {
      const socket = new WebSocket(url);
      return {
        onOpen: fn => socket.addEventListener('open', fn),
        onMessage: fn => socket.addEventListener('message', fn),
        onError: fn => socket.addEventListener('error', fn),
        onClose: fn => socket.addEventListener('close', fn),
        send: ({ data, fail }) => { try { socket.send(data); } catch (e) { fail?.(e); } },
        close: () => socket.close(),
      };
    },
    getLaunchOptionsSync: () => ({ query: Object.fromEntries(new URLSearchParams(location.search)) }),
    shareAppMessage: async ({ title, query }) => {
      const url = new URL(location.href); url.search = query; url.hash = '';
      try {
        if (navigator.share) await navigator.share({ title, url: url.href });
        else { await navigator.clipboard.writeText(url.href); alert('邀请链接已复制，发给朋友即可加入'); }
      } catch (e) {
        if (e.name !== 'AbortError') prompt('复制邀请链接发给朋友', url.href);
      }
    },
    showModal: ({ title, content, success }) => success({ confirm: confirm(title + '\n' + content) }),
    onKeyboardConfirm: fn => { keyboardConfirm = fn; },
    offKeyboardConfirm: () => { keyboardConfirm = null; },
    onKeyboardComplete: fn => { keyboardComplete = fn; },
    offKeyboardComplete: () => { keyboardComplete = null; },
    hideKeyboard: () => {},
    showKeyboard: () => {
      const value = prompt('请输入6位数字房间码');
      if (value !== null) keyboardConfirm?.({ value }); else keyboardComplete?.({});
    },
    onShow: fn => { show = fn; }, onHide: fn => { hide = fn; },
    onWindowResize: fn => window.addEventListener('resize', fn),
  };
  let keyboardConfirm, keyboardComplete;
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
