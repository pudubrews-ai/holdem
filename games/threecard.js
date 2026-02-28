'use strict';

const express                                           = require('express');
const crypto                                            = require('crypto');
const { Hand }                                          = require('pokersolver');
const { isThreeCardStraight, getThreeCardHandName }     = require('../shared/cards');
const { buildDeck, shuffle }                            = require('../shared/deck');

// ─── 3-Card Poker: Queen-6-4 rule (corrected r2 <= 10) ───────────────────────

function shouldPlay3C(holeCards) {
  // rankOrder index: 0=A, 1=K, 2=Q, 3=J, 4=T, 5=9, 6=8, 7=7, 8=6, 9=5, 10=4, 11=3, 12=2
  const rankOrder = 'A K Q J T 9 8 7 6 5 4 3 2'.split(' ');
  const rankIndex = (card) => rankOrder.indexOf(card[0]);
  const sorted = [...holeCards].sort((a, b) => rankIndex(a) - rankIndex(b));
  const [r0, r1, r2] = sorted.map(rankIndex);
  if (r0 > 2) return false; // worse than Queen
  if (r0 < 2) return true;  // better than Queen (A or K high)
  // Queen high: check second card
  if (r1 < 8) return true;  // second card better than 6 (A,K,Q,J,T,9,8,7 — indices 0-7)
  if (r1 > 8) return false; // second card worse than 6 (5,4,3,2 — indices 9-12)
  // r1 === 8: second card IS '6' — fall through to third-card check below
  // Queen-6: check third card
  // r2 <= 10 means third card is 4 or better (index 10 = '4', index 8 = '6')
  return r2 <= 10;
}

// ─── 3-Card Poker: AI helper functions ────────────────────────────────────────

function hasPairOrBetter3C(holeCards) {
  const name = getThreeCardHandName(holeCards);
  return ['pair', 'flush', 'straight', 'three of a kind', 'straight flush'].includes(name);
}

function hasSixCardBonus3C(holeCards) {
  const suits = holeCards.map(c => c[1]);
  const suitCounts = {};
  suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
  return Math.max(...Object.values(suitCounts)) >= 2;
}

// ─── 3-Card Poker: Dealer qualification ──────────────────────────────────────

function dealerQualifies3C(dealerCards) {
  // Using standalone evaluator — pokersolver fails 3-card straights/flushes
  const handName = getThreeCardHandName(dealerCards);
  if (handName === 'pair' || handName === 'flush' || handName === 'straight' ||
      handName === 'three of a kind' || handName === 'straight flush') {
    return true;
  }
  // High card hand: check if highest card is Queen or better
  const rankOrder = 'AKQJT98765432';
  const indices = dealerCards.map(c => rankOrder.indexOf(c[0]));
  const highIdx = Math.min(...indices); // lower index = higher rank (0=A, 12=2)
  return highIdx <= 2; // index 0=A, 1=K, 2=Q
}

// ─── 3-Card Poker: Ante bonus ─────────────────────────────────────────────────

function anteBonus3C(playerCards, anteBet) {
  const handName = getThreeCardHandName(playerCards);
  if (handName === 'straight flush') return anteBet * 5;
  if (handName === 'three of a kind') return anteBet * 4;
  if (handName === 'straight') return anteBet * 1;
  return 0;
}

// ─── 3-Card Poker: Pair Plus payout — returns 0 on loss, never negative ──────

function pairPlusPayout3C(playerCards, pairPlusBet) {
  if (pairPlusBet === 0) return 0;
  const handName = getThreeCardHandName(playerCards);
  if (handName === 'straight flush') return pairPlusBet * 40;
  if (handName === 'three of a kind') return pairPlusBet * 30;
  if (handName === 'straight') return pairPlusBet * 6;
  if (handName === 'flush') return pairPlusBet * 4;
  if (handName === 'pair') return pairPlusBet * 1;
  return 0; // loss — return 0, NOT negative. computeNetChange3C handles the deduction.
}

// ─── 3-Card Poker: Six Card Bonus payout — uses pokersolver (6-card works) ───

function sixCardPayout3C(playerCards, dealerCards, sixCardBet) {
  if (sixCardBet === 0) return 0;
  const allSix = [...playerCards, ...dealerCards];
  const hand = Hand.solve(allSix);
  if (!hand || typeof hand.name !== 'string') {
    throw new Error('pokersolver returned unexpected result for six-card hand');
  }
  const name = hand.name.toLowerCase();

  // ROYAL FLUSH DETECTION:
  // pokersolver returns hand.name = "Straight Flush" and hand.descr = "Royal Flush"
  // for a royal flush hand. We use hand.descr string comparison.
  // hand.descr = "Royal Flush" for ace-high straight flush.
  const isRoyalFlush = name.includes('royal flush') ||
    (hand.descr && hand.descr.toLowerCase() === 'royal flush');

  if (isRoyalFlush) return sixCardBet * 1000;
  if (name.includes('straight flush')) return sixCardBet * 200;
  if (name.includes('four of a kind')) return sixCardBet * 50;
  if (name.includes('full house')) return sixCardBet * 25;
  if (name.includes('flush')) return sixCardBet * 15;
  if (name.includes('straight')) return sixCardBet * 10;
  if (name.includes('three of a kind')) return sixCardBet * 5;
  return 0; // loss — return 0, NOT negative. computeNetChange3C handles the deduction.
}

// ─── 3-Card Poker: Hand comparison ────────────────────────────────────────────

function compareHands3C(playerCards, dealerCards) {
  // Using standalone evaluator — pokersolver fails 3-card straights/flushes
  const handRank = {
    'straight flush': 6,
    'three of a kind': 5,
    'straight': 4,
    'flush': 3,
    'pair': 2,
    'high card': 1
  };
  const playerName = getThreeCardHandName(playerCards);
  const dealerName = getThreeCardHandName(dealerCards);
  const pr = handRank[playerName];
  const dr = handRank[dealerName];

  if (pr > dr) return 'player';
  if (dr > pr) return 'dealer';

  // Same rank — compare high cards
  const rankOrder = 'AKQJT98765432';
  const playerIndices = playerCards.map(c => rankOrder.indexOf(c[0])).sort((a, b) => a - b);
  const dealerIndices = dealerCards.map(c => rankOrder.indexOf(c[0])).sort((a, b) => a - b);

  for (let i = 0; i < 3; i++) {
    if (playerIndices[i] < dealerIndices[i]) return 'player'; // lower index = higher rank
    if (dealerIndices[i] < playerIndices[i]) return 'dealer';
  }
  return 'tie';
}

// ─── 3-Card Poker: Net change calculation ─────────────────────────────────────

function computeNetChange3C(player, handResult) {
  let net = 0;

  if (!player.folded) {
    // Ante result
    if (handResult.anteResult === 'win') net += player.anteBet;
    else if (handResult.anteResult === 'loss') net -= player.anteBet;
    else if (handResult.anteResult === 'push') net += player.anteBet; // RETURN the already-deducted bet

    // Play result (play bet was deducted at POST /api/3c-play)
    if (handResult.playResult === 'win') net += player.playBet;
    else if (handResult.playResult === 'loss') net -= player.playBet;
    else if (handResult.playResult === 'push') net += player.playBet; // RETURN the already-deducted bet

    // Ante bonus (independent of win/loss)
    net += handResult.anteBonus;
  }
  // Folded: ante was already deducted at placement and is forfeited — do not add back or subtract again.

  // Pair Plus (independent — collected even by folded players)
  if (player.pairPlusBet > 0) {
    if (handResult.pairPlusResult === 'win') net += handResult.pairPlusPayout;
    else net -= player.pairPlusBet; // pairPlusBet was already deducted at placement
  }

  // Six Card Bonus (independent — collected even by folded players)
  if (player.sixCardBet > 0) {
    if (handResult.sixCardResult === 'win') net += handResult.sixCardPayout;
    else net -= player.sixCardBet; // sixCardBet was already deducted at placement
  }

  return net;
}

// ─── 3-Card Poker: AI bet computation (sequential bankroll cap) ───────────────

function computeAIBets3C(player, config) {
  const { minBet, maxBet } = config;
  const tier = player.skillTier;

  if (player.status === 'bust' || player.bankroll <= 0) {
    return { anteBet: 0, pairPlusBet: 0, sixCardBet: 0 };
  }

  // Step 1: Ante
  let remaining = player.bankroll;
  const targetAnte = (tier === 'loose-aggressive') ? maxBet : minBet;
  const anteBet = Math.min(targetAnte, remaining);
  remaining -= anteBet;

  // Step 2: Pair Plus — decision is card-dependent for tight-aggressive
  let pairPlusBet = 0;
  let placePairPlus = false;
  if (tier === 'loose-passive' || tier === 'loose-aggressive') {
    placePairPlus = true;
  } else if (tier === 'tight-aggressive') {
    placePairPlus = hasPairOrBetter3C(player.cards); // cards are already dealt at this point
  }

  if (placePairPlus && remaining > 0) {
    const targetPP = (tier === 'loose-aggressive') ? maxBet : minBet;
    pairPlusBet = Math.min(targetPP, remaining);
    remaining -= pairPlusBet;
  }

  // Step 3: Six Card Bonus — decision is card-dependent for tight-aggressive
  let sixCardBet = 0;
  let placeSixCard = false;
  if (tier === 'loose-passive' || tier === 'loose-aggressive') {
    placeSixCard = true;
  } else if (tier === 'tight-aggressive') {
    placeSixCard = hasSixCardBonus3C(player.cards); // cards are already dealt at this point
  }

  if (placeSixCard && remaining > 0) {
    const targetSC = (tier === 'loose-aggressive') ? maxBet : minBet;
    sixCardBet = Math.min(targetSC, remaining);
    remaining -= sixCardBet;
  }

  return { anteBet, pairPlusBet, sixCardBet };
}

// ─── 3-Card Poker: AI play/fold decision ──────────────────────────────────────

function computeAIPlayDecision3C(player) {
  const tier = player.skillTier;
  if (player.anteBet === 0) return 'fold'; // AI did not place ante (bust or sitting out)
  if (tier === 'loose-passive') return 'play';
  if (tier === 'loose-aggressive') return 'play';
  if (tier === 'tight-aggressive') {
    return shouldPlay3C(player.cards) ? 'play' : 'fold';
  }
  return 'fold'; // defensive default
}

// ─── 3-Card Poker: Hand reset ─────────────────────────────────────────────────

function resetHand3C(gs) {
  gs.dealer.cards = null;
  gs.dealer.qualifies = null;
  for (const player of gs.players) {
    player.cards = null;
    player.anteBet = 0;
    player.playBet = 0;
    player.pairPlusBet = 0;
    player.sixCardBet = 0;
    player.folded = false;
    player.handResult = null;
  }
  gs.phase = 'betting';
  // NOTE: does NOT reset bankroll, status, skillTier, id, name, seatIndex
  // NOTE: does NOT increment handNumber — that is done in POST /api/3c-next-hand before calling this
}

// ─── 3-Card Poker: Serialization — ONLY exit path for 3-Card state ────────────

function serializeState3C(gs) {
  // POSITIVE CHECK: reveal dealer cards only at resolution/hand-complete phases
  const revealDealer = gs.phase === 'resolution' || gs.phase === 'hand-complete';
  return {
    gameId: gs.gameId,
    tournamentType: gs.tournamentType,
    phase: gs.phase,
    handNumber: gs.handNumber,
    config: { ...gs.config },
    humanStatus: gs.humanStatus,
    dealer: {
      cards: revealDealer ? gs.dealer.cards : null,
      qualifies: revealDealer ? gs.dealer.qualifies : null
    },
    players: gs.players.map(p => ({
      id: p.id,
      name: p.name,
      bankroll: p.bankroll,
      seatIndex: p.seatIndex,
      skillTier: p.skillTier,
      status: p.status,
      cards: gs.phase === 'betting' ? null : p.cards, // null during betting (cards not yet dealt)
      anteBet: p.anteBet,
      playBet: p.playBet,
      pairPlusBet: p.pairPlusBet,
      sixCardBet: p.sixCardBet,
      folded: p.folded,
      handResult: p.handResult
    }))
  };
}

// ─── initGame — threecard branch ──────────────────────────────────────────────

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

  // aiCount, startingStack, handsPerLevel, blindSchedule are silently ignored for threecard
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
    anteBet: 0,
    playBet: 0,
    pairPlusBet: 0,
    sixCardBet: 0,
    folded: false,
    handResult: null
  });

  // AI players (5 fixed players, indices 1-5)
  for (let i = 1; i <= 5; i++) {
    players.push({
      id: `ai-${i}`,
      name: aiNames[i - 1],
      bankroll: bankroll,
      seatIndex: i,
      skillTier: skillTiers[Math.floor(Math.random() * 3)],
      status: 'active',
      cards: null,
      anteBet: 0,
      playBet: 0,
      pairPlusBet: 0,
      sixCardBet: 0,
      folded: false,
      handResult: null
    });
  }

  stateContainer.game = {
    gameId: crypto.randomUUID(),
    tournamentType: 'threecard',
    phase: 'betting',
    players: players,
    dealer: {
      cards: null,
      qualifies: null
    },
    handNumber: 1, // initialized to 1, not 0 (ADV-7)
    config: {
      bankroll: bankroll,
      minBet: minBet,
      maxBet: maxBet
    },
    humanStatus: 'playing'
  };

  // resetHand3C sets per-hand fields and phase — deck/cards are handled in /api/3c-bet
  // (resetHand3C called here initializes the first hand's betting phase)
  resetHand3C(stateContainer.game);

  return res.status(200).json(serializeState3C(stateContainer.game));
}

// ─── getGameState — threecard branch ─────────────────────────────────────────

function getGameState(stateContainer, res) {
  return res.status(200).json(serializeState3C(stateContainer.game));
}

// ─── Router factory ───────────────────────────────────────────────────────────

function createThreecardRouter(stateContainer) {
  const router = express.Router();

  // POST /api/3c-bet — Human places bets
  router.post('/api/3c-bet', (req, res) => {
    const { gameId } = req.body;
    const anteBet = req.body.anteBet;
    const pairPlusBet = (req.body.pairPlusBet !== undefined) ? req.body.pairPlusBet : 0;
    const sixCardBet = (req.body.sixCardBet !== undefined) ? req.body.sixCardBet : 0;

    // Step 1: gameId missing
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required.' });
    }

    // Step 2: gameId mismatch (also handles null stateContainer.game)
    if (!stateContainer.game || gameId !== stateContainer.game.gameId) {
      return res.status(400).json({ error: 'Invalid gameId.' });
    }

    // Step 3: (unreachable) no game in progress
    if (!stateContainer.game) {
      return res.status(404).json({ error: 'No game in progress.' });
    }

    // Step 4: tournament type check
    if (stateContainer.game.tournamentType !== 'threecard') {
      return res.status(400).json({ error: 'This endpoint is only valid for 3-Card Poker games.' });
    }

    // Step 5: phase check
    if (stateContainer.game.phase !== 'betting') {
      return res.status(400).json({ error: 'Bets cannot be placed at this time.' });
    }

    // Step 5b: humanStatus check (CISO-V3-12)
    if (stateContainer.game.humanStatus !== 'playing') {
      return res.status(400).json({ error: 'Session is over.' });
    }

    // Step 6: anteBet must be a positive integer
    if (!Number.isInteger(anteBet) || anteBet <= 0) {
      return res.status(400).json({ error: 'anteBet must be a positive integer.' });
    }

    const minBet = stateContainer.game.config.minBet;
    const maxBet = stateContainer.game.config.maxBet;
    const humanPlayer = stateContainer.game.players.find(p => p.id === 'human');

    // Step 7: anteBet below minimum
    if (anteBet < minBet) {
      return res.status(400).json({ error: 'Ante bet is below the table minimum.' });
    }

    // Step 8: anteBet above maximum
    if (anteBet > maxBet) {
      return res.status(400).json({ error: 'Ante bet exceeds the table maximum.' });
    }

    // Step 9: anteBet > bankroll
    if (anteBet > humanPlayer.bankroll) {
      return res.status(400).json({ error: 'Insufficient bankroll for ante bet.' });
    }

    // Normalize optional bets to 0
    const ppBet = (Number.isInteger(pairPlusBet) && pairPlusBet !== 0) ? pairPlusBet : 0;
    const scBet = (Number.isInteger(sixCardBet) && sixCardBet !== 0) ? sixCardBet : 0;

    // Step 10: pairPlusBet range validation (if placing)
    if (ppBet !== 0) {
      if (!Number.isInteger(ppBet)) {
        return res.status(400).json({ error: 'Pair Plus bet is below the table minimum.' });
      }
      if (ppBet < minBet) {
        return res.status(400).json({ error: 'Pair Plus bet is below the table minimum.' });
      }
      if (ppBet > maxBet) {
        return res.status(400).json({ error: 'Pair Plus bet exceeds the table maximum.' });
      }
    }

    // Step 11: pairPlusBet > remaining after anteBet
    if (ppBet > 0 && ppBet > (humanPlayer.bankroll - anteBet)) {
      return res.status(400).json({ error: 'Insufficient bankroll for Pair Plus bet.' });
    }

    // Step 12: sixCardBet range validation (if placing)
    if (scBet !== 0) {
      if (!Number.isInteger(scBet)) {
        return res.status(400).json({ error: 'Six Card Bonus bet is below the table minimum.' });
      }
      if (scBet < minBet) {
        return res.status(400).json({ error: 'Six Card Bonus bet is below the table minimum.' });
      }
      if (scBet > maxBet) {
        return res.status(400).json({ error: 'Six Card Bonus bet exceeds the table maximum.' });
      }
    }

    // Step 13: sixCardBet > remaining after anteBet + pairPlusBet
    if (scBet > 0 && scBet > (humanPlayer.bankroll - anteBet - ppBet)) {
      return res.status(400).json({ error: 'Insufficient bankroll for Six Card Bonus bet.' });
    }

    // Step 14: total safety catch
    if ((anteBet + ppBet + scBet) > humanPlayer.bankroll) {
      return res.status(400).json({ error: 'Insufficient bankroll for total bets.' });
    }

    // ==== ALL 14 VALIDATION STEPS PASSED — BEGIN MUTATION ====

    // Mutation 1: Store bets and deduct from bankroll
    humanPlayer.anteBet = anteBet;
    humanPlayer.pairPlusBet = ppBet;
    humanPlayer.sixCardBet = scBet;
    humanPlayer.bankroll -= (anteBet + ppBet + scBet);

    // Mutation 2: Build and shuffle a fresh 52-card deck
    const deck = shuffle(buildDeck());

    // Mutation 3: Deal 3 cards to human, each active AI, then dealer
    // Deal human first
    humanPlayer.cards = [deck.pop(), deck.pop(), deck.pop()];

    // Deal to each active (non-bust) AI
    const aiPlayers = stateContainer.game.players.filter(p => p.id !== 'human');
    for (const ai of aiPlayers) {
      if (ai.status !== 'bust') {
        ai.cards = [deck.pop(), deck.pop(), deck.pop()];
      }
    }

    // Deal dealer cards (stored server-side, serializeState3C hides them until resolution)
    stateContainer.game.dealer.cards = [deck.pop(), deck.pop(), deck.pop()];

    // Mutation 4: Compute AI bets (sequential bankroll cap) and deduct
    for (const ai of aiPlayers) {
      if (ai.status === 'bust' || ai.bankroll <= 0) continue;
      const bets = computeAIBets3C(ai, stateContainer.game.config);
      ai.anteBet = bets.anteBet;
      ai.pairPlusBet = bets.pairPlusBet;
      ai.sixCardBet = bets.sixCardBet;
      ai.bankroll -= (bets.anteBet + bets.pairPlusBet + bets.sixCardBet);
    }

    // Mutation 5: Compute AI play/fold decisions
    for (const ai of aiPlayers) {
      if (ai.status === 'bust' || ai.anteBet === 0) continue;
      const decision = computeAIPlayDecision3C(ai);
      if (decision === 'play') {
        // Cap play bet to remaining bankroll after ante+pairPlus+sixCard already deducted
        const maxPlayBet = Math.max(0, ai.bankroll);
        const playAmt = Math.min(ai.anteBet, maxPlayBet);
        ai.playBet = playAmt;
        ai.bankroll -= playAmt;
      } else {
        ai.folded = true;
        ai.playBet = 0;
        // anteBet already deducted — forfeited to house
      }
    }

    // Mutation 6: Advance to dealing phase
    stateContainer.game.phase = 'dealing';

    return res.status(200).json(serializeState3C(stateContainer.game));
  });

  // POST /api/3c-play — Human decides to play or fold
  router.post('/api/3c-play', (req, res) => {
    const { gameId, decision } = req.body;

    // Step 1: gameId missing
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required.' });
    }

    // Step 2: gameId mismatch
    if (!stateContainer.game || gameId !== stateContainer.game.gameId) {
      return res.status(400).json({ error: 'Invalid gameId.' });
    }

    // Step 3: (unreachable) no game in progress
    if (!stateContainer.game) {
      return res.status(404).json({ error: 'No game in progress.' });
    }

    // Step 4: tournament type check
    if (stateContainer.game.tournamentType !== 'threecard') {
      return res.status(400).json({ error: 'This endpoint is only valid for 3-Card Poker games.' });
    }

    // Step 5: phase check
    if (stateContainer.game.phase !== 'dealing') {
      return res.status(400).json({ error: 'No play decision required at this time.' });
    }

    // Step 6: decision must be 'play' or 'fold' (strict equality, no normalization)
    if (decision !== 'play' && decision !== 'fold') {
      return res.status(400).json({ error: "Decision must be 'play' or 'fold'." });
    }

    // ==== ALL VALIDATION PASSED — BEGIN MUTATION ====

    const humanPlayer = stateContainer.game.players.find(p => p.id === 'human');

    // Resolution — wrap all mutations including play bet deduction in try/catch
    // so that if pokersolver throws, the deduction has not been partially applied.
    try {
      // Apply human's decision — INSIDE try/catch for atomicity
      if (decision === 'play') {
        humanPlayer.playBet = humanPlayer.anteBet;
        humanPlayer.bankroll -= humanPlayer.playBet;
      } else {
        // fold
        humanPlayer.folded = true;
        humanPlayer.playBet = 0;
        // anteBet was already deducted — forfeited to house
      }

      // Step 1: Reveal dealer
      stateContainer.game.dealer.qualifies = dealerQualifies3C(stateContainer.game.dealer.cards);

      // Step 2: Process EVERY player (including folded ones — ADV-9)
      for (const player of stateContainer.game.players) {
        if (player.status === 'bust') continue; // bust players did not play this hand

        const handResult = {
          anteResult: null,
          playResult: null,
          pairPlusResult: null,
          sixCardResult: null,
          anteBonus: 0,
          pairPlusPayout: 0,
          sixCardPayout: 0,
          netChange: 0
        };

        // a. Ante bonus (only for non-folded players)
        handResult.anteBonus = player.folded ? 0 : anteBonus3C(player.cards, player.anteBet);

        // b. Ante/Play result
        if (player.folded) {
          handResult.anteResult = 'loss';
          handResult.playResult = null;
        } else {
          if (!stateContainer.game.dealer.qualifies) {
            handResult.anteResult = 'win';
            handResult.playResult = 'push';
          } else {
            const comparison = compareHands3C(player.cards, stateContainer.game.dealer.cards);
            if (comparison === 'player') {
              handResult.anteResult = 'win';
              handResult.playResult = 'win';
            } else if (comparison === 'dealer') {
              handResult.anteResult = 'loss';
              handResult.playResult = 'loss';
            } else {
              // tie
              handResult.anteResult = 'push';
              handResult.playResult = 'push';
            }
          }
        }

        // c. Pair Plus (ALL players, including folded)
        const rawPP = pairPlusPayout3C(player.cards, player.pairPlusBet);
        handResult.pairPlusPayout = rawPP; // 0 on loss (never negative)
        handResult.pairPlusResult = rawPP > 0 ? 'win' : (player.pairPlusBet > 0 ? 'loss' : null);

        // d. Six Card Bonus (ALL players, including folded — ADV-9)
        const rawSC = sixCardPayout3C(player.cards, stateContainer.game.dealer.cards, player.sixCardBet);
        handResult.sixCardPayout = rawSC; // 0 on loss (never negative)
        handResult.sixCardResult = rawSC > 0 ? 'win' : (player.sixCardBet > 0 ? 'loss' : null);

        // e. Compute net change
        handResult.netChange = computeNetChange3C(player, handResult);

        // f. Store handResult and apply net change to bankroll
        player.handResult = handResult;
        player.bankroll += handResult.netChange;
      }

      // Step 3: Mark any player with bankroll <= 0 as bust
      for (const player of stateContainer.game.players) {
        if (player.bankroll <= 0 && player.status !== 'bust') {
          player.status = 'bust';
        }
      }

      // Step 4: Set phase to hand-complete
      stateContainer.game.phase = 'hand-complete';

      // Step 5: Check if human is bust or game-over
      if (humanPlayer.bankroll <= 0) {
        stateContainer.game.humanStatus = 'bust';
        stateContainer.game.phase = 'game-over';
      }

    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'An internal error occurred.' });
    }

    return res.status(200).json(serializeState3C(stateContainer.game));
  });

  // POST /api/3c-next-hand — Advance to next hand
  router.post('/api/3c-next-hand', (req, res) => {
    const { gameId } = req.body;

    // Step 1: gameId missing
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required.' });
    }

    // Step 2: gameId mismatch
    if (!stateContainer.game || gameId !== stateContainer.game.gameId) {
      return res.status(400).json({ error: 'Invalid gameId.' });
    }

    // Step 3: (unreachable) no game in progress
    if (!stateContainer.game) {
      return res.status(404).json({ error: 'No game in progress.' });
    }

    // Step 4: tournament type check
    if (stateContainer.game.tournamentType !== 'threecard') {
      return res.status(400).json({ error: 'This endpoint is only valid for 3-Card Poker games.' });
    }

    // Step 5: session is over — check before phase check so cashedout/bust returns correct message
    // (after cashout, phase is 'game-over', not 'hand-complete', so this must fire first)
    if (stateContainer.game.humanStatus === 'bust' || stateContainer.game.humanStatus === 'cashedout') {
      return res.status(400).json({ error: 'Session is over.' });
    }

    // Step 6: phase check
    if (stateContainer.game.phase !== 'hand-complete') {
      return res.status(400).json({ error: 'Hand is not complete yet.' });
    }

    // Increment handNumber first, then reset hand
    stateContainer.game.handNumber += 1;
    resetHand3C(stateContainer.game); // sets per-hand fields to defaults, phase to 'betting'

    return res.status(200).json(serializeState3C(stateContainer.game));
  });

  // POST /api/3c-cashout — Human cashes out
  router.post('/api/3c-cashout', (req, res) => {
    const { gameId } = req.body;

    // Step 1: gameId missing
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required.' });
    }

    // Step 2: gameId mismatch
    if (!stateContainer.game || gameId !== stateContainer.game.gameId) {
      return res.status(400).json({ error: 'Invalid gameId.' });
    }

    // Step 3: (unreachable) no game in progress
    if (!stateContainer.game) {
      return res.status(404).json({ error: 'No game in progress.' });
    }

    // Step 4: tournament type check
    if (stateContainer.game.tournamentType !== 'threecard') {
      return res.status(400).json({ error: 'This endpoint is only valid for 3-Card Poker games.' });
    }

    // Step 5: can only cash out between hands (betting or hand-complete)
    if (stateContainer.game.phase !== 'betting' && stateContainer.game.phase !== 'hand-complete') {
      return res.status(400).json({ error: 'You can only cash out between hands.' });
    }

    // CISO-V3-07: exactly two mutations, nothing else
    stateContainer.game.humanStatus = 'cashedout';
    stateContainer.game.phase = 'game-over';

    return res.status(200).json(serializeState3C(stateContainer.game));
  });

  return router;
}

module.exports = createThreecardRouter;
module.exports.initGame = initGame;
module.exports.getGameState = getGameState;
