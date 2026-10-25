const { calculateRoundProgress } = require('../../utils/game-rules');

const HAND = [
  ['♠', 'A', 'black'], ['♥', 'A', 'red'], ['♣', 'K', 'black'], ['♣', 'K', 'black'],
  ['♦', 'Q', 'red'], ['♦', 'Q', 'red'], ['♠', '10', 'black'], ['♥', '9', 'red'],
  ['♣', '8', 'black'], ['♦', '7', 'red'], ['♠', '6', 'black'], ['♥', '5', 'red'],
];

Page({
  data: {
    phase: 'lobby',
    roomCode: '527 814',
    voiceOn: true,
    players: [
      { name: '阿沐', avatar: '沐', level: '7', position: 'bottom', me: true, online: true },
      { name: '小北', avatar: '北', level: '5', position: 'left', online: true },
      { name: '陈皮', avatar: '陈', level: '9', position: 'top', online: true },
      { name: '临时牌友', avatar: '友', level: '3', position: 'right', online: true, guest: true },
    ],
    levelRank: '7',
    levelOwner: '阿沐',
    trump: '',
    dealer: '',
    hand: HAND,
    selectedCards: [],
    selectedCard: -1,
    busy: false,
    trick: [],
    trickNo: 1,
    defenderScore: 0,
    toast: '',
    interactionTarget: '陈皮',
    interactionType: 'dance',
  },

  startRoom() {
    this.setData({ phase: 'calling', toast: '本局随机到阿沐的等级：打 7' });
  },

  callTrump(event) {
    const trump = event.currentTarget.dataset.suit;
    this.setData({ trump, dealer: '阿沐', phase: 'playing', toast: `${trump}主 · 你成为庄家` });
  },

  toggleVoice() {
    this.setData({ voiceOn: !this.data.voiceOn });
  },

  toggleCard(event) {
    const index = Number(event.currentTarget.dataset.index);
    const selected = this.data.selectedCards.includes(index)
      ? this.data.selectedCards.filter(item => item !== index)
      : [index];
    this.setData({ selectedCards: selected, selectedCard: selected.length ? index : -1 });
  },

  playCard() {
    if (this.data.busy) return;
    if (!this.data.selectedCards.length) {
      this.setData({ toast: '先选一张牌' });
      return;
    }
    const index = this.data.selectedCards[0];
    const own = this.data.hand[index];
    const opponents = [
      { who: '小北', card: ['♣', '10', 'black'] },
      { who: '陈皮', card: ['♣', 'A', 'black'] },
      { who: '临时牌友', card: ['♣', '5', 'black'] },
    ];
    const nextHand = this.data.hand.filter((_, itemIndex) => itemIndex !== index);
    const nextScore = this.data.defenderScore + (this.data.trickNo % 2 ? 15 : 25);
    this.setData({
      hand: nextHand,
      selectedCards: [],
      selectedCard: -1,
      busy: true,
      trick: [{ who: '你', card: own }, ...opponents],
      defenderScore: nextScore,
      toast: this.data.trickNo % 2 ? '陈皮收下 15 分' : '漂亮！队友接住了',
    });
    this.roundTimer = setTimeout(() => {
      if (this.data.trickNo >= 3) {
        this.finishRound();
      } else {
        this.setData({ trick: [], trickNo: this.data.trickNo + 1, busy: false });
      }
    }, 900);
  },

  finishRound() {
    const defenderScore = 75;
    const result = calculateRoundProgress(defenderScore);
    this.setData({
      phase: 'result',
      busy: false,
      defenderScore,
      resultTitle: result.levels === 0 ? '守庄成功' : '本局结算',
      resultText: '闲家 75 分 · 庄家方留庄 · 双方不升级',
      toast: '本局名场面：小北连续接牌 2 次',
    });
  },

  chooseInteraction(event) {
    this.setData({ interactionType: event.currentTarget.dataset.type });
  },

  chooseTarget(event) {
    if (!['陈皮', '临时牌友'].includes(event.currentTarget.dataset.name)) return;
    this.setData({ interactionTarget: event.currentTarget.dataset.name });
  },

  useInteraction() {
    if (this.data.phase !== 'result') return;
    const labels = { graffiti: '头像涂鸦', dance: '挑衅舞', mute: '下一局禁言', title: '临时称号' };
    this.setData({
      phase: 'punished',
      toast: `已对 ${this.data.interactionTarget} 使用「${labels[this.data.interactionType]}」`,
    });
  },

  nextRound() {
    this.setData({
      phase: 'calling', trump: '', dealer: '', hand: HAND, selectedCards: [], trick: [],
      selectedCard: -1, busy: false,
      trickNo: 1, defenderScore: 0, toast: '新一局：随机到陈皮的等级，打 9', levelRank: '9', levelOwner: '陈皮',
    });
  },
  onUnload() {
    clearTimeout(this.roundTimer);
  },
});
