'use strict';

const express                                           = require('express');
const crypto                                            = require('crypto');
const { Hand }                                          = require('pokersolver');
const { isThreeCardStraight, getThreeCardHandName }     = require('../shared/cards');
const { buildDeck, shuffle }                            = require('../shared/deck');

// ─── Let It Ride: Main pay table lookup ──────────────────────────────────────

function lirMainPayout(handName) {
  const table = {
    'Royal Flush': 1000,
    'Straight Flush': 200,
    'Four of a Kind': 50,
    'Full House': 11,
    'Flush': 8,
    'Straight': 5,
    'Three of a Kind': 3,
    'Two Pair': 2
  };
  return table[handName] || 0;
}

// ─── Let It Ride: Pair rank qualification (Pair of 10s or Better) ─────────────

function lirPairPayout(hand) {
  if (hand.name !== 'Pair') return 0;
  const qualifyingRanks = ['T', 'J', 'Q', 'K', 'A'];
  const pairRank = hand.cards
    .map(c => c.value)
    .find((v, _, arr) => arr.filter(x => x === v).length >= 2);
  return qualifyingRanks.includes(pairRank) ? 1 : 0;
}

// ─── Let It Ride: 5-card hand evaluation ─────────────────────────────────────

function computeLIRMain(holeCards, communityCards) {
  const allFive = [...holeCards, communityCards[0], communityCards[1]];
  const hand = Hand.solve(allFive);
  const name = hand.name;

  let multiplier = lirMainPayout(name);
  if (multiplier === 0 && name === 'Pair') {
    multiplier = lirPairPayout(hand);
  }
  return { handName: name, multiplier, hand };
}

// ─── Let It Ride: Net change calculation (correct accounting — Section 2.3) ──

function computeLIRNetChange(player, multiplier, bonusPayout) {
  const baseBet = player.bet3; // bet3 is always the original base amount (never withdrawn)
  let net = 0;

  // Bet 1
  if (!player.bet1Withdrawn) {
    if (multiplier > 0) {
      net += baseBet * (multiplier + 1); // profit + bet return
    }
    // else: loss — bet was already deducted at placement, no further change
  }
  // else: withdrawn — bet was returned at decision time, no further change

  // Bet 2
  if (!player.bet2Withdrawn) {
    if (multiplier > 0) {
      net += baseBet * (multiplier + 1); // profit + bet return
    }
  }

  // Bet 3 (always rides)
  if (multiplier > 0) {
    net += baseBet * (multiplier + 1); // profit + bet return
  }

  // Bonus bet
  if (player.bonusBet > 0) {
    if (bonusPayout > 0) {
      net += player.bonusBet * (bonusPayout + 1); // profit + bet return
    }
    // else: loss — already deducted, no further change
  }

  return net;
}

// ─── Let It Ride: 3-card bonus bet evaluation ────────────────────────────────
// CRITICAL: uses getThreeCardHandName(), NOT Hand.solve() — pokersolver fails 3-card hands

function lirBonusPayout(holeCards, bonusBet) {
  if (bonusBet === 0) return { payout: 0, handName: null };
  const name = getThreeCardHandName(holeCards); // standalone 3-card evaluator

  // Royal flush: A-K-Q suited
  if (name === 'straight flush') {
    const ranks = holeCards.map(c => c[0]);
    const isRoyal = ranks.includes('A') && ranks.includes('K') && ranks.includes('Q');
    if (isRoyal) return { payout: 1000, handName: 'Royal Flush' };
    return { payout: 200, handName: 'Straight Flush' };
  }
  if (name === 'three of a kind') return { payout: 50, handName: 'Three of a Kind' };
  if (name === 'straight') return { payout: 6, handName: 'Straight' };
  if (name === 'flush') return { payout: 3, handName: 'Flush' };
  if (name === 'pair') return { payout: 1, handName: 'Pair' };
  return { payout: 0, handName: 'High Card' };
}

// ─── Let It Ride: AI Bet 1 decision ──────────────────────────────────────────
// CRITICAL BUG FIX: spec has hand.rank >= 2 (makes pair block unreachable); corrected to hand.rank > 2
// ADVERSARY-1 FIX: standalone evaluator guard for 3-card straights/flushes/SFs

function lirBet1Decision(holeCards, skillTier) {
  const hand = Hand.solve(holeCards);

  // Three-of-a-kind or better (pokersolver rank >= 3): always ride
  if (hand.rank > 2) return 'ride';

  // Pair (pokersolver rank === 2): refine by pair rank
  if (hand.rank === 2) {
    const qualifyingRanks = ['T', 'J', 'Q', 'K', 'A'];
    const pairRank = holeCards
      .map(c => c[0])
      .find((r, _, arr) => arr.filter(x => x === r).length === 2);
    if (qualifyingRanks.includes(pairRank)) return 'ride';
    // Low pair: tier-dependent
    if (skillTier === 'loose-passive' || skillTier === 'loose-aggressive') return 'ride';
    return 'withdraw'; // tight-aggressive withdraws on low pair
  }

  // pokersolver returns rank=1 for 3-card straights/flushes/SFs.
  // Catch made hands via standalone evaluator before falling through to draws.
  const threeCardName = getThreeCardHandName(holeCards);
  if (threeCardName === 'straight flush' || threeCardName === 'flush' || threeCardName === 'straight') {
    return 'ride'; // any made hand always rides
  }

  // No made hand — check drawing potential
  const suits = holeCards.map(c => c[1]);
  const suitCounts = {};
  suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
  const isThreeFlush = Math.max(...Object.values(suitCounts)) === 3;

  const rankOrder = 'AKQJT98765432';
  const indices = holeCards.map(c => rankOrder.indexOf(c[0])).sort((a, b) => a - b);
  const isThreeStraight = (indices[2] - indices[0] === 2) ||
    (indices[0] === 0 && indices[1] === 11 && indices[2] === 12); // A-2-3

  if (skillTier === 'loose-aggressive') {
    if (isThreeFlush || isThreeStraight) return 'ride';
    return 'withdraw';
  }

  if (skillTier === 'loose-passive') {
    if (isThreeFlush) return 'ride';
    return 'withdraw';
  }

  // tight-aggressive: ride only on three-flush with at least one high card (10+)
  const highCards = holeCards.filter(c => 'TJQKA'.includes(c[0]));
  if (isThreeFlush && highCards.length >= 1) return 'ride';
  return 'withdraw';
}

// ─── Let It Ride: AI Bet 2 decision ──────────────────────────────────────────

function lirBet2Decision(holeCards, card1, skillTier) {
  const fourCards = [...holeCards, card1];

  const ranks = fourCards.map(c => c[0]);
  const rankCounts = {};
  ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
  const maxCount = Math.max(...Object.values(rankCounts));

  // Three-of-a-kind or better in 4 cards: always ride
  if (maxCount >= 3) return 'ride';

  // Two pair in 4 cards: always ride
  const pairs = Object.values(rankCounts).filter(c => c === 2).length;
  if (pairs >= 2) return 'ride';

  // High pair (10s or better): always ride
  const qualifyingRanks = ['T', 'J', 'Q', 'K', 'A'];
  const highPairRank = Object.keys(rankCounts).find(r =>
    rankCounts[r] === 2 && qualifyingRanks.includes(r)
  );
  if (highPairRank) return 'ride';

  // Four-flush (4 of same suit): always ride
  const suits = fourCards.map(c => c[1]);
  const suitCounts = {};
  suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
  if (Math.max(...Object.values(suitCounts)) === 4) return 'ride';

  // Four-card open-ended straight: tier-dependent
  const indices = fourCards.map(c => 'AKQJT98765432'.indexOf(c[0])).sort((a, b) => a - b);
  const isOpenStraight = (indices[3] - indices[0] === 3) &&
    new Set(indices).size === 4;

  if (skillTier === 'loose-aggressive') {
    if (isOpenStraight) return 'ride';
    return 'withdraw';
  }

  if (skillTier === 'loose-passive') {
    return 'withdraw';
  }

  // tight-aggressive: withdraw unless strong draw
  return 'withdraw';
}

// ─── Let It Ride: AI bet computation ─────────────────────────────────────────

function computeAIBetsLIR(player, config) {
  const { minBet, maxBet } = config;
  const tier = player.skillTier;

  // AI sits out if bankroll < 3 * minBet
  if (player.bankroll < 3 * minBet) {
    return { baseBet: 0, bonusBet: 0, totalCost: 0 };
  }

  // Base bet by tier
  const targetBase = (tier === 'loose-aggressive') ? maxBet : minBet;
  // Cap so 3 * baseBet does not exceed bankroll
  const baseBet = Math.min(targetBase, Math.floor(player.bankroll / 3));

  // All tiers place bonus bet
  const canAffordBonus = player.bankroll >= (baseBet * 3 + baseBet);
  const bonusBet = canAffordBonus ? baseBet : 0;

  const totalCost = baseBet * 3 + bonusBet;
  return { baseBet, bonusBet, totalCost };
}

// ─── Let It Ride: Per-hand field reset ────────────────────────────────────────

function resetHandLIR(gs) {
  gs.community.card1 = null;
  gs.community.card2 = null;
  for (const player of gs.players) {
    player.cards = null;
    player.bet1 = 0;
    player.bet2 = 0;
    player.bet3 = 0;
    player.bonusBet = 0;
    player.bet1Withdrawn = false;
    player.bet2Withdrawn = false;
    player.handResult = null;
    player.preBetBankroll = 0;
  }
  gs.phase = 'betting';
}

// ─── Let It Ride: Serializer — ONLY exit path for LIR state (CISO-V4-01) ─────

// SECURITY: All LIR state exits through serializeStateLIR — sole exit path
function serializeStateLIR(gs) {
  const revealCard1 = ['second-decision', 'hand-complete', 'game-over'].includes(gs.phase);
  const revealCard2 = ['hand-complete', 'game-over'].includes(gs.phase);

  return {
    gameId: gs.gameId,
    tournamentType: gs.tournamentType,
    phase: gs.phase,
    handNumber: gs.handNumber,
    config: { ...gs.config },
    humanStatus: gs.humanStatus,
    community: {
      card1: revealCard1 ? gs.community.card1 : null,
      card2: revealCard2 ? gs.community.card2 : null
    },
    players: gs.players.map(p => ({
      id: p.id,
      name: p.name,
      bankroll: p.bankroll,
      seatIndex: p.seatIndex,
      skillTier: p.skillTier,
      status: p.status,
      cards: gs.phase === 'betting' ? null : p.cards,
      bet1: p.bet1,
      bet2: p.bet2,
      bet3: p.bet3,
      bonusBet: p.bonusBet,
      bet1Withdrawn: p.bet1Withdrawn,
      bet2Withdrawn: p.bet2Withdrawn,
      handResult: p.handResult
    }))
  };
}

// ─── initGame — letitride branch ──────────────────────────────────────────────

function initGame(stateContainer, body, res) {
  const { bankroll, minBet, maxBet } = body;

  // Validate bankroll
  if (!Number.isInteger(bankroll) || bankroll < 100 || bankroll > 1000000) {
    return res.status(400).json({ error: 'bankroll must be an integer between 100 and 1000000.' });
  }
  // Validate minBet
  if (!Number.isInteger(minBet) || minBet < 1 || minBet > 10000) {
    return res.status(400).json({ error: 'minBet must be an integer between 1 and 10000.' });
  }
  // Validate maxBet
  if (!Number.isInteger(maxBet) || maxBet < 1 || maxBet > 500000) {
    return res.status(400).json({ error: 'maxBet must be an integer between 1 and 500000.' });
  }
  // maxBet >= minBet
  if (maxBet < minBet) {
    return res.status(400).json({ error: 'maxBet must be greater than or equal to minBet.' });
  }

  // aiCount, startingStack, handsPerLevel, blindSchedule are silently ignored
  const skillTiers = ['loose-passive', 'tight-aggressive', 'loose-aggressive'];
  const aiNames = ['Alex', 'Blake', 'Casey', 'Drew', 'Emery'];

  const players = [];

  // Human player
  players.push({
    id: 'human',
    name: 'You',
    bankroll: bankroll,
    seatIndex: 0,
    skillTier: null,
    status: 'active',
    cards: null,
    bet1: 0,
    bet2: 0,
    bet3: 0,
    bonusBet: 0,
    bet1Withdrawn: false,
    bet2Withdrawn: false,
    handResult: null,
    preBetBankroll: 0
  });

  // AI players (5 fixed players, indices 1-5)
  for (let i = 1; i <= 5; i++) {
    players.push({
      id: crypto.randomUUID(),
      name: aiNames[i - 1],
      bankroll: bankroll,
      seatIndex: i,
      skillTier: skillTiers[Math.floor(Math.random() * 3)],
      status: 'active',
      cards: null,
      bet1: 0,
      bet2: 0,
      bet3: 0,
      bonusBet: 0,
      bet1Withdrawn: false,
      bet2Withdrawn: false,
      handResult: null,
      preBetBankroll: 0
    });
  }

  stateContainer.game = {
    gameId: crypto.randomUUID(),
    tournamentType: 'letitride',
    phase: 'betting',
    players: players,
    community: {
      card1: null,
      card2: null
    },
    handNumber: 1,
    config: {
      bankroll: bankroll,
      minBet: minBet,
      maxBet: maxBet
    },
    humanStatus: 'playing'
  };

  return res.status(200).json(serializeStateLIR(stateContainer.game));
}

// ─── getGameState — letitride branch ─────────────────────────────────────────

function getGameState(stateContainer, res) {
  return res.status(200).json(serializeStateLIR(stateContainer.game));
}

// ─── Router factory ───────────────────────────────────────────────────────────

function createLetitRideRouter(stateContainer) {
  const router = express.Router();

  // POST /api/lir-bet — Human places bets
  router.post('/api/lir-bet', (req, res) => {
    const { gameId, baseBet, bonusBet } = req.body;

    // Step 1: gameId missing
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required.' });
    }

    // Step 2/3: check no-game first (step 3), then gameId mismatch (step 2)
    if (!stateContainer.game) {
      return res.status(404).json({ error: 'No game in progress.' });
    }
    if (gameId !== stateContainer.game.gameId) {
      return res.status(400).json({ error: 'Invalid gameId.' });
    }

    // Step 4: tournament type check
    if (stateContainer.game.tournamentType !== 'letitride') {
      return res.status(400).json({ error: 'This endpoint is only valid for Let It Ride games.' });
    }

    // Step 5: phase check
    if (stateContainer.game.phase !== 'betting') {
      return res.status(400).json({ error: 'Bets cannot be placed at this time.' });
    }

    // Step 6: baseBet must be a positive integer (CISO-V4-05: Number.isInteger, no parseInt)
    if (!Number.isInteger(baseBet) || baseBet < 1) {
      return res.status(400).json({ error: 'baseBet must be a positive integer.' });
    }

    // Step 7: baseBet below minimum
    if (baseBet < stateContainer.game.config.minBet) {
      return res.status(400).json({ error: 'Base bet is below the table minimum.' });
    }

    // Step 8: baseBet above maximum
    if (baseBet > stateContainer.game.config.maxBet) {
      return res.status(400).json({ error: 'Base bet exceeds the table maximum.' });
    }

    // Step 8b: bonusBet strict boolean validation (CISO-V4-03)
    if (bonusBet !== undefined && bonusBet !== true && bonusBet !== false) {
      return res.status(400).json({ error: 'bonusBet must be true or false.' });
    }

    // Step 9: total cost vs bankroll
    const humanPlayer = stateContainer.game.players.find(p => p.id === 'human');
    const totalCost = baseBet * 3 + (bonusBet === true ? baseBet : 0);
    if (totalCost > humanPlayer.bankroll) {
      return res.status(400).json({ error: 'Insufficient bankroll for total bets.' });
    }

    // ==== ALL VALIDATION PASSED — BEGIN MUTATION ====
    // SECURITY: Phase advances synchronously before response. Single-threaded execution prevents race conditions.

    // Mutation 1: Apply human bets
    humanPlayer.preBetBankroll = humanPlayer.bankroll; // record baseline before any deductions
    humanPlayer.bet1 = baseBet;
    humanPlayer.bet2 = baseBet;
    humanPlayer.bet3 = baseBet;
    humanPlayer.bonusBet = bonusBet === true ? baseBet : 0;
    humanPlayer.bankroll -= totalCost;

    // Mutation 2: Compute AI bets
    for (const ai of stateContainer.game.players.filter(p => p.id !== 'human' && p.status !== 'bust')) {
      const aiBets = computeAIBetsLIR(ai, stateContainer.game.config);
      if (aiBets.baseBet === 0) {
        // AI sits out this hand
        ai.bet1 = 0;
        ai.bet2 = 0;
        ai.bet3 = 0;
        ai.bonusBet = 0;
        continue; // do not deal cards
      }
      ai.preBetBankroll = ai.bankroll; // record baseline before any deductions
      ai.bet1 = aiBets.baseBet;
      ai.bet2 = aiBets.baseBet;
      ai.bet3 = aiBets.baseBet;
      ai.bonusBet = aiBets.bonusBet;
      ai.bankroll -= aiBets.totalCost;
    }

    // Mutation 3: Build and shuffle deck
    const deck = shuffle(buildDeck());

    // Mutation 4: Deal 3 hole cards to all players who placed bets (bet3 > 0)
    let deckIdx = 0;
    for (const player of stateContainer.game.players) {
      if (player.bet3 > 0) {
        player.cards = [deck[deckIdx++], deck[deckIdx++], deck[deckIdx++]];
      }
    }

    // Mutation 5: Deal 2 community cards (face-down, stored server-side)
    stateContainer.game.community.card1 = deck[deckIdx++];
    stateContainer.game.community.card2 = deck[deckIdx++];

    // Mutation 6: Advance to first-decision
    stateContainer.game.phase = 'first-decision';

    // Mutation 7: Compute AI Bet 1 decisions immediately
    for (const ai of stateContainer.game.players.filter(p => p.id !== 'human' && p.bet3 > 0)) {
      const decision = lirBet1Decision(ai.cards, ai.skillTier);
      if (decision === 'withdraw') {
        ai.bet1Withdrawn = true;
        ai.bet1 = 0;
        ai.bankroll += ai.bet3; // return baseBet (use bet3 as the immutable base)
      }
    }

    return res.status(200).json(serializeStateLIR(stateContainer.game));
  });

  // POST /api/lir-decision — Human decides to withdraw or ride
  router.post('/api/lir-decision', (req, res) => {
    const { gameId, betNumber, decision } = req.body;

    // Step 1: gameId missing
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required.' });
    }

    // Step 2/3: check no-game first, then gameId mismatch
    if (!stateContainer.game) {
      return res.status(404).json({ error: 'No game in progress.' });
    }
    if (gameId !== stateContainer.game.gameId) {
      return res.status(400).json({ error: 'Invalid gameId.' });
    }

    // Step 4: tournament type check
    if (stateContainer.game.tournamentType !== 'letitride') {
      return res.status(400).json({ error: 'This endpoint is only valid for Let It Ride games.' });
    }

    // Step 5: phase must be first-decision or second-decision
    if (stateContainer.game.phase !== 'first-decision' && stateContainer.game.phase !== 'second-decision') {
      return res.status(400).json({ error: 'No decision required at this time.' });
    }

    // Step 6: betNumber === 1 but phase is second-decision
    if (betNumber === 1 && stateContainer.game.phase === 'second-decision') {
      return res.status(400).json({ error: 'Bet 1 decision has already been made.' });
    }

    // Step 7: betNumber === 2 but phase is first-decision
    if (betNumber === 2 && stateContainer.game.phase === 'first-decision') {
      return res.status(400).json({ error: 'Bet 2 decision is not available yet.' });
    }

    // Step 8: betNumber must be 1 or 2
    if (betNumber !== 1 && betNumber !== 2) {
      return res.status(400).json({ error: 'betNumber must be 1 or 2.' });
    }

    // Step 9: decision must be 'withdraw' or 'ride' (CISO-V4-06: typeof check before string comparison)
    if (typeof decision !== 'string' || (decision !== 'withdraw' && decision !== 'ride')) {
      return res.status(400).json({ error: "Decision must be 'withdraw' or 'ride'." });
    }

    // ==== ALL VALIDATION PASSED — BEGIN MUTATION ====

    const humanPlayer = stateContainer.game.players.find(p => p.id === 'human');

    // SECURITY: Defense-in-depth guard — Bet 3 can never be withdrawn (CISO-V4-02)
    if (betNumber !== 1 && betNumber !== 2) {
      return res.status(400).json({ error: 'betNumber must be 1 or 2.' });
    }

    // Double-withdrawal guards (CISO-V4-11)
    if (betNumber === 1 && humanPlayer.bet1Withdrawn) {
      return res.status(400).json({ error: 'Bet 1 has already been withdrawn.' });
    }
    if (betNumber === 2 && humanPlayer.bet2Withdrawn) {
      return res.status(400).json({ error: 'Bet 2 has already been withdrawn.' });
    }

    if (stateContainer.game.phase === 'first-decision') {
      try {
        // Mutation after Bet 1 decision
        const baseBet = humanPlayer.bet3; // immutable base amount

        if (decision === 'withdraw') {
          humanPlayer.bet1Withdrawn = true;
          humanPlayer.bet1 = 0;
          humanPlayer.bankroll += baseBet;
        }
        // else 'ride': no change to bet1 or bankroll

        // Reveal community card 1 — phase advances to second-decision
        stateContainer.game.phase = 'second-decision';

        // Compute AI Bet 2 decisions immediately
        for (const ai of stateContainer.game.players.filter(p => p.id !== 'human' && p.bet3 > 0)) {
          const aiDecision = lirBet2Decision(ai.cards, stateContainer.game.community.card1, ai.skillTier);
          if (aiDecision === 'withdraw') {
            ai.bet2Withdrawn = true;
            ai.bet2 = 0;
            ai.bankroll += ai.bet3; // return baseBet
          }
        }

        return res.status(200).json(serializeStateLIR(stateContainer.game));
      } catch (err) {
        console.error('lir-decision bet1 error:', err);
        return res.status(500).json({ error: 'An internal error occurred.' });
      }

    } else {
      try {
        // phase === 'second-decision'
        // Mutation after Bet 2 decision
        const baseBet = humanPlayer.bet3;

        if (decision === 'withdraw') {
          humanPlayer.bet2Withdrawn = true;
          humanPlayer.bet2 = 0;
          humanPlayer.bankroll += baseBet;
        }

        // Reveal community card 2 (visible via serializer at hand-complete)
        // Compute payouts for ALL players who placed bets
        for (const player of stateContainer.game.players) {
          if (player.bet3 === 0 || player.status === 'bust') continue;

          // Main hand evaluation (5 cards)
          const mainResult = computeLIRMain(player.cards, [stateContainer.game.community.card1, stateContainer.game.community.card2]);

          // Bonus bet evaluation (3 hole cards only)
          const bonusResult = lirBonusPayout(player.cards, player.bonusBet);

          // Build LIRResult
          const multiplier = mainResult.multiplier;
          const handResult = {
            handName: mainResult.handName,
            handRank: mainResult.hand.rank,
            mainPayout: multiplier,
            bet1Result: player.bet1Withdrawn ? 'withdrawn' : (multiplier > 0 ? 'win' : 'loss'),
            bet2Result: player.bet2Withdrawn ? 'withdrawn' : (multiplier > 0 ? 'win' : 'loss'),
            bet3Result: multiplier > 0 ? 'win' : 'loss',
            bonusResult: player.bonusBet > 0 ? (bonusResult.payout > 0 ? 'win' : 'loss') : null,
            bonusPayout: bonusResult.payout,
            bonusHandName: bonusResult.handName,
            netChange: 0 // computed below
          };

          // Compute chips returned/won (used to update bankroll)
          const chipsReturned = computeLIRNetChange(player, multiplier, bonusResult.payout);

          player.bankroll += chipsReturned;

          // netChange = finalBankroll - preBetBankroll (pre-bet baseline per spec)
          handResult.netChange = player.bankroll - player.preBetBankroll;

          player.handResult = handResult;
        }

        // Mark bust players
        for (const player of stateContainer.game.players) {
          if (player.bankroll <= 0 && player.status !== 'bust') {
            player.status = 'bust';
          }
        }

        // Set phase to hand-complete
        stateContainer.game.phase = 'hand-complete';

        // Check human bust — transitions to game-over
        const humanAfter = stateContainer.game.players.find(p => p.id === 'human');
        if (humanAfter.bankroll <= 0) {
          stateContainer.game.humanStatus = 'bust';
          stateContainer.game.phase = 'game-over';
        }

        return res.status(200).json(serializeStateLIR(stateContainer.game));
      } catch (err) {
        console.error('lir-decision bet2 error:', err);
        return res.status(500).json({ error: 'An internal error occurred.' });
      }
    }
  });

  // POST /api/lir-next-hand — Advance to next hand
  router.post('/api/lir-next-hand', (req, res) => {
    const { gameId } = req.body;

    // Step 1: gameId missing
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required.' });
    }

    // Step 2/3: check no-game first, then gameId mismatch
    if (!stateContainer.game) {
      return res.status(404).json({ error: 'No game in progress.' });
    }
    if (gameId !== stateContainer.game.gameId) {
      return res.status(400).json({ error: 'Invalid gameId.' });
    }

    // Step 4: tournament type check
    if (stateContainer.game.tournamentType !== 'letitride') {
      return res.status(400).json({ error: 'This endpoint is only valid for Let It Ride games.' });
    }

    // Step 5: humanStatus bust or cashedout (checked before phase to ensure correct error message)
    if (stateContainer.game.humanStatus === 'bust' || stateContainer.game.humanStatus === 'cashedout') {
      return res.status(400).json({ error: 'Session is over.' });
    }

    // Step 6: phase must be hand-complete
    if (stateContainer.game.phase !== 'hand-complete') {
      return res.status(400).json({ error: 'Hand is not complete yet.' });
    }

    // Mutation
    stateContainer.game.handNumber += 1;
    resetHandLIR(stateContainer.game); // sets per-hand fields and phase to 'betting'

    return res.status(200).json(serializeStateLIR(stateContainer.game));
  });

  // POST /api/lir-cashout — Human cashes out
  router.post('/api/lir-cashout', (req, res) => {
    const { gameId } = req.body;

    // Step 1: gameId missing
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required.' });
    }

    // Step 2/3: check no-game first, then gameId mismatch
    if (!stateContainer.game) {
      return res.status(404).json({ error: 'No game in progress.' });
    }
    if (gameId !== stateContainer.game.gameId) {
      return res.status(400).json({ error: 'Invalid gameId.' });
    }

    // Step 4: tournament type check
    if (stateContainer.game.tournamentType !== 'letitride') {
      return res.status(400).json({ error: 'This endpoint is only valid for Let It Ride games.' });
    }

    // Step 5: can only cash out between hands (betting or hand-complete)
    if (stateContainer.game.phase !== 'betting' && stateContainer.game.phase !== 'hand-complete') {
      return res.status(400).json({ error: 'You can only cash out between hands.' });
    }

    // Step 6: Defense-in-depth: reject cashout if already bust or cashed out (CISO-V4-POST-03)
    if (stateContainer.game.humanStatus === 'bust' || stateContainer.game.humanStatus === 'cashedout') {
      return res.status(400).json({ error: 'Session is over.' });
    }

    // Mutation
    stateContainer.game.humanStatus = 'cashedout';
    stateContainer.game.phase = 'game-over';

    return res.status(200).json(serializeStateLIR(stateContainer.game));
  });

  return router;
}

module.exports = createLetitRideRouter;
module.exports.initGame = initGame;
module.exports.getGameState = getGameState;
