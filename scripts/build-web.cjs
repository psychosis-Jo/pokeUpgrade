const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'web-dist');
fs.mkdirSync(out, { recursive: true });
const sources = Object.fromEntries(['game', 'round', 'rules', 'living-room', 'online'].map(name => [name,
  fs.readFileSync(path.join(root, 'minigame', name + '.js'), 'utf8')]));
const onlineConfig = require('../minigame/online-config');
sources['online-config'] = 'module.exports=' + JSON.stringify({ ...onlineConfig,
  webGuest: true, localUrl: '', localPlayer: '',
  wsUrl: process.env.WEB_WS_URL || 'wss://upgrade-game-334898-11-1516105269.sh.run.tcloudbase.com/ws' });
fs.writeFileSync(path.join(out, 'sources.js'), 'window.GAME_SOURCES=' + JSON.stringify(sources) + ';');
for (const file of ['index.html', 'browser.js']) fs.copyFileSync(path.join(root, 'web', file), path.join(out, file));
fs.cpSync(path.join(root, 'minigame/assets/living-room'), path.join(out, 'assets/living-room'), { recursive: true });
console.log('Browser demo built in web-dist');
