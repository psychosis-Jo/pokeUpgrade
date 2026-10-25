const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'web-dist');
fs.mkdirSync(out, { recursive: true });
const sources = Object.fromEntries(['game', 'round', 'rules', 'living-room'].map(name => [name,
  fs.readFileSync(path.join(root, 'minigame', name + '.js'), 'utf8')]));
// The browser demo intentionally exposes local practice only, without WeChat identity.
sources.game = sources.game.replace("button('好友联机房间 →',", "button('网页版说明 →',");
sources.game = sources.game.replace('好友联机请进入房间 · 暂无真实语音', '网页版人机体验 · 好友联机请使用微信版');
sources.online = `exports.createOnline = () => ({ draw: () => false, show() {}, hide() {}, action() { alert('当前链接是人机体验版，好友联机请使用微信小游戏。'); } });`;
fs.writeFileSync(path.join(out, 'sources.js'), 'window.GAME_SOURCES=' + JSON.stringify(sources) + ';');
for (const file of ['index.html', 'browser.js']) fs.copyFileSync(path.join(root, 'web', file), path.join(out, file));
fs.cpSync(path.join(root, 'minigame/assets/living-room'), path.join(out, 'assets/living-room'), { recursive: true });
console.log('Browser demo built in web-dist');
