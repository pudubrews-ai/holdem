'use strict';

const express = require('express');
const { Hand } = require('pokersolver');
const { buildDeck, shuffle } = require('../shared/deck');
const { AI_NAMES } = require('../shared/constants');

const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const MAIN_PAY_TABLE = {
  'Royal Flush':    500,
  'Straight Flush': 100,
  'Four of a Kind':  40,
  'Full House':      10,
  'Flush':            6,
  'Straight':         4,
  'Three of a Kind':  3,
  'Two Pair':         2
};

// ─── Helper: build fresh initial state ───────────────────────────────────────

function buildInitialState() {
  return {
    phase: 'idle',
    deck: [],
    holeCards: {
      0: [], 1: [], 2: [], 3: [], 4: [], 5: []
    },
    communityCards: [],
    bets: {
      0: { ante: 0, thirdStreet: 0, fourthStreet: 0, fifthStreet: 0, bonus: 0, folded: false },
      1: { ante: 0, thirdStreet: 0, fourthStreet: 0, fifthStreet: 0, bonus: 0, folded: false },
      2: { ante: 0, thirdStreet: 0, fourthStreet: 0, fifthStreet: 0, bonus: 0, folded: false },
      3: { ante: 0, thirdStreet: 0, fourthStreet: 0, fifthStreet: 0, bonus: 0, folded: false },
      4: { ante: 0, thirdStreet: 0, fourthStreet: 0, fifthStreet: 0, bonus: 0, folded: false },
      5: { ante: 0, thirdStreet: 0, fourthStreet: 0, fifthStreet: 0, bonus: 0, folded: false }
    },
    bankroll: 1000,
    aiProfiles: [],
    sessionActive: false,
    handNumber: 0
  };
}

// ─── 3 Card Bonus Evaluation ──────────────────────────────────────────────────

function evaluateThreeCardBonus(cards) {
  // cards: array of 3 card strings, e.g. ["Ah", "Kd", "7c"]
  const parsed = cards.map(c => ({ rank: c[0], suit: c[1] }));
  const ranks = parsed.map(c => RANK_VALUES[c.rank]);
  const suits = parsed.map(c => c.suit);

  const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  const sortedRanks = [...ranks].sort((a, b) => a - b);
  const isSequential = (sortedRanks[2] - sortedRanks[0] === 2) &&
                       (sortedRanks[1] - sortedRanks[0] === 1);
  const isAKQ = sortedRanks.join(',') === '12,13,14';

  if (isFlush && isAKQ) return { handName: 'Mini Royal', multiplier: 50 };
  if (isFlush && isSequential) return { handName: 'Straight Flush', multiplier: 40 };
  if (ranks[0] === ranks[1] && ranks[1] === ranks[2])
    return { handName: 'Three of a Kind', multiplier: 30 };
  if (isSequential || isAKQ) return { handName: 'Straight', multiplier: 6 };
  if (isFlush) return { handName: 'Flush', multiplier: 3 };
  if (ranks[0] === ranks[1] || ranks[1] === ranks[2] || ranks[0] === ranks[2])
    return { handName: 'Pair', multiplier: 1 };
  return { handName: 'High Card', multiplier: 0 };
}

// ─── Pair rank extraction and tier ────────────────────────────────────────────

function extractPairRank(hand) {
  return hand.cards
    .map(c => c.value)
    .find((v, _, arr) => arr.filter(x => x === v).length >= 2);
}

function getPairTier(pairRank) {
  if (['J', 'Q', 'K', 'A'].includes(pairRank)) {
    return { handName: 'Pair of Jacks-Aces', multiplier: 1, handRank: 'win' };
  }
  if (['6', '7', '8', '9', 'T'].includes(pairRank)) {
    return { handName: 'Pair of 6s-10s', multiplier: 0, handRank: 'push' };
  }
  return { handName: 'Pair of 2s-5s', multiplier: -1, handRank: 'lose' };
}

// ─── Main hand resolution ─────────────────────────────────────────────────────

function resolveMainHand(hand, totalBet) {
  const name = hand.name;

  // pokersolver returns name='Straight Flush' for both Royal and regular Straight Flush.
  // Use hand.descr to distinguish them so Royal Flush gets the correct 500:1 multiplier.
  const effectiveName = (name === 'Straight Flush' && hand.descr === 'Royal Flush')
    ? 'Royal Flush'
    : name;

  if (MAIN_PAY_TABLE[effectiveName] !== undefined) {
    const multiplier = MAIN_PAY_TABLE[effectiveName];
    const payout = totalBet + (totalBet * multiplier);
    return { handName: effectiveName, handRank: 'win', totalBet, payout, net: totalBet * multiplier };
  }

  if (name === 'Pair') {
    const tier = getPairTier(extractPairRank(hand));
    if (tier.handRank === 'win') {
      const payout = totalBet + (totalBet * tier.multiplier);
      return { handName: tier.handName, handRank: 'win', totalBet, payout, net: totalBet };
    }
    if (tier.handRank === 'push') {
      return { handName: tier.handName, handRank: 'push', totalBet, payout: totalBet, net: 0 };
    }
    return { handName: tier.handName, handRank: 'lose', totalBet, payout: 0, net: -totalBet };
  }

  // High Card = lose
  return { handName: 'High Card', handRank: 'lose', totalBet, payout: 0, net: -totalBet };
}

// ─── 3 Card Bonus resolution ──────────────────────────────────────────────────

function resolveBonusForSeat(ms, seat) {
  if (ms.bets[seat].bonus === 0) return null;

  const bonusBet = ms.bets[seat].bonus;
  const result = evaluateThreeCardBonus(ms.holeCards[seat]);

  if (result.multiplier > 0) {
    const bonusPayout = bonusBet * result.multiplier;
    return {
      placed: true,
      holeCards: ms.holeCards[seat],
      handName: result.handName,
      multiplier: result.multiplier,
      bonusBet,
      bonusPayout,
      net: bonusPayout
    };
  }

  return {
    placed: true,
    holeCards: ms.holeCards[seat],
    handName: result.handName,
    multiplier: 0,
    bonusBet,
    bonusPayout: 0,
    net: -bonusBet
  };
}

// ─── AI helpers ───────────────────────────────────────────────────────────────

function hasPair(cards) {
  const ranks = cards.map(c => c[0]);
  return new Set(ranks).size < ranks.length;
}

function getPairRankValueFromCards(cards) {
  const ranks = cards.map(c => c[0]);
  const counts = {};
  ranks.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  const pairRank = Object.keys(counts).find(r => counts[r] >= 2);
  return pairRank ? RANK_VALUES[pairRank] : 0;
}

function hasSuitedConnector(cards, minRank) {
  // For 3rd street (2 or 3 cards), check if any two cards share suit AND are adjacent (or high)
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const c1 = cards[i];
      const c2 = cards[j];
      if (c1[1] === c2[1]) {
        const r1 = RANK_VALUES[c1[0]];
        const r2 = RANK_VALUES[c2[0]];
        if (r1 >= minRank && r2 >= minRank && Math.abs(r1 - r2) === 1) {
          return true;
        }
      }
    }
  }
  return false;
}

function countHighCards(cards, minRank) {
  return cards.filter(c => RANK_VALUES[c[0]] >= minRank).length;
}

function countToFlush(cards) {
  const suits = cards.map(c => c[1]);
  const counts = {};
  suits.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  return Math.max(...Object.values(counts));
}

function isOpenEndedStraightDraw(cards) {
  const rankNums = cards.map(c => RANK_VALUES[c[0]]);
  const unique = [...new Set(rankNums)].sort((a, b) => a - b);
  if (unique.length < 4) return false;
  if (unique[3] - unique[0] !== 3) return false;
  return unique[0] > 2 && unique[3] < 14;
}

function hasMadePair(cards) {
  const ranks = cards.map(c => c[0]);
  return new Set(ranks).size < ranks.length;
}

function getMadePairRankValue(cards) {
  const ranks = cards.map(c => c[0]);
  const counts = {};
  ranks.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  const pairRank = Object.keys(counts).find(r => counts[r] >= 2);
  return pairRank ? RANK_VALUES[pairRank] : 0;
}

function hasTripsOrBetter(cards) {
  const ranks = cards.map(c => c[0]);
  const counts = {};
  ranks.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  return Object.values(counts).some(v => v >= 3);
}

function hasTwoPairOrBetter(cards) {
  const ranks = cards.map(c => c[0]);
  const counts = {};
  ranks.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  const pairs = Object.values(counts).filter(v => v >= 2);
  return pairs.length >= 2;
}

function hasGutshot(cards) {
  // Any 4-card hand with one gap forming a straight
  const rankNums = cards.map(c => RANK_VALUES[c[0]]);
  const unique = [...new Set(rankNums)].sort((a, b) => a - b);
  if (unique.length < 4) return false;
  // Span of 4: unique[3] - unique[0] === 4 but only 4 distinct ranks (one gap)
  return unique[3] - unique[0] === 4;
}

function countOvercards(cards, minRank) {
  return cards.filter(c => RANK_VALUES[c[0]] >= minRank).length;
}

// ─── 3rd Street AI Decision ───────────────────────────────────────────────────

function decide3rdStreet(holeCards, profile) {
  // holeCards: array of 3 card strings, e.g. ["Ah", "Kd", "7c"]
  switch (profile) {
    case 'tight': {
      // Raise 3x: pair of Jacks or better, suited connector with high cards (both >= 10)
      if (hasPair(holeCards) && getPairRankValueFromCards(holeCards) >= RANK_VALUES['J']) {
        return { action: 'raise', multiplier: 3 };
      }
      if (hasSuitedConnector(holeCards, RANK_VALUES['T'])) {
        return { action: 'raise', multiplier: 3 };
      }
      // Raise 1x: any pair 6+, any two cards both >= 9, suited connector 7+
      if (hasPair(holeCards) && getPairRankValueFromCards(holeCards) >= RANK_VALUES['6']) {
        return { action: 'raise', multiplier: 1 };
      }
      // Check if any two cards both >= 9
      const highCards9 = holeCards.filter(c => RANK_VALUES[c[0]] >= RANK_VALUES['9']);
      if (highCards9.length >= 2) {
        return { action: 'raise', multiplier: 1 };
      }
      if (hasSuitedConnector(holeCards, RANK_VALUES['7'])) {
        return { action: 'raise', multiplier: 1 };
      }
      return { action: 'fold', multiplier: null };
    }

    case 'balanced': {
      // Raise 3x: pair of 6s or better, any two suited cards, any two cards both >= 8
      if (hasPair(holeCards) && getPairRankValueFromCards(holeCards) >= RANK_VALUES['6']) {
        return { action: 'raise', multiplier: 3 };
      }
      // Any two suited cards (check all pairs)
      for (let i = 0; i < holeCards.length; i++) {
        for (let j = i + 1; j < holeCards.length; j++) {
          if (holeCards[i][1] === holeCards[j][1]) {
            return { action: 'raise', multiplier: 3 };
          }
        }
      }
      // Any two cards both >= 8
      const highCards8 = holeCards.filter(c => RANK_VALUES[c[0]] >= RANK_VALUES['8']);
      if (highCards8.length >= 2) {
        return { action: 'raise', multiplier: 3 };
      }
      // Raise 1x: any single card >= 10, connected cards (gap <= 2)
      if (countHighCards(holeCards, RANK_VALUES['T']) >= 1) {
        return { action: 'raise', multiplier: 1 };
      }
      // Connected cards: any two cards with gap <= 2
      for (let i = 0; i < holeCards.length; i++) {
        for (let j = i + 1; j < holeCards.length; j++) {
          const r1 = RANK_VALUES[holeCards[i][0]];
          const r2 = RANK_VALUES[holeCards[j][0]];
          if (Math.abs(r1 - r2) <= 2) {
            return { action: 'raise', multiplier: 1 };
          }
        }
      }
      return { action: 'fold', multiplier: null };
    }

    case 'loose': {
      // Raise 3x: any pair, any suited hand (all 3 same suit), any two cards both >= 7
      if (hasPair(holeCards)) {
        return { action: 'raise', multiplier: 3 };
      }
      // Any suited hand (all 3 same suit counts, or any two cards same suit)
      for (let i = 0; i < holeCards.length; i++) {
        for (let j = i + 1; j < holeCards.length; j++) {
          if (holeCards[i][1] === holeCards[j][1]) {
            return { action: 'raise', multiplier: 3 };
          }
        }
      }
      // Any two cards both >= 7
      const highCards7 = holeCards.filter(c => RANK_VALUES[c[0]] >= RANK_VALUES['7']);
      if (highCards7.length >= 2) {
        return { action: 'raise', multiplier: 3 };
      }
      // Raise 1x: any hand not folded
      // Fold: three completely unconnected low cards (all <= 5, no suit match, gap > 4 between each)
      const allLow = holeCards.every(c => RANK_VALUES[c[0]] <= RANK_VALUES['5']);
      if (allLow) {
        // No suit match already confirmed above (no two cards match suit)
        // Check gap > 4 between each pair
        const rankNums = holeCards.map(c => RANK_VALUES[c[0]]).sort((a, b) => a - b);
        const gapTooLarge = (rankNums[1] - rankNums[0] > 4) && (rankNums[2] - rankNums[1] > 4);
        if (gapTooLarge) {
          return { action: 'fold', multiplier: null };
        }
      }
      return { action: 'raise', multiplier: 1 };
    }

    default:
      return { action: 'fold', multiplier: null };
  }
}

// ─── 4th Street AI Decision ───────────────────────────────────────────────────

function decide4thStreet(holeCards, communityCards, profile) {
  const allCards = [...holeCards, ...communityCards]; // 4 cards total
  switch (profile) {
    case 'tight': {
      // Raise 3x: made hand (pair Jacks+, two pair, trips or better)
      if (hasTripsOrBetter(allCards)) return { action: 'raise', multiplier: 3 };
      if (hasTwoPairOrBetter(allCards)) return { action: 'raise', multiplier: 3 };
      if (hasMadePair(allCards) && getMadePairRankValue(allCards) >= RANK_VALUES['J']) {
        return { action: 'raise', multiplier: 3 };
      }
      // Raise 1x: pair 6-10, four to a flush, open-ended straight draw
      if (hasMadePair(allCards) && getMadePairRankValue(allCards) >= RANK_VALUES['6']) {
        return { action: 'raise', multiplier: 1 };
      }
      if (countToFlush(allCards) >= 4) return { action: 'raise', multiplier: 1 };
      if (isOpenEndedStraightDraw(allCards)) return { action: 'raise', multiplier: 1 };
      return { action: 'fold', multiplier: null };
    }

    case 'balanced': {
      // Raise 3x: made hand (pair 6+, two pair, trips or better)
      if (hasTripsOrBetter(allCards)) return { action: 'raise', multiplier: 3 };
      if (hasTwoPairOrBetter(allCards)) return { action: 'raise', multiplier: 3 };
      if (hasMadePair(allCards) && getMadePairRankValue(allCards) >= RANK_VALUES['6']) {
        return { action: 'raise', multiplier: 3 };
      }
      // Raise 1x: four to a flush, open-ended straight draw, gutshot with two overcards >= Jack
      if (countToFlush(allCards) >= 4) return { action: 'raise', multiplier: 1 };
      if (isOpenEndedStraightDraw(allCards)) return { action: 'raise', multiplier: 1 };
      if (hasGutshot(allCards) && countOvercards(allCards, RANK_VALUES['J']) >= 2) {
        return { action: 'raise', multiplier: 1 };
      }
      return { action: 'fold', multiplier: null };
    }

    case 'loose': {
      // Raise 3x: any made pair, any four-card draw (flush or straight)
      if (hasMadePair(allCards)) return { action: 'raise', multiplier: 3 };
      if (countToFlush(allCards) >= 4) return { action: 'raise', multiplier: 3 };
      if (isOpenEndedStraightDraw(allCards)) return { action: 'raise', multiplier: 3 };
      // Raise 1x: any hand not folded (except fold condition)
      // Fold: no pair, no draw, all cards <= 5
      const allLow = allCards.every(c => RANK_VALUES[c[0]] <= RANK_VALUES['5']);
      if (allLow) return { action: 'fold', multiplier: null };
      return { action: 'raise', multiplier: 1 };
    }

    default:
      return { action: 'fold', multiplier: null };
  }
}

// ─── 5th Street AI Decision ───────────────────────────────────────────────────

function decide5thStreet(holeCards, communityCards, profile) {
  const allCards = [...holeCards, ...communityCards]; // 5 cards total
  // Use pokersolver to evaluate 5 cards
  const cardStrings = allCards.map(c => {
    const rank = c[0] === 'T' ? 'T' : c[0];
    return rank + c[1];
  });
  const hand = Hand.solve(cardStrings);
  const name = hand.name;

  // Determine hand strength
  let hasTwoPairOrBetterHand = false;
  let pairRank6OrBetter = false;
  let pairRank5OrWorse = false;

  if (name === 'Two Pair' || MAIN_PAY_TABLE[name] !== undefined) {
    // Two Pair, Three of a Kind, Straight, Flush, etc. all >= two pair
    const twoOrBetter = ['Two Pair', 'Three of a Kind', 'Straight', 'Flush',
                         'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'];
    hasTwoPairOrBetterHand = twoOrBetter.includes(name);
  }
  if (name === 'Pair') {
    const pr = extractPairRank(hand);
    const prVal = RANK_VALUES[pr] || 0;
    if (prVal >= RANK_VALUES['6']) {
      pairRank6OrBetter = true;
    } else {
      pairRank5OrWorse = true;
    }
  }
  // High Card -> pairRank5OrWorse effectively (no pair, worse than pair 2-5)

  switch (profile) {
    case 'tight': {
      // Raise 3x: two pair or better
      if (hasTwoPairOrBetterHand) return { action: 'raise', multiplier: 3 };
      // Raise 1x: pair 6+ (push or better)
      if (pairRank6OrBetter) return { action: 'raise', multiplier: 1 };
      // Fold: pair 2-5 or worse
      return { action: 'fold', multiplier: null };
    }

    case 'balanced': {
      // Raise 3x: two pair or better
      if (hasTwoPairOrBetterHand) return { action: 'raise', multiplier: 3 };
      // Raise 1x: pair 6+ (push or better)
      if (pairRank6OrBetter) return { action: 'raise', multiplier: 1 };
      // Fold: pair 5 or worse, no pair
      return { action: 'fold', multiplier: null };
    }

    case 'loose': {
      // Raise 3x: pair 6+ or better
      if (hasTwoPairOrBetterHand) return { action: 'raise', multiplier: 3 };
      if (pairRank6OrBetter) return { action: 'raise', multiplier: 3 };
      // Raise 1x: any hand not folded
      // Fold: pair 5 or worse with no improvement path (hand resolved)
      if (pairRank5OrWorse) {
        return { action: 'fold', multiplier: null };
      }
      return { action: 'raise', multiplier: 1 };
    }

    default:
      return { action: 'fold', multiplier: null };
  }
}

// ─── Apply AI decision to state ───────────────────────────────────────────────

function applyAiDecision(seat, decision, street, ms) {
  if (decision.action === 'fold') {
    ms.bets[seat].folded = true;
  } else {
    // raise
    const betAmount = ms.bets[seat].ante * decision.multiplier;
    if (street === 'third_street') ms.bets[seat].thirdStreet = betAmount;
    else if (street === 'fourth_street') ms.bets[seat].fourthStreet = betAmount;
    else if (street === 'fifth_street') ms.bets[seat].fifthStreet = betAmount;
  }
}

// ─── Resolve all AI showdowns ─────────────────────────────────────────────────

function resolveAiShowdowns(ms) {
  const aiShowdown = [];
  for (let seat = 1; seat <= 5; seat++) {
    if (ms.bets[seat].folded) continue;

    const cardStrings = [...ms.holeCards[seat], ...ms.communityCards];
    const hand = Hand.solve(cardStrings);
    const totalBet = ms.bets[seat].ante +
                     ms.bets[seat].thirdStreet +
                     ms.bets[seat].fourthStreet +
                     ms.bets[seat].fifthStreet;

    const result = resolveMainHand(hand, totalBet);
    const aiBonusResult = resolveBonusForSeat(ms, seat);

    aiShowdown.push({
      seat,
      holeCards: ms.holeCards[seat],
      communityCards: ms.communityCards,
      handName: result.handName,
      totalBet: result.totalBet,
      payout: result.payout,
      net: result.net,
      bonusResult: aiBonusResult
    });
  }
  return aiShowdown;
}

// ─── Fold resolution handler ───────────────────────────────────────────────────

function resolveFold(ms, foldStreet) {
  // foldStreet: 'third_street' | 'fourth_street' | 'fifth_street'
  const streetSequence = ['third_street', 'fourth_street', 'fifth_street'];
  const foldIdx = streetSequence.indexOf(foldStreet);

  // Process remaining streets: AI decisions + deal community cards
  for (let i = foldIdx + 1; i < streetSequence.length; i++) {
    const street = streetSequence[i];
    if (street === 'fourth_street' && ms.communityCards.length < 1) {
      ms.communityCards.push(ms.deck[ms.deckIndex++]);
    }
    if (street === 'fifth_street' && ms.communityCards.length < 2) {
      ms.communityCards.push(ms.deck[ms.deckIndex++]);
    }
    for (let seat = 1; seat <= 5; seat++) {
      if (ms.bets[seat].folded) continue;
      const aiProfile = ms.aiProfiles.find(p => p.seat === seat);
      const decision = street === 'third_street'
        ? decide3rdStreet(ms.holeCards[seat], aiProfile.profile)
        : street === 'fourth_street'
          ? decide4thStreet(ms.holeCards[seat], ms.communityCards, aiProfile.profile)
          : decide5thStreet(ms.holeCards[seat], ms.communityCards, aiProfile.profile);
      applyAiDecision(seat, decision, street, ms);
    }
  }

  // Ensure both community cards are dealt
  while (ms.communityCards.length < 2) {
    ms.communityCards.push(ms.deck[ms.deckIndex++]);
  }

  // Resolve AI showdowns
  const aiShowdown = resolveAiShowdowns(ms);

  // Resolve human bonus
  const bonusResult = resolveBonusForSeat(ms, 0);

  // Apply bonus payout to human bankroll
  if (bonusResult && bonusResult.bonusPayout > 0) {
    ms.bankroll += bonusResult.bonusPayout + bonusResult.bonusBet;
  }

  // Check bust
  if (ms.bankroll <= 0) {
    ms.sessionActive = false;
  }

  // Reset phase to idle before response is sent
  ms.phase = 'idle';

  return { aiShowdown, bonusResult };
}

// ─── Factory function ─────────────────────────────────────────────────────────

module.exports = function createMississippiRouter(stateContainer) {
  const router = express.Router();

  // ── POST /api/mississippi/new-session ─────────────────────────────────────

  router.post('/api/mississippi/new-session', (req, res) => {
    const ms = stateContainer.mississippi;
    if (ms && ms.sessionActive) {
      return res.status(400).json({
        error: 'Session already active. Cash out to start a new session.'
      });
    }

    // Wholesale replacement
    stateContainer.mississippi = buildInitialState();
    const newMs = stateContainer.mississippi;

    // Assign 2 Tight, 2 Balanced, 1 Loose — Fisher-Yates shuffle
    const profiles = ['tight', 'tight', 'balanced', 'balanced', 'loose'];
    for (let i = profiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [profiles[i], profiles[j]] = [profiles[j], profiles[i]];
    }

    // Assign random non-repeating names
    const shuffledNames = [...AI_NAMES].sort(() => Math.random() - 0.5).slice(0, 5);

    newMs.aiProfiles = [];
    for (let i = 0; i < 5; i++) {
      newMs.aiProfiles.push({
        seat: i + 1,
        name: shuffledNames[i],
        profile: profiles[i]
      });
    }

    newMs.sessionActive = true;

    return res.json({
      success: true,
      bankroll: newMs.bankroll,
      sessionActive: newMs.sessionActive,
      phase: newMs.phase,
      handNumber: newMs.handNumber,
      aiPlayers: newMs.aiProfiles.map(p => ({
        seat: p.seat,
        name: p.name,
        profile: p.profile
      }))
    });
  });

  // ── POST /api/mississippi/ante ────────────────────────────────────────────

  router.post('/api/mississippi/ante', (req, res) => {
    const ms = stateContainer.mississippi;
    const { ante, bonus } = req.body;

    // Validation
    if (!ms || !ms.sessionActive) {
      return res.status(400).json({ error: 'No active session. Start a new session first.' });
    }
    if (ms.phase !== 'idle') {
      return res.status(400).json({ error: 'Action not allowed in current phase.' });
    }
    if (typeof ante !== 'number' || !Number.isInteger(ante)) {
      return res.status(400).json({ error: 'Ante must be a whole number.' });
    }
    if (ante < 5 || ante > 25) {
      return res.status(400).json({ error: 'Ante must be between $5 and $25.' });
    }

    let bonusAmount = 0;
    if (bonus !== undefined && bonus !== null && bonus !== 0) {
      if (typeof bonus !== 'number' || !Number.isInteger(bonus)) {
        return res.status(400).json({ error: 'Bonus bet must be a whole number.' });
      }
      if (bonus < 1 || bonus > 25) {
        return res.status(400).json({ error: 'Bonus bet must be between $1 and $25.' });
      }
      bonusAmount = bonus;
    }

    if (ms.bankroll < ante + bonusAmount) {
      return res.status(400).json({ error: 'Insufficient bankroll.' });
    }

    // Increment hand number
    ms.handNumber += 1;

    // Reset bets for this hand
    for (let seat = 0; seat <= 5; seat++) {
      ms.bets[seat] = { ante: 0, thirdStreet: 0, fourthStreet: 0, fifthStreet: 0, bonus: 0, folded: false };
    }

    // Deduct human ante + bonus
    ms.bankroll -= (ante + bonusAmount);
    ms.bets[0].ante = ante;
    ms.bets[0].bonus = bonusAmount;

    // Deal cards
    const deck = shuffle(buildDeck());
    ms.deck = deck;
    ms.deckIndex = 0;
    ms.communityCards = [];

    for (let seat = 0; seat <= 5; seat++) {
      ms.holeCards[seat] = [deck[ms.deckIndex++], deck[ms.deckIndex++], deck[ms.deckIndex++]];
    }

    // AI antes and bonus decisions
    const aiActions = [];
    for (let i = 0; i < ms.aiProfiles.length; i++) {
      const { seat, profile } = ms.aiProfiles[i];
      ms.bets[seat].ante = ante;

      let aiBonus = false;
      if (profile === 'tight') {
        aiBonus = false;
      } else if (profile === 'balanced') {
        aiBonus = Math.random() < 0.5;
      } else { // loose
        aiBonus = true;
      }

      if (aiBonus) {
        ms.bets[seat].bonus = ante; // AI bonus equals human's ante
      }

      aiActions.push({ seat, ante, bonus: aiBonus });
    }

    // Transition phase
    ms.phase = 'third_street';

    return res.json({
      success: true,
      phase: 'third_street',
      handNumber: ms.handNumber,
      bankroll: ms.bankroll,
      holeCards: ms.holeCards[0],
      communityCards: [],
      bets: {
        ante: ms.bets[0].ante,
        bonus: ms.bets[0].bonus,
        thirdStreet: 0,
        fourthStreet: 0,
        fifthStreet: 0
      },
      aiActions
    });
  });

  // ── POST /api/mississippi/third-street ────────────────────────────────────

  router.post('/api/mississippi/third-street', (req, res) => {
    const ms = stateContainer.mississippi;
    const { action, multiplier } = req.body;

    // Validation
    if (!ms || !ms.sessionActive) {
      return res.status(400).json({ error: 'No active session. Start a new session first.' });
    }
    if (ms.phase !== 'third_street') {
      return res.status(400).json({ error: 'Action not allowed in current phase.' });
    }
    if (action !== 'raise' && action !== 'fold') {
      return res.status(400).json({ error: 'Invalid action. Must be raise or fold.' });
    }
    if (action === 'raise') {
      if (typeof multiplier !== 'number' || (multiplier !== 1 && multiplier !== 3)) {
        return res.status(400).json({ error: 'Invalid raise multiplier. Must be 1 or 3.' });
      }
      const betAmount = ms.bets[0].ante * multiplier;
      if (ms.bankroll < betAmount) {
        return res.status(400).json({ error: 'Insufficient bankroll.' });
      }
    }

    if (action === 'fold') {
      ms.bets[0].folded = true;
      const mainHandLoss = -(ms.bets[0].ante + ms.bets[0].bonus);
      // mainHandLoss informational: ante is lost, bonus handled separately
      // Actually per spec: main hand loss = ante only (bonus resolves independently)
      const mainHandBetsLost = ms.bets[0].ante;

      // AI decisions for 3rd street (for non-folded AIs)
      for (let seat = 1; seat <= 5; seat++) {
        if (ms.bets[seat].folded) continue;
        const aiProfile = ms.aiProfiles.find(p => p.seat === seat);
        const decision = decide3rdStreet(ms.holeCards[seat], aiProfile.profile);
        applyAiDecision(seat, decision, 'third_street', ms);
      }

      // Complete fold resolution (deal remaining community cards, run remaining streets, showdown)
      const { aiShowdown, bonusResult } = resolveFold(ms, 'third_street');

      const bankrollBeforeBonus = ms.bankroll; // already updated inside resolveFold

      return res.json({
        success: true,
        phase: 'showdown',
        action: 'fold',
        humanFolded: true,
        mainHandLoss: -mainHandBetsLost,
        communityCards: ms.communityCards,
        bankroll: bankrollBeforeBonus,
        bonusResult: bonusResult || null,
        aiShowdown,
        finalBankroll: ms.bankroll,
        sessionEnded: !ms.sessionActive
      });
    }

    // Raise
    const betAmount = ms.bets[0].ante * multiplier;
    ms.bankroll -= betAmount;
    ms.bets[0].thirdStreet = betAmount;

    // AI decisions for 3rd street
    const aiActions = [];
    for (let seat = 1; seat <= 5; seat++) {
      if (ms.bets[seat].folded) continue;
      const aiProfile = ms.aiProfiles.find(p => p.seat === seat);
      const decision = decide3rdStreet(ms.holeCards[seat], aiProfile.profile);
      applyAiDecision(seat, decision, 'third_street', ms);
      const entry = { seat, action: decision.action };
      if (decision.action === 'raise') entry.multiplier = decision.multiplier;
      aiActions.push(entry);
    }

    ms.phase = 'fourth_street';

    return res.json({
      success: true,
      phase: 'fourth_street',
      action: 'raise',
      multiplier,
      bankroll: ms.bankroll,
      bets: {
        ante: ms.bets[0].ante,
        bonus: ms.bets[0].bonus,
        thirdStreet: ms.bets[0].thirdStreet,
        fourthStreet: 0,
        fifthStreet: 0
      },
      aiActions
    });
  });

  // ── POST /api/mississippi/fourth-street ───────────────────────────────────

  router.post('/api/mississippi/fourth-street', (req, res) => {
    const ms = stateContainer.mississippi;
    const { action, multiplier } = req.body;

    // Validation
    if (!ms || !ms.sessionActive) {
      return res.status(400).json({ error: 'No active session. Start a new session first.' });
    }
    if (ms.phase !== 'fourth_street') {
      return res.status(400).json({ error: 'Action not allowed in current phase.' });
    }
    if (action !== 'raise' && action !== 'fold') {
      return res.status(400).json({ error: 'Invalid action. Must be raise or fold.' });
    }
    if (action === 'raise') {
      if (typeof multiplier !== 'number' || (multiplier !== 1 && multiplier !== 3)) {
        return res.status(400).json({ error: 'Invalid raise multiplier. Must be 1 or 3.' });
      }
      const betAmount = ms.bets[0].ante * multiplier;
      if (ms.bankroll < betAmount) {
        return res.status(400).json({ error: 'Insufficient bankroll.' });
      }
    }

    // Deal 1st community card before human decision
    if (ms.communityCards.length < 1) {
      ms.communityCards.push(ms.deck[ms.deckIndex++]);
    }

    if (action === 'fold') {
      ms.bets[0].folded = true;
      const mainHandBetsLost = ms.bets[0].ante + ms.bets[0].thirdStreet;

      // AI decisions for 4th street
      for (let seat = 1; seat <= 5; seat++) {
        if (ms.bets[seat].folded) continue;
        const aiProfile = ms.aiProfiles.find(p => p.seat === seat);
        const decision = decide4thStreet(ms.holeCards[seat], ms.communityCards, aiProfile.profile);
        applyAiDecision(seat, decision, 'fourth_street', ms);
      }

      // Complete fold resolution
      const { aiShowdown, bonusResult } = resolveFold(ms, 'fourth_street');

      return res.json({
        success: true,
        phase: 'showdown',
        action: 'fold',
        humanFolded: true,
        mainHandLoss: -mainHandBetsLost,
        communityCards: ms.communityCards,
        bankroll: ms.bankroll,
        bonusResult: bonusResult || null,
        aiShowdown,
        finalBankroll: ms.bankroll,
        sessionEnded: !ms.sessionActive
      });
    }

    // Raise
    const betAmount = ms.bets[0].ante * multiplier;
    ms.bankroll -= betAmount;
    ms.bets[0].fourthStreet = betAmount;

    // AI decisions for 4th street
    const aiActions = [];
    for (let seat = 1; seat <= 5; seat++) {
      if (ms.bets[seat].folded) continue;
      const aiProfile = ms.aiProfiles.find(p => p.seat === seat);
      const decision = decide4thStreet(ms.holeCards[seat], ms.communityCards, aiProfile.profile);
      applyAiDecision(seat, decision, 'fourth_street', ms);
      const entry = { seat, action: decision.action };
      if (decision.action === 'raise') entry.multiplier = decision.multiplier;
      aiActions.push(entry);
    }

    ms.phase = 'fifth_street';

    return res.json({
      success: true,
      phase: 'fifth_street',
      action: 'raise',
      multiplier,
      communityCards: ms.communityCards,
      bankroll: ms.bankroll,
      bets: {
        ante: ms.bets[0].ante,
        bonus: ms.bets[0].bonus,
        thirdStreet: ms.bets[0].thirdStreet,
        fourthStreet: ms.bets[0].fourthStreet,
        fifthStreet: 0
      },
      aiActions
    });
  });

  // ── POST /api/mississippi/fifth-street ────────────────────────────────────

  router.post('/api/mississippi/fifth-street', (req, res) => {
    const ms = stateContainer.mississippi;
    const { action, multiplier } = req.body;

    // Validation
    if (!ms || !ms.sessionActive) {
      return res.status(400).json({ error: 'No active session. Start a new session first.' });
    }
    if (ms.phase !== 'fifth_street') {
      return res.status(400).json({ error: 'Action not allowed in current phase.' });
    }
    if (action !== 'raise' && action !== 'fold') {
      return res.status(400).json({ error: 'Invalid action. Must be raise or fold.' });
    }
    if (action === 'raise') {
      if (typeof multiplier !== 'number' || (multiplier !== 1 && multiplier !== 3)) {
        return res.status(400).json({ error: 'Invalid raise multiplier. Must be 1 or 3.' });
      }
      const betAmount = ms.bets[0].ante * multiplier;
      if (ms.bankroll < betAmount) {
        return res.status(400).json({ error: 'Insufficient bankroll.' });
      }
    }

    // Deal 2nd community card before human decision
    if (ms.communityCards.length < 2) {
      ms.communityCards.push(ms.deck[ms.deckIndex++]);
    }

    if (action === 'fold') {
      ms.bets[0].folded = true;
      const mainHandBetsLost = ms.bets[0].ante + ms.bets[0].thirdStreet + ms.bets[0].fourthStreet;

      // AI decisions for 5th street
      for (let seat = 1; seat <= 5; seat++) {
        if (ms.bets[seat].folded) continue;
        const aiProfile = ms.aiProfiles.find(p => p.seat === seat);
        const decision = decide5thStreet(ms.holeCards[seat], ms.communityCards, aiProfile.profile);
        applyAiDecision(seat, decision, 'fifth_street', ms);
      }

      // Complete fold resolution
      const { aiShowdown, bonusResult } = resolveFold(ms, 'fifth_street');

      return res.json({
        success: true,
        phase: 'showdown',
        action: 'fold',
        humanFolded: true,
        mainHandLoss: -mainHandBetsLost,
        communityCards: ms.communityCards,
        bankroll: ms.bankroll,
        bonusResult: bonusResult || null,
        aiShowdown,
        finalBankroll: ms.bankroll,
        sessionEnded: !ms.sessionActive
      });
    }

    // Raise — this is 5th street, so full showdown follows
    const betAmount = ms.bets[0].ante * multiplier;
    ms.bankroll -= betAmount;
    ms.bets[0].fifthStreet = betAmount;

    // AI decisions for 5th street
    const aiActions = [];
    for (let seat = 1; seat <= 5; seat++) {
      if (ms.bets[seat].folded) continue;
      const aiProfile = ms.aiProfiles.find(p => p.seat === seat);
      const decision = decide5thStreet(ms.holeCards[seat], ms.communityCards, aiProfile.profile);
      applyAiDecision(seat, decision, 'fifth_street', ms);
      const entry = { seat, action: decision.action };
      if (decision.action === 'raise') entry.multiplier = decision.multiplier;
      aiActions.push(entry);
    }

    // Resolve human hand
    const humanCardStrings = [...ms.holeCards[0], ...ms.communityCards];
    const humanHand = Hand.solve(humanCardStrings);
    const humanTotalBet = ms.bets[0].ante + ms.bets[0].thirdStreet +
                          ms.bets[0].fourthStreet + ms.bets[0].fifthStreet;
    const humanResult = resolveMainHand(humanHand, humanTotalBet);

    // Apply human main hand payout
    ms.bankroll += humanResult.payout;

    // Resolve human bonus
    const bonusResult = resolveBonusForSeat(ms, 0);
    if (bonusResult && bonusResult.bonusPayout > 0) {
      ms.bankroll += bonusResult.bonusPayout + bonusResult.bonusBet;
    }

    // Resolve AI showdowns
    const aiShowdown = resolveAiShowdowns(ms);

    // Bust check
    if (ms.bankroll <= 0) {
      ms.sessionActive = false;
    }

    const sessionEnded = !ms.sessionActive;
    const finalBankroll = ms.bankroll;

    // Reset phase to idle before response is sent
    ms.phase = 'idle';

    return res.json({
      success: true,
      phase: 'showdown',
      action: 'raise',
      multiplier,
      communityCards: ms.communityCards,
      bankroll: ms.bankroll,
      bets: {
        ante: ms.bets[0].ante,
        bonus: ms.bets[0].bonus,
        thirdStreet: ms.bets[0].thirdStreet,
        fourthStreet: ms.bets[0].fourthStreet,
        fifthStreet: ms.bets[0].fifthStreet
      },
      humanResult: {
        holeCards: ms.holeCards[0],
        communityCards: ms.communityCards,
        handName: humanResult.handName,
        handRank: humanResult.handRank,
        totalBet: humanResult.totalBet,
        payout: humanResult.payout,
        net: humanResult.net
      },
      bonusResult: bonusResult || null,
      aiShowdown,
      finalBankroll,
      sessionEnded
    });
  });

  // ── POST /api/mississippi/cash-out ────────────────────────────────────────

  router.post('/api/mississippi/cash-out', (req, res) => {
    const ms = stateContainer.mississippi;

    if (!ms || !ms.sessionActive) {
      return res.status(400).json({ error: 'No active session.' });
    }
    if (ms.phase !== 'idle') {
      return res.status(400).json({ error: 'Cannot cash out mid-hand.' });
    }

    const finalBankroll = ms.bankroll;
    const handsPlayed = ms.handNumber;
    ms.sessionActive = false;

    return res.json({
      success: true,
      finalBankroll,
      sessionEnded: true,
      handsPlayed
    });
  });

  // ── GET /api/mississippi/state ────────────────────────────────────────────

  router.get('/api/mississippi/state', (req, res) => {
    const ms = stateContainer.mississippi;

    if (!ms || !ms.sessionActive) {
      return res.json({ phase: 'idle', sessionActive: false });
    }

    return res.json({
      phase: ms.phase,
      bankroll: ms.bankroll,
      handNumber: ms.handNumber,
      sessionActive: ms.sessionActive,
      holeCards: ms.holeCards[0],
      communityCards: ms.communityCards,
      bets: {
        ante: ms.bets[0].ante,
        bonus: ms.bets[0].bonus,
        thirdStreet: ms.bets[0].thirdStreet,
        fourthStreet: ms.bets[0].fourthStreet,
        fifthStreet: ms.bets[0].fifthStreet
      },
      aiPlayers: ms.aiProfiles.map(p => ({
        seat: p.seat,
        name: p.name,
        profile: p.profile
      }))
    });
  });

  return router;
};
