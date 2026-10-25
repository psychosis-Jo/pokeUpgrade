// Shared room artwork. Failed images leave the playable Canvas UI intact.
function createLivingRoom({ wx, ctx, box, text, lineCards, requestRender, colors }) {
  const images = {};
  const failed = new Set();
  if (wx.createImage) {
    for (const name of ['background', 'table', 'teammate', 'left', 'right', 'self-avatar', 'whiskers']) {
      const image = wx.createImage();
      image.onload = () => { images[name] = image; requestRender(); };
      image.onerror = () => { failed.add(name); requestRender(); };
      image.src = `assets/living-room/${name}.${name === 'background' ? 'jpg' : 'png'}`;
    }
  }
  function picture(name, x, y, w, h) {
    const im = images[name];
    if (!im) return false;
    const scale = Math.min(w / im.width, h / im.height);
    ctx.drawImage(im, x + (w - im.width * scale) / 2, y + (h - im.height * scale) / 2,
      im.width * scale, im.height * scale);
    return true;
  }
  function background(lobby = false) {
    box(0, 0, 375, 760, colors.bg, 0);
    const im = images.background;
    if (im) ctx.drawImage(im, 0, 0, 375, 760);
    if (lobby) return;
    box(10, 3, 355, 91, '#fff6e8', 18);
    box(10, 99, 355, 352, '#fff6e8', 18);
    box(10, 456, 355, 270, '#f4e7cc', 18);
  }
  function table(s) {
    // The play surface is opaque: art never reduces text or card contrast.
    box(12, 138, 351, 302, '#e6d1ae', 20);
    picture('table', 79, 165, 217, 265);
    const positions = [[155, 379, 66, 48], [280, 207, 90, 134],
      [141, 138, 93, 80], [5, 207, 90, 134]];
    const names = ['self-avatar', 'right', 'teammate', 'left'];
    s.players.forEach((p, i) => {
      const [x, y, w, h] = positions[i];
      if (s.phase === 'playing' && s.turn === i) box(x - 2, y - 2, w + 4, h + 4, '#f3a34b', 12);
      if (!picture(names[i], x, y, w, h)) {
        box(x, y, w, h, '#f9edda', 12);
        text(p.name.slice(0, 1), x + w / 2, y + h / 2, 24, colors.ink, 'center');
      }
      const ally = i % 2 === 0;
      const captionY = i === 0 ? 419 : y + h + 7;
      box(x - 3, captionY - 8, w + 6, 30, '#fff6e8', 8);
      text(`${p.name}${s.dealer === i ? '·庄' : ''}`, x + w / 2, captionY, 11, colors.ink, 'center');
      text(`${i === 0 ? '你' : i === 2 ? '队友' : '对手'} ${s.hands[i].length}张`, x + w / 2, captionY + 13,
        10, ally ? colors.team : colors.red, 'center');
      const effect = s.effects.find(e => e.target === i);
      if (effect?.type === 'graffiti') picture('whiskers', x + w * .28, y + h * .31, w * .45, h * .12);
      else if (effect) text({ title: '接招王', mute: '禁言演示', dance: '♪' }[effect.type], x + w / 2,
        y + 9, 11, colors.red, 'center');
    });
    if (!s.trick.length) {
      box(99, 269, 177, 62, '#fff6e8', 10);
      text(`${s.players[s.turn].name}领出`, 187, 289, 18, colors.ink, 'center');
      text('单张、对子或拖拉机', 187, 314, 12, colors.muted, 'center');
    }
    const compact = s.trick.some(entry => entry.cards.length > 4);
    if (compact) {
      box(20, 190, 335, 247, '#fff6e8', 16);
      const rows = Math.max(1, ...s.trick.map(entry => Math.ceil(entry.cards.length / 11)));
      s.trick.forEach((entry, i) => {
        const y = 201 + i * 51;
        text(`${s.players[entry.player].name} · ${entry.player % 2 ? '对手' : '我方'}`, 30, y, 10, colors.ink);
        lineCards(entry.cards, 32, y + 13, 11, rows === 3 ? 9 : 11, 28);
      });
    } else {
      const slots = [[187, 357], [255, 292], [187, 267], [120, 292]];
      s.trick.forEach(entry => {
        const [cx, y] = slots[entry.player];
        const count = entry.cards.length, start = cx - count * 14;
        if (s.phase === 'trick' && entry.player === s.trickWinner)
          box(start - 4, y - 14, count * 28 + 6, 44, '#367e95', 6);
        entry.cards.forEach((card, i) => {
          box(start + i * 28, y - 11, 26, 38, '#fffbf2', 4);
          const color = ['♥', '♦'].includes(card.suit) || card.rank === 'BJ' ? colors.red : colors.ink;
          text(card.rank === 'BJ' ? '大' : card.rank === 'SJ' ? '小' : card.rank, start + i * 28 + 13, y,
            13, color, 'center');
          text(card.suit === 'J' ? '王' : card.suit, start + i * 28 + 13, y + 16, 15, color, 'center');
        });
      });
    }
  }
  function dealing({ players, counts, seat = 0, level, dealer, trump, dealt, phase }) {
    const positions = [[145, 303], [265, 206], [145, 119], [25, 206]];
    picture('table', 95, 196, 185, 143);
    players.forEach((p, i) => {
      const relative = (i - seat + 4) % 4, [x, y] = positions[relative];
      const ally = relative % 2 === 0;
      box(x, y, 85, 76, '#fff6e8', 14);
      if (!picture(['self-avatar', 'right', 'teammate', 'left'][relative], x + 23, y + 2, 39, 36))
        text(p.name.slice(0, 1), x + 42, y + 20, 19, colors.gold, 'center');
      text(`${i === seat ? '你' : p.name.slice(0, 5)}${dealer === i ? '·庄' : ''}`, x + 42, y + 46, 11, colors.ink, 'center');
      text(`${ally ? '我方' : '对手'} ${counts[i]}张`, x + 42, y + 64, 10, ally ? colors.team : colors.red, 'center');
    });
    // Only backs are shown on the table: the other three hands remain private.
    for (let i = 0; i < 3; i++) {
      box(164 + i * 3, 216 - i * 3, 37, 47, '#fff6e8', 6);
      box(168 + i * 3, 220 - i * 3, 29, 39, '#367e95', 4);
    }
    text('♠', 189, 237, 24, '#fff6e8', 'center');
    box(100, 272, 175, 25, '#fff6e8', 10);
    text(phase === 'dealing' ? `正在发牌 ${dealt} / 100` : phase === 'call-window' ? '摸到级牌，可以叫主' : dealer >= 0 ? `${trump}主 · 打${level}` : '发牌完成，等待叫主', 187, 285, 12, colors.gold, 'center');
    if (phase === 'dealing' || phase === 'call-window') {
      box(112, 299, 151, 4, '#e0cfb4', 2);
      if (dealt) box(112, 299, 151 * Math.min(dealt, 100) / 100, 4, '#e99a39', 2);
    }
  }
  return { background, table, dealing, picture, failed };
}
module.exports = { createLivingRoom };
