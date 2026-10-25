const SUITS = ['♥', '♦', '♣', '♠'];
const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function createDeck() {
  const cards = [];
  for (let copy = 0; copy < 2; copy++) {
    SUITS.forEach(suit => LEVELS.forEach(rank => cards.push({ suit, rank, id: `${suit}${rank}-${copy}` })));
    ['SJ', 'BJ'].forEach(rank => cards.push({ suit: 'J', rank, id: `${rank}-${copy}` }));
  }
  return cards;
}
function shuffle(cards, random = Math.random) {
  const result = cards.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function category(card, ctx) {
  return card.suit === 'J' || card.rank === ctx.level || card.suit === ctx.trump ? 'T' : card.suit;
}
function power(card, ctx) {
  if (card.rank === 'BJ') return 16;
  if (card.rank === 'SJ') return 15;
  if (card.rank === ctx.level) return card.suit === ctx.trump ? 14 : 13;
  return LEVELS.filter(rank => rank !== ctx.level).indexOf(card.rank) + 1;
}
function sortHand(cards, ctx) {
  return cards.slice().sort((a, b) => {
    const cats = [...SUITS, 'T'];
    return cats.indexOf(category(b, ctx)) - cats.indexOf(category(a, ctx)) || power(b, ctx) - power(a, ctx) || a.suit.localeCompare(b.suit) || a.id.localeCompare(b.id);
  });
}
function points(cards) { return cards.reduce((sum, c) => sum + (c.rank === '5' ? 5 : ['10', 'K'].includes(c.rank) ? 10 : 0), 0); }
function pairs(cards) {
  const groups = new Map();
  cards.forEach(c => { const key = c.suit + c.rank; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); });
  return [...groups.values()].filter(group => group.length === 2);
}
function shape(cards, ctx) {
  if (!cards.length || cards.some(c => category(c, ctx) !== category(cards[0], ctx))) return null;
  const base = { count: cards.length, category: category(cards[0], ctx), high: Math.max(...cards.map(c => power(c, ctx))) };
  if (cards.length === 1) return { ...base, type: 'single' };
  if (cards.length % 2) return null;
  const groups = pairs(cards);
  if (groups.length * 2 !== cards.length) return null;
  if (groups.length === 1) return { ...base, type: 'pair' };
  const values = groups.map(g => power(g[0], ctx)).sort((a, b) => a - b);
  if (values.some((v, i) => i && v !== values[i - 1] + 1)) return null;
  return { ...base, type: 'tractor' };
}
// 最大连续段优先，然后次长段；同大副级牌只能占一个连续层级。
function profile(groups, ctx) {
  const counts = new Map();
  groups.forEach(g => { const v = power(g[0], ctx); counts.set(v, (counts.get(v) || 0) + 1); });
  const result = [];
  while (counts.size) {
    let bestStart = 0, bestLength = 0;
    [...counts.keys()].sort((a, b) => a - b).forEach(start => {
      let length = 0; while (counts.has(start + length)) length++;
      if (length > bestLength) { bestStart = start; bestLength = length; }
    });
    result.push(bestLength);
    for (let i = 0; i < bestLength; i++) {
      const v = bestStart + i, n = counts.get(v) - 1;
      if (n) counts.set(v, n); else counts.delete(v);
    }
  }
  return result.sort((a, b) => b - a);
}
function compareProfile(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}
function bestPairs(cards, maxPairs, ctx) {
  const groups = pairs(cards);
  let best = [], bestProfile = [];
  function visit(i, chosen) {
    if (chosen.length === maxPairs || i === groups.length) {
      const value = profile(chosen, ctx);
      if (compareProfile(value, bestProfile) > 0) { best = chosen.slice(); bestProfile = value; }
      return;
    }
    chosen.push(groups[i]); visit(i + 1, chosen); chosen.pop(); visit(i + 1, chosen);
  }
  visit(0, []);
  return { cards: best.flat(), profile: bestProfile };
}
function validatePlay(hand, cards, lead, ctx) {
  const ids = new Set(cards.map(c => c.id));
  const held = new Map(hand.map(c => [c.id, c]));
  if (!cards.length || ids.size !== cards.length || cards.some(c => !held.has(c.id) || held.get(c.id).suit !== c.suit || held.get(c.id).rank !== c.rank)) return '请选择自己持有的牌，不能重复';
  if (!lead.length) return shape(cards, ctx) ? '' : '首出只能是单张、对子或连续拖拉机';
  const pattern = shape(lead, ctx);
  if (!pattern || cards.length !== lead.length) return `必须跟出 ${lead.length} 张牌`;
  const suited = hand.filter(c => category(c, ctx) === pattern.category);
  const followed = cards.filter(c => category(c, ctx) === pattern.category);
  if (followed.length !== Math.min(suited.length, lead.length)) {
    const name = pattern.category === 'T' ? '主牌' : `${pattern.category}副牌`;
    if (suited.length < lead.length) return `首出是${name}，你仅剩${suited.length}张，必须全部跟出，再补其他牌`;
    return pattern.category === 'T'
      ? `首出是主牌（${ctx.level}也是主牌），你必须跟${lead.length}张主牌`
      : `首出是${name}，你必须跟${lead.length}张${name}`;
  }
  if (pattern.type !== 'single') {
    const best = bestPairs(suited, Math.floor(Math.min(suited.length, lead.length) / 2), ctx);
    if (compareProfile(profile(pairs(followed), ctx), best.profile) < 0) return pattern.type === 'pair'
      ? `你有${pattern.category === 'T' ? '主牌' : pattern.category}对子，必须优先跟对子`
      : '必须优先跟同花色的连续对子，不够时尽量跟对子';
  }
  return '';
}
function beats(cards, current, lead, ctx) {
  const a = shape(cards, ctx), b = shape(current, ctx), l = shape(lead, ctx);
  if (!a || !l || a.count !== l.count || a.type !== l.type || ![l.category, 'T'].includes(a.category)) return false;
  if (!b) return true;
  if (a.category !== b.category) return a.category === 'T' && b.category !== 'T';
  return a.high > b.high;
}
function suggest(hand, lead, ctx) {
  const cheap = cards => cards.slice().sort((a, b) => (category(a, ctx) === 'T') - (category(b, ctx) === 'T') || points([a]) - points([b]) || power(a, ctx) - power(b, ctx));
  if (!lead.length) {
    const sorted = cheap(hand);
    // 有拖拉机或对子时优先尝试，避免人机总是单张领出。
    for (const cat of [...SUITS, 'T']) {
      const groups = pairs(sorted.filter(c => category(c, ctx) === cat));
      for (const first of groups) for (const second of groups) {
        const candidate = [...first, ...second];
        if (first !== second && shape(candidate, ctx)) return candidate;
      }
    }
    const group = pairs(sorted)[0];
    return group || sorted.slice(0, 1);
  }
  const l = shape(lead, ctx), suited = cheap(hand.filter(c => category(c, ctx) === l.category));
  const count = Math.min(suited.length, lead.length);
  let chosen = l.type === 'single' ? [] : bestPairs(suited, Math.floor(count / 2), ctx).cards;
  const used = new Set(chosen.map(c => c.id));
  for (const c of suited) if (chosen.length < count && !used.has(c.id)) { chosen.push(c); used.add(c.id); }
  const rest = cheap(hand.filter(c => !used.has(c.id) && category(c, ctx) !== l.category));
  chosen = chosen.concat(rest.slice(0, lead.length - chosen.length));
  return chosen;
}
function bottomMultiplier(lead, ctx) {
  const value = shape(lead, ctx);
  return value.type === 'single' ? 2 : 2 ** (value.count / 2 + 1);
}
function explainTrick(trick, winner, ctx) {
  const entry = trick.find(t => t.player === winner);
  if (!entry || !trick.length) return '';
  const lead = shape(trick[0].cards, ctx), winning = shape(entry.cards, ctx);
  if (!lead || !winning) return '';
  const contenders = trick.filter(t => {
    const s = shape(t.cards, ctx);
    return s && s.count === lead.count && s.type === lead.type && s.category === winning.category;
  });
  if (winning.category === 'T' && lead.category !== 'T') return '缺门用完整同型主牌杀牌获胜';
  if (contenders.some(t => t.player !== winner && shape(t.cards, ctx).high === winning.high)) return '最大牌同大，先出者获胜';
  const top = entry.cards.reduce((a, b) => power(a, ctx) >= power(b, ctx) ? a : b);
  const name = top.rank === 'BJ' ? '大王' : top.rank === 'SJ' ? '小王' : top.suit + top.rank;
  if (top.rank === ctx.level) return `${name}是${top.suit === ctx.trump ? '主级牌' : '副级牌'}，同型主牌中最大`;
  if (top.suit === 'J') return `${name}最大，赢得本墩`;
  return `${winning.category === 'T' ? '主牌' : winning.category + '副牌'}同型比较，${name}最大`;
}
function nextLevel(current, steps) {
  let index = LEVELS.indexOf(current), badges = 0;
  for (let i = 0; i < steps; i++) {
    index++;
    if (index >= LEVELS.length - 1) { badges++; index = 0; }
  }
  return { level: LEVELS[index], badges };
}
function calculateRoundProgress(score) {
  if (score === 0) return { side: 'dealer', levels: 3 };
  if (score <= 40) return { side: 'dealer', levels: 1 };
  if (score < 80) return { side: 'dealer', levels: 0 };
  return { side: 'defender', levels: Math.min(4, 1 + Math.floor((score - 80) / 40)) };
}
module.exports = { SUITS, LEVELS, createDeck, shuffle, category, power, sortHand, points, shape,
  validatePlay, beats, suggest, bottomMultiplier, explainTrick, nextLevel, calculateRoundProgress };
