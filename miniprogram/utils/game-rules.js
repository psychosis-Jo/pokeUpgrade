const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function randomIndex(length, random = Math.random) {
  return Math.min(length - 1, Math.floor(random() * length));
}

function selectLevelPlayer(playerCount, random = Math.random) {
  return randomIndex(playerCount, random);
}

function resolveNoTrumpVote(votes, options) {
  if (votes.filter(Boolean).length >= 3) return { action: 'redeal' };

  const { trumpSuit, levelRank, hands, random = Math.random } = options;
  const eligible = hands
    .map((hand, index) => ({ hand, index }))
    .filter(({ hand }) => hand.some(card => card.suit === trumpSuit && card.rank === levelRank))
    .map(({ index }) => index);
  const pool = eligible.length ? eligible : hands.map((_, index) => index);

  return {
    action: 'assign',
    trumpSuit,
    dealerIndex: pool[randomIndex(pool.length, random)],
  };
}

function calculateRoundProgress(defenderScore) {
  if (defenderScore === 0) return { side: 'dealer', levels: 3 };
  if (defenderScore <= 40) return { side: 'dealer', levels: 1 };
  if (defenderScore < 80) return { side: 'dealer', levels: 0 };
  return {
    side: 'defender',
    levels: Math.min(4, 1 + Math.floor((defenderScore - 80) / 40)),
  };
}

function nextLevel(current, steps) {
  let index = LEVELS.indexOf(current);
  let badges = 0;
  for (let step = 0; step < steps; step += 1) {
    if (index === LEVELS.length - 1) {
      badges += 1;
      index = 0;
    } else {
      index += 1;
    }
  }
  return { level: LEVELS[index], badges };
}

module.exports = {
  LEVELS,
  calculateRoundProgress,
  nextLevel,
  resolveNoTrumpVote,
  selectLevelPlayer,
};
