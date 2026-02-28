'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Hand } = require('pokersolver');

const app = express();

// ─── Constants ───────────────────────────────────────────────────────────────

const AI_NAMES = [
  'Alex', 'Blake', 'Casey', 'Drew', 'Emery',
  'Finley', 'Gray', 'Harley', 'Indigo', 'Jordan', 'Kendall'
];

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

const AI_THRESHOLDS = {
  'loose-passive':    { fold: 0.20, call: 0.65, raise: 0.65 },
  'tight-aggressive': { fold: 0.35, call: 0.55, raise: 0.55 },
  'loose-aggressive': { fold: 0.15, call: 0.45, raise: 0.45 }
};

const RAISE_MULTIPLIERS = {
  'loose-passive': 0.5,
  'tight-aggressive': 1.0,
  'loose-aggressive': 1.5
};

// ─── Global game state ───────────────────────────────────────────────────────

let gameState = null;

// ─── Security configuration ──────────────────────────────────────────────────

// Disable X-Powered-By header
app.disable('x-powered-by');

// Request body size limit — 10kb on all POST routes
app.use(express.json({ limit: '10kb' }));

// Security headers on ALL responses
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// ─── Card utilities ──────────────────────────────────────────────────────────

function buildDeck() {
  const deck = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(r + s);
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─── Hand strength evaluation ─────────────────────────────────────────────────

function preFlopStrength(holeCards) {
  const ranks = 'A K Q J T 9 8 7 6 5 4 3 2'.split(' ');
  const rankIndex = (card) => ranks.indexOf(card[0]);
  const [c1, c2] = holeCards;
  const r1 = rankIndex(c1), r2 = rankIndex(c2);
  const suited = c1[1] === c2[1];
  const hi = Math.min(r1, r2), lo = Math.max(r1, r2); // 0=Ace, 12=2
  const gap = lo - hi;

  // Pocket pairs
  if (r1 === r2) {
    if (hi <= 2) return 0.95;  // AA, KK, QQ
    if (hi <= 4) return 0.85;  // JJ, TT
    if (hi <= 6) return 0.70;  // 99, 88
    return 0.55;               // 77 and below
  }

  // Connected high cards
  if (hi <= 1 && lo <= 3) return suited ? 0.80 : 0.72; // AK, AQ suited/off
  if (hi === 0 && lo <= 7) return suited ? 0.65 : 0.58; // Ax suited/off
  if (hi <= 3 && gap <= 1) return suited ? 0.68 : 0.60; // Broadway connected
  if (hi <= 4 && gap <= 2) return suited ? 0.58 : 0.50; // High suited connectors
  if (gap <= 1 && suited) return 0.45;  // Mid suited connectors
  if (gap <= 1) return 0.38;            // Mid offsuit connectors
  if (suited) return 0.32;              // Random suited
  return 0.22;                          // Garbage
}

function postFlopStrength(holeCards, communityCards) {
  const hand = Hand.solve([...holeCards, ...communityCards]);
  // hand.rank: 1=high card, 2=pair, 3=two pair, 4=three of kind,
  //            5=straight, 6=flush, 7=full house, 8=four of kind, 9=straight flush
  const strengthMap = {
    1: 0.15, 2: 0.35, 3: 0.55, 4: 0.65,
    5: 0.72, 6: 0.78, 7: 0.88, 8: 0.96, 9: 1.0
  };
  return strengthMap[hand.rank] || 0.15;
}

function drawHandStrength(holeCards) {
  const hand = Hand.solve(holeCards);
  const strengthMap = {
    1: 0.15, 2: 0.35, 3: 0.55, 4: 0.65,
    5: 0.72, 6: 0.78, 7: 0.88, 8: 0.96, 9: 1.0
  };
  return strengthMap[hand.rank] || 0.15;
}

function aiDrawDecision(holeCards, skillTier) {
  const hand = Hand.solve(holeCards);

  // Made hands: keep all 5, discard 0
  if (hand.rank >= 3) { // two pair or better
    return []; // discard nothing
  }

  if (hand.rank === 2) { // one pair
    // Simplified: identify the 2 cards with the most common rank, discard the rest
    const ranks = holeCards.map(c => c[0]);
    const rankCounts = {};
    ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
    const pairRankChar = Object.keys(rankCounts).find(r => rankCounts[r] === 2);
    const toKeep = [];
    const toDiscard = [];
    let keptPair = 0;
    for (const card of holeCards) {
      if (card[0] === pairRankChar && keptPair < 2) {
        toKeep.push(card);
        keptPair++;
      } else {
        toDiscard.push(card);
      }
    }
    return toDiscard; // discard up to 3 non-pair cards
  }

  // No made hand (high card): discard based on tier
  if (skillTier === 'tight-aggressive') {
    // Keep the 2 highest-ranked cards, discard 3
    const rankOrder = 'AKQJT98765432';
    const sorted = [...holeCards].sort((a, b) => rankOrder.indexOf(a[0]) - rankOrder.indexOf(b[0]));
    return sorted.slice(2); // discard the 3 lowest
  }

  if (skillTier === 'loose-passive') {
    // Keep top 1 + 1 random (effectively discard 3 of the lower cards)
    const rankOrder = 'AKQJT98765432';
    const sorted = [...holeCards].sort((a, b) => rankOrder.indexOf(a[0]) - rankOrder.indexOf(b[0]));
    return sorted.slice(1, 4); // discard 3 of the lower cards (keep top 1 + 1 random)
  }

  if (skillTier === 'loose-aggressive') {
    // Keep suited cards if 3+ are same suit (flush draw), otherwise keep 2 highest
    const suitCounts = {};
    holeCards.forEach(c => suitCounts[c[1]] = (suitCounts[c[1]] || 0) + 1);
    const flushSuit = Object.keys(suitCounts).find(s => suitCounts[s] >= 3);
    if (flushSuit) {
      const offsuit = holeCards.filter(c => c[1] !== flushSuit);
      const toDiscard = offsuit.slice(0, 3);
      return toDiscard;
    }
    // No flush draw: keep 2 highest, discard 3
    const rankOrder = 'AKQJT98765432';
    const sorted = [...holeCards].sort((a, b) => rankOrder.indexOf(a[0]) - rankOrder.indexOf(b[0]));
    return sorted.slice(2);
  }

  return []; // fallback: stand pat
}

// ─── Player helpers ───────────────────────────────────────────────────────────

function getNonEliminatedPlayers(gs) {
  return gs.players
    .filter(p => p.status !== 'eliminated')
    .sort((a, b) => a.seatIndex - b.seatIndex);
}

function nextActivePlayerClockwise(gs, fromSeatIndex) {
  const active = getNonEliminatedPlayers(gs);
  const next = active.find(p => p.seatIndex > fromSeatIndex);
  if (next) return next;
  return active[0];
}

// ─── Dealer / blind assignment ─────────────────────────────────────────────

function setDealer(gs, seatIndex) {
  for (const p of gs.players) {
    p.isDealer = false;
    p.isSmallBlind = false;
    p.isBigBlind = false;
  }
  const dealer = gs.players.find(p => p.seatIndex === seatIndex);
  if (dealer) dealer.isDealer = true;
}

function advanceDealer(gs) {
  const currentDealer = gs.players.find(p => p.isDealer);
  const currentDealerSeat = currentDealer ? currentDealer.seatIndex : -1;

  // Clear all dealer/blind flags
  for (const p of gs.players) {
    p.isDealer = false;
    p.isSmallBlind = false;
    p.isBigBlind = false;
  }

  // Advance to next non-eliminated player clockwise
  const nextDealer = nextActivePlayerClockwise(gs, currentDealerSeat);
  nextDealer.isDealer = true;
}

function assignBlinds(gs) {
  const active = getNonEliminatedPlayers(gs);
  const dealerPlayer = active.find(p => p.isDealer);

  if (active.length === 2) {
    // Heads-up: dealer IS small blind
    dealerPlayer.isSmallBlind = true;
    const otherPlayer = active.find(p => p.id !== dealerPlayer.id);
    otherPlayer.isBigBlind = true;
  } else {
    const sbPlayer = nextActivePlayerClockwise(gs, dealerPlayer.seatIndex);
    sbPlayer.isSmallBlind = true;
    const bbPlayer = nextActivePlayerClockwise(gs, sbPlayer.seatIndex);
    bbPlayer.isBigBlind = true;
  }
}

function postBlinds(gs) {
  const sbPlayer = gs.players.find(p => p.isSmallBlind);
  const bbPlayer = gs.players.find(p => p.isBigBlind);

  // Small blind
  const sbAmount = Math.min(gs.smallBlind, sbPlayer.stack);
  sbPlayer.bet = sbAmount;
  sbPlayer.stack -= sbAmount;
  sbPlayer.totalBetThisHand += sbAmount;
  if (sbPlayer.stack === 0) sbPlayer.status = 'all-in';

  // Big blind
  const bbAmount = Math.min(gs.bigBlind, bbPlayer.stack);
  bbPlayer.bet = bbAmount;
  bbPlayer.stack -= bbAmount;
  bbPlayer.totalBetThisHand += bbAmount;
  if (bbPlayer.stack === 0) bbPlayer.status = 'all-in';

  // Set betting parameters — currentBet is always the full big blind
  gs.currentBet = gs.bigBlind;
  gs.minRaise = gs.bigBlind;
  gs.pots = [];  // empty — blinds are in player.bet only
}

// ─── Deck dealing ─────────────────────────────────────────────────────────────

function dealHoleCards(gs) {
  const active = getNonEliminatedPlayers(gs);
  const dealerSeat = gs.players.find(p => p.isDealer).seatIndex;
  const dealerIdx = active.findIndex(p => p.seatIndex === dealerSeat);
  const orderedPlayers = [
    ...active.slice(dealerIdx + 1),
    ...active.slice(0, dealerIdx + 1)
  ];

  for (const player of orderedPlayers) {
    const cardCount = gs.tournamentType === 'fivecard' ? 5 : 2;
    player.holeCards = [];
    for (let c = 0; c < cardCount; c++) {
      player.holeCards.push(gs.deck.pop());
    }
    player.status = 'active';
    player.bet = 0;
    player.totalBetThisHand = 0;
    player.hasActedThisRound = false;
  }
}

// ─── Action seat helpers ──────────────────────────────────────────────────────

function setInitialActionSeat(gs) {
  const active = getNonEliminatedPlayers(gs);

  if (active.length === 2) {
    // Heads-up: SB/dealer acts first pre-flop
    const actionPlayer = active.find(p => p.isSmallBlind);
    gs.actionSeat = actionPlayer.seatIndex;
  } else {
    // UTG: player left of big blind
    const bbPlayer = active.find(p => p.isBigBlind);
    const actionPlayer = nextActivePlayerClockwise(gs, bbPlayer.seatIndex);
    gs.actionSeat = actionPlayer.seatIndex;
  }
}

function setPostFlopActionSeat(gs) {
  const dealerSeat = gs.players.find(p => p.isDealer).seatIndex;
  const activePlayers = gs.players.filter(p => p.status === 'active');

  if (activePlayers.length === 0) {
    gs.actionSeat = null;
    return;
  }

  const sorted = activePlayers.sort((a, b) => a.seatIndex - b.seatIndex);
  const next = sorted.find(p => p.seatIndex > dealerSeat) || sorted[0];
  gs.actionSeat = next.seatIndex;
}

function advanceActionSeat(gs) {
  const current = gs.actionSeat;
  const activePlayers = gs.players.filter(p => p.status === 'active');

  if (activePlayers.length === 0) {
    gs.actionSeat = null;
    return;
  }

  const sorted = activePlayers.sort((a, b) => a.seatIndex - b.seatIndex);
  const next = sorted.find(p => p.seatIndex > current) || sorted[0];
  gs.actionSeat = next.seatIndex;
}

// ─── Blind level advancement ──────────────────────────────────────────────────

function advanceBlindLevel(gs) {
  gs.blindLevel += 1;
  gs.handsPlayedAtThisLevel = 0;

  const schedule = gs.config.blindSchedule;
  gs.blindLevel = Math.min(gs.blindLevel, schedule.length - 1);
  gs.smallBlind = schedule[gs.blindLevel].small;
  gs.bigBlind = schedule[gs.blindLevel].big;
}

// ─── Reset helpers ─────────────────────────────────────────────────────────────

function resetAllBets(gs) {
  for (const player of gs.players) {
    player.bet = 0;
  }
}

function resetActedFlags(gs) {
  for (const player of gs.players) {
    if (player.status !== 'eliminated') {
      player.hasActedThisRound = false;
    }
  }
}

// ─── Side pot algorithm ────────────────────────────────────────────────────────

function buildPots(players, existingPots) {
  let bets = players
    .filter(p => p.bet > 0)
    .map(p => ({ id: p.id, amount: p.bet }));

  const newPots = [];
  while (bets.some(b => b.amount > 0)) {
    const minBet = Math.min(...bets.filter(b => b.amount > 0).map(b => b.amount));
    const contributors = bets.filter(b => b.amount > 0).map(b => b.id);
    const potAmount = contributors.length * minBet;
    newPots.push({ amount: potAmount, eligiblePlayerIds: contributors });
    bets = bets.map(b => ({ id: b.id, amount: Math.max(0, b.amount - minBet) }));
  }

  for (const newPot of newPots) {
    const match = existingPots.find(ep =>
      ep.eligiblePlayerIds.length === newPot.eligiblePlayerIds.length &&
      newPot.eligiblePlayerIds.every(id => ep.eligiblePlayerIds.includes(id))
    );
    if (match) {
      match.amount += newPot.amount;
    } else {
      existingPots.push(newPot);
    }
  }

  return existingPots;
}

// ─── Betting round state machine ──────────────────────────────────────────────

function isBettingRoundComplete(gs) {
  const activePlayers = gs.players.filter(p => p.status === 'active');

  // If no active players remain, round is complete
  if (activePlayers.length === 0) return true;

  // If only one non-folded player remains, round is complete
  const nonFolded = gs.players.filter(p =>
    p.status !== 'folded' && p.status !== 'eliminated'
  );
  if (nonFolded.length <= 1) return true;

  // All active players must have acted AND have matching bets
  return activePlayers.every(p => p.hasActedThisRound && p.bet === gs.currentBet);
}

function processAction(gs, player, action, amount) {
  switch (action) {
    case 'fold':
      player.status = 'folded';
      player.holeCards = null;
      // DO NOT zero player.bet (ADV-PRE-1)
      player.hasActedThisRound = true;
      break;

    case 'check':
      // Only valid when player.bet === currentBet
      player.hasActedThisRound = true;
      break;

    case 'call': {
      const callAmount = Math.min(gs.currentBet - player.bet, player.stack);
      player.bet += callAmount;
      player.stack -= callAmount;
      player.totalBetThisHand += callAmount;
      if (player.stack === 0) player.status = 'all-in';
      player.hasActedThisRound = true;
      break;
    }

    case 'raise': {
      // amount = total bet for the street
      const chipsToAdd = amount - player.bet;
      player.stack -= chipsToAdd;
      player.totalBetThisHand += chipsToAdd;
      player.bet = amount;

      // This IS a full raise (validated by caller)
      gs.minRaise = amount - gs.currentBet;
      gs.currentBet = amount;
      gs.lastAggressorSeat = player.seatIndex;

      // Reset all other active players' hasActedThisRound
      for (const p of gs.players) {
        if (p.id !== player.id && p.status === 'active') {
          p.hasActedThisRound = false;
        }
      }

      if (player.stack === 0) player.status = 'all-in';
      player.hasActedThisRound = true;
      break;
    }

    case 'allin': {
      const allinAmount = player.stack + player.bet; // total bet = existing bet + remaining stack
      const chipsToAdd = player.stack;
      player.bet = allinAmount;
      player.stack = 0;
      player.totalBetThisHand += chipsToAdd;
      player.status = 'all-in';
      player.hasActedThisRound = true;

      // Determine if this is a full raise (three-case disambiguation — ADV-PRE-2)
      if (allinAmount > gs.currentBet) {
        const raiseSize = allinAmount - gs.currentBet;
        if (raiseSize >= gs.minRaise) {
          // Case 3: Full raise — reopens action
          gs.minRaise = raiseSize;
          gs.currentBet = allinAmount;
          gs.lastAggressorSeat = player.seatIndex;
          // Reset others' hasActedThisRound
          for (const p of gs.players) {
            if (p.id !== player.id && p.status === 'active') {
              p.hasActedThisRound = false;
            }
          }
        } else {
          // Case 2: Under-raise all-in — does NOT reopen action
          // currentBet DOES update so subsequent callers must match
          gs.currentBet = allinAmount;
          // minRaise stays the same
          // lastAggressorSeat stays the same
          // Do NOT reset others' hasActedThisRound
        }
      }
      // Case 1: allinAmount <= currentBet — partial call, no changes to currentBet/minRaise
      break;
    }
  }
}

// ─── Community card run-out ────────────────────────────────────────────────────

function runOutCommunityCards(gs) {
  while (gs.communityCards.length < 5) {
    if (gs.communityCards.length === 0) {
      // Deal flop
      gs.communityCards.push(gs.deck.pop(), gs.deck.pop(), gs.deck.pop());
    } else {
      gs.communityCards.push(gs.deck.pop());
    }
  }
}

// ─── Showdown ─────────────────────────────────────────────────────────────────

function runShowdown(gs) {
  // Collect any remaining bets into pots
  buildPots(gs.players, gs.pots);
  resetAllBets(gs);

  const nonFolded = gs.players.filter(p =>
    p.status !== 'folded' && p.status !== 'eliminated'
  );

  if (nonFolded.length === 1) {
    // Everyone else folded — single winner, no card reveal
    const winner = nonFolded[0];
    const totalWinnings = gs.pots.reduce((sum, p) => sum + p.amount, 0);
    winner.stack += totalWinnings;
    gs.pots = [];
    gs.handResult = [{ winners: [winner.id], amount: totalWinnings }];
    // Do NOT reveal hole cards
  } else {
    // Evaluate hands for each pot
    gs.handResult = [];
    for (const pot of gs.pots) {
      const eligibleNonFolded = pot.eligiblePlayerIds
        .map(id => gs.players.find(p => p.id === id))
        .filter(p => p && p.status !== 'folded');

      if (eligibleNonFolded.length === 0) continue;

      if (eligibleNonFolded.length === 1) {
        eligibleNonFolded[0].stack += pot.amount;
        gs.handResult.push({
          winners: [eligibleNonFolded[0].id],
          amount: pot.amount
        });
      } else {
        // Evaluate with pokersolver
        const hands = eligibleNonFolded.map(p => ({
          player: p,
          hand: gs.tournamentType === 'fivecard'
            ? Hand.solve(p.holeCards)
            : Hand.solve([...p.holeCards, ...gs.communityCards])
        }));
        const winnerHands = Hand.winners(hands.map(h => h.hand));
        const winners = hands.filter(h => winnerHands.includes(h.hand)).map(h => h.player);

        if (winners.length === 1) {
          winners[0].stack += pot.amount;
          gs.handResult.push({
            winners: [winners[0].id],
            amount: pot.amount
          });
        } else {
          // Split pot
          const share = Math.floor(pot.amount / winners.length);
          const remainder = pot.amount - (share * winners.length);
          // Sort by seatIndex — lowest gets remainder chip(s)
          winners.sort((a, b) => a.seatIndex - b.seatIndex);
          for (let i = 0; i < winners.length; i++) {
            winners[i].stack += share + (i === 0 ? remainder : 0);
          }
          gs.handResult.push({
            winners: winners.map(w => w.id),
            amount: pot.amount
          });
        }
      }
    }
    gs.pots = [];
  }

  // Transition to hand-complete
  gs.phase = 'hand-complete';

  // Eliminate players with stack === 0
  for (const player of gs.players) {
    if (player.stack === 0 && player.status !== 'eliminated') {
      player.status = 'eliminated';
      gs.eliminationOrder.push(player.id);
      if (player.id === 'human') {
        gs.humanStatus = 'spectating';
      }
    }
  }

  // Increment handsPlayedAtThisLevel
  gs.handsPlayedAtThisLevel += 1;

  // Check win condition
  const activePlayers = gs.players.filter(p => p.status !== 'eliminated');
  if (activePlayers.length === 1) {
    gs.phase = 'game-over';
    if (activePlayers[0].id === 'human') {
      gs.humanStatus = 'won';
    }
  }

  gs.actionSeat = null;
}

// ─── Street advancement ────────────────────────────────────────────────────────

function advanceStreet(gs) {
  // Collect bets into pots
  buildPots(gs.players, gs.pots);
  resetAllBets(gs);

  // Reset currentBet and minRaise
  gs.currentBet = 0;
  gs.minRaise = gs.bigBlind;
  gs.lastAggressorSeat = null;

  if (gs.tournamentType === 'fivecard') {
    // 5-Card Draw street progression
    switch (gs.phase) {
      case 'pre-flop':
        // Pre-draw betting complete -> enter draw phase
        gs.phase = 'draw';
        processDraw(gs);
        return; // processDraw handles everything (phase transition to post-draw or waits for human)
      case 'post-draw':
        // Post-draw betting complete -> showdown
        runShowdown(gs);
        return;
      default:
        return; // safety
    }
  }

  // Hold'em street progression (unchanged from V1)
  switch (gs.phase) {
    case 'pre-flop':
      gs.communityCards = [gs.deck.pop(), gs.deck.pop(), gs.deck.pop()];
      gs.phase = 'flop';
      break;
    case 'flop':
      gs.communityCards.push(gs.deck.pop());
      gs.phase = 'turn';
      break;
    case 'turn':
      gs.communityCards.push(gs.deck.pop());
      gs.phase = 'river';
      break;
    case 'river':
      runShowdown(gs);
      return; // showdown handles the rest
  }

  // Set action seat to first active player left of dealer (Hold'em only -- fivecard returned above)
  setPostFlopActionSeat(gs);

  // Reset hasActedThisRound for all active players
  resetActedFlags(gs);
}

// ─── AI decision logic ────────────────────────────────────────────────────────

function getTotalPotSize(gs) {
  const potSum = gs.pots.reduce((sum, p) => sum + p.amount, 0);
  const betSum = gs.players.reduce((sum, p) => sum + p.bet, 0);
  return potSum + betSum;
}

function computeAIAction(gs, player) {
  const thresholds = AI_THRESHOLDS[player.skillTier];
  const multiplier = RAISE_MULTIPLIERS[player.skillTier];

  // Compute hand strength
  let strength;
  if (gs.tournamentType === 'fivecard') {
    // 5-Card Draw: use drawHandStrength for both pre-draw and post-draw betting
    strength = drawHandStrength(player.holeCards);
  } else if (gs.phase === 'pre-flop') {
    strength = preFlopStrength(player.holeCards);
  } else {
    strength = postFlopStrength(player.holeCards, gs.communityCards);
  }

  const callAmount = gs.currentBet - player.bet;
  const totalPotSize = getTotalPotSize(gs);

  // Bluff injection — loose-aggressive only
  if (player.skillTier === 'loose-aggressive' && strength < thresholds.fold && callAmount > 0) {
    // Would normally fold. Check bluff conditions.
    const stackAfterCall = player.stack - callAmount;
    const twentyPercent = Math.floor(gs.config.startingStack * 0.20);
    if (stackAfterCall > 0 && stackAfterCall >= twentyPercent && Math.random() < 0.15) {
      // Check if the raise cost would also keep stack above 20%
      const raiseAmount = gs.currentBet + Math.max(gs.minRaise, Math.floor(totalPotSize * multiplier));
      const raiseChips = raiseAmount - player.bet;
      const stackAfterRaise = player.stack - raiseChips;
      if (stackAfterRaise >= twentyPercent) {
        strength = 0.80;
      }
    }
  }

  // Pot odds override
  if (callAmount > 0) {
    const potOdds = callAmount / (totalPotSize + callAmount);
    if (potOdds < 0.15 && strength >= 0.25) {
      // Cheap call — always call
      if (player.stack <= callAmount) {
        return { action: 'allin' };
      }
      return { action: 'call' };
    }
  }

  // Action selection
  if (callAmount === 0) {
    // Can check or raise
    if (strength >= thresholds.raise) {
      const raiseAmount = gs.currentBet + Math.max(gs.minRaise, Math.floor(totalPotSize * multiplier));
      const maxRaise = player.stack + player.bet;
      if (raiseAmount >= maxRaise) {
        return { action: 'allin' };
      }
      return { action: 'raise', amount: Math.min(raiseAmount, maxRaise) };
    } else {
      return { action: 'check' };
    }
  } else if (strength < thresholds.fold) {
    return { action: 'fold' };
  } else if (strength >= thresholds.raise) {
    const raiseAmount = gs.currentBet + Math.max(gs.minRaise, Math.floor(totalPotSize * multiplier));
    const maxRaise = player.stack + player.bet;
    if (raiseAmount >= maxRaise) {
      return { action: 'allin' };
    }
    // Check if we can afford the minimum raise
    if (player.stack + player.bet < gs.currentBet + gs.minRaise) {
      // Cannot meet min raise — must call or go all-in
      if (player.stack <= callAmount) {
        return { action: 'allin' };
      }
      return { action: 'call' };
    }
    return { action: 'raise', amount: Math.min(raiseAmount, maxRaise) };
  } else {
    // Call
    if (player.stack <= callAmount) {
      return { action: 'allin' };
    }
    return { action: 'call' };
  }
}

// ─── Draw phase processing ────────────────────────────────────────────────────

function processDraw(gs) {
  // If drawOrder is not initialized, build it now
  if (!gs.drawOrder || gs.drawOrder.length === 0) {
    // Build draw-eligible player list: active (non-folded, non-all-in, non-eliminated)
    // Order: starting left of dealer, clockwise
    const dealerSeat = gs.players.find(p => p.isDealer).seatIndex;
    const eligible = gs.players
      .filter(p => p.status === 'active')
      .sort((a, b) => a.seatIndex - b.seatIndex);

    // Reorder: players after dealer first, then players at/before dealer
    const afterDealer = eligible.filter(p => p.seatIndex > dealerSeat);
    const beforeOrAtDealer = eligible.filter(p => p.seatIndex <= dealerSeat);
    const ordered = [...afterDealer, ...beforeOrAtDealer];

    gs.drawOrder = ordered.map(p => p.seatIndex);
    gs.drawIndex = 0;
  }

  // Process from current drawIndex
  while (gs.drawIndex < gs.drawOrder.length) {
    const seatIdx = gs.drawOrder[gs.drawIndex];
    const currentPlayer = gs.players.find(p => p.seatIndex === seatIdx);

    if (!currentPlayer || currentPlayer.status === 'eliminated' ||
        currentPlayer.status === 'folded' || currentPlayer.status === 'all-in') {
      // Skip this player (status may have changed since drawOrder was built)
      gs.drawIndex++;
      continue;
    }

    // This player needs to draw
    if (currentPlayer.id === 'human') {
      if (gs.humanStatus === 'spectating') {
        // Auto-skip eliminated human: stand pat
        currentPlayer.discardCount = 0;
        gs.drawIndex++;
        continue;
      } else {
        // Human must submit POST /api/draw -- stop here and wait
        gs.drawSeat = currentPlayer.seatIndex;
        return; // wait for human input
      }
    }

    // AI player: compute and execute draw
    let discards = aiDrawDecision(currentPlayer.holeCards, currentPlayer.skillTier);

    // Hard cap: maximum 3 discards
    if (discards.length > 3) {
      discards = discards.slice(0, 3);
    }

    // Remove discarded cards, deal replacements
    currentPlayer.holeCards = currentPlayer.holeCards.filter(c => !discards.includes(c));
    for (let i = 0; i < discards.length; i++) {
      currentPlayer.holeCards.push(gs.deck.pop());
    }
    currentPlayer.discardCount = discards.length;

    // Defensive assertion: holeCards must be exactly 5 after draw
    if (currentPlayer.holeCards.length !== 5) {
      throw new Error('Draw error: player ' + currentPlayer.id + ' has ' + currentPlayer.holeCards.length + ' cards after draw');
    }

    gs.drawIndex++;
  }

  // All players have drawn -- advance to post-draw
  gs.drawSeat = null;
  gs.drawOrder = [];
  gs.drawIndex = 0;
  gs.phase = 'post-draw';
  gs.currentBet = 0;
  gs.minRaise = gs.bigBlind;
  gs.lastAggressorSeat = null;
  setPostFlopActionSeat(gs);
  resetActedFlags(gs);
}

// ─── Main AI processing loop ──────────────────────────────────────────────────

function processAIActions(gs) {
  while (true) {
    // Check 1: If hand-complete or game-over, stop
    if (gs.phase === 'hand-complete' || gs.phase === 'game-over') {
      scheduleAutoAdvance();
      break;
    }

    // Check 2 (MOVED UP from check 3): Only one non-folded player remains
    const nonFolded = gs.players.filter(p =>
      p.status !== 'folded' && p.status !== 'eliminated'
    );
    if (nonFolded.length === 1) {
      if (gs.tournamentType !== 'fivecard') {
        runOutCommunityCards(gs);
      }
      runShowdown(gs);
      scheduleAutoAdvance();
      break;
    }

    // Check 3 (MOVED UP from check 4): All remaining players are all-in
    const activeBettors = gs.players.filter(p => p.status === 'active');
    if (activeBettors.length <= 1 && nonFolded.length > 1) {
      buildPots(gs.players, gs.pots);
      resetAllBets(gs);
      if (gs.tournamentType !== 'fivecard') {
        runOutCommunityCards(gs);
      }
      runShowdown(gs);
      scheduleAutoAdvance();
      break;
    }

    // Check 4 (WAS check 2): Betting round complete -> advance street
    if (isBettingRoundComplete(gs)) {
      advanceStreet(gs);
      if (gs.phase === 'draw' && gs.drawSeat !== null) {
        const drawPlayer = gs.players.find(p => p.seatIndex === gs.drawSeat);
        if (drawPlayer && drawPlayer.id === 'human' && gs.humanStatus !== 'spectating') {
          break;
        }
      }
      continue;
    }

    // Find current action player
    const actionPlayer = gs.players.find(p => p.seatIndex === gs.actionSeat);
    if (!actionPlayer) break;

    if (actionPlayer.id === 'human') break;

    if (actionPlayer.id.startsWith('ai-')) {
      const aiAction = computeAIAction(gs, actionPlayer);
      processAction(gs, actionPlayer, aiAction.action, aiAction.amount);
      advanceActionSeat(gs);
      continue;
    }

    break;
  }
}

// ─── New hand setup ────────────────────────────────────────────────────────────

function setupNewHand(gs) {
  // Step 1: Advance dealer
  if (gs.handNumber === 1) {
    // First hand: dealer at seat 0
    setDealer(gs, 0);
  } else {
    advanceDealer(gs);
  }

  // Step 2: Assign blinds
  assignBlinds(gs);

  // Step 3: Check blind level advancement
  // (handsPlayedAtThisLevel was incremented at end of previous hand)
  if (gs.handsPlayedAtThisLevel >= gs.config.handsPerLevel) {
    advanceBlindLevel(gs);
  }

  // Step 4: Build and shuffle deck
  gs.deck = shuffle(buildDeck());

  // Step 5: Deal 2 hole cards to each active player
  dealHoleCards(gs);

  // Step 6: Post blinds
  postBlinds(gs);

  // Step 7-8: Set action seat and phase
  setInitialActionSeat(gs);
  gs.phase = 'pre-flop';
  gs.communityCards = [];
  gs.lastAggressorSeat = null;

  // Reset all players' hasActedThisRound
  resetActedFlags(gs);
  // BB has NOT acted (gets option) — leave hasActedThisRound = false

  // Initialize draw-phase tracking fields
  gs.drawSeat = null;
  gs.drawOrder = [];
  gs.drawIndex = 0;

  // Set discardCount for all active players
  for (const player of gs.players) {
    if (player.status !== 'eliminated') {
      if (gs.tournamentType === 'fivecard') {
        player.discardCount = 0;
      } else {
        player.discardCount = null;
      }
    }
  }
}

// ─── API Response Serialization ────────────────────────────────────────────────

function computeDisplayPots(gs) {
  // Start with a copy of internal pots
  const displayPots = gs.pots.map(p => ({
    amount: p.amount,
    eligiblePlayerIds: [...p.eligiblePlayerIds]
  }));

  // Collect current street bets into temporary pots
  const currentBets = gs.players
    .filter(p => p.bet > 0)
    .map(p => ({ id: p.id, amount: p.bet }));

  if (currentBets.length === 0) return displayPots;

  // Build temporary pots from current bets
  let bets = [...currentBets];
  const tempPots = [];
  while (bets.some(b => b.amount > 0)) {
    const minBet = Math.min(...bets.filter(b => b.amount > 0).map(b => b.amount));
    const contributors = bets.filter(b => b.amount > 0).map(b => b.id);
    tempPots.push({ amount: contributors.length * minBet, eligiblePlayerIds: contributors });
    bets = bets.map(b => ({ id: b.id, amount: Math.max(0, b.amount - minBet) }));
  }

  // Merge temp pots into display pots
  for (const tp of tempPots) {
    const match = displayPots.find(dp =>
      dp.eligiblePlayerIds.length === tp.eligiblePlayerIds.length &&
      tp.eligiblePlayerIds.every(id => dp.eligiblePlayerIds.includes(id))
    );
    if (match) {
      match.amount += tp.amount;
    } else {
      displayPots.push(tp);
    }
  }

  return displayPots;
}

function serializePlayer(player, phase) {
  const showHoleCards = (
    player.id === 'human' ||
    (
      (phase === 'showdown' || phase === 'hand-complete') &&
      player.status !== 'folded' &&
      player.holeCards !== null
    )
  );

  return {
    id: player.id,
    name: player.name,
    stack: player.stack,
    holeCards: showHoleCards ? player.holeCards : null,
    bet: player.bet,
    totalBetThisHand: player.totalBetThisHand,
    status: player.status,
    isDealer: player.isDealer,
    isSmallBlind: player.isSmallBlind,
    isBigBlind: player.isBigBlind,
    seatIndex: player.seatIndex,
    discardCount: player.discardCount !== undefined ? player.discardCount : null
  };
}

function computeStandings(gs) {
  const winner = gs.players.find(p => p.status !== 'eliminated');
  const standings = [{ id: winner.id, name: winner.name, position: 1 }];

  // eliminationOrder: first eliminated = last place
  // Iterate from end to beginning (last eliminated = position 2)
  for (let i = gs.eliminationOrder.length - 1; i >= 0; i--) {
    const playerId = gs.eliminationOrder[i];
    const player = gs.players.find(p => p.id === playerId);
    standings.push({
      id: player.id,
      name: player.name,
      position: standings.length + 1
    });
  }

  return standings;
}

function serializeGameState(gs) {
  const result = {
    gameId: gs.gameId,
    players: gs.players.map(p => serializePlayer(p, gs.phase)),
    phase: gs.phase,
    communityCards: gs.communityCards,
    pots: computeDisplayPots(gs),
    currentBet: gs.currentBet,
    minRaise: gs.minRaise,
    handNumber: gs.handNumber,
    blindLevel: gs.blindLevel,
    smallBlind: gs.smallBlind,
    bigBlind: gs.bigBlind,
    actionSeat: gs.actionSeat,
    humanStatus: gs.humanStatus,
    tournamentType: gs.tournamentType,
    handsPlayedAtThisLevel: gs.handsPlayedAtThisLevel,
    drawSeat: gs.drawSeat !== undefined ? gs.drawSeat : null,
    handResult: (gs.phase === 'hand-complete' || gs.phase === 'showdown')
      ? gs.handResult
      : []
  };

  if (gs.phase === 'game-over') {
    result.standings = computeStandings(gs);
  }

  return result;
}

// ─── Spectator mode auto-advance ──────────────────────────────────────────────

function scheduleAutoAdvance() {
  if (gameState && gameState.humanStatus === 'spectating' && gameState.phase === 'hand-complete') {
    setTimeout(() => {
      if (gameState && gameState.phase === 'hand-complete') {
        gameState.handNumber += 1;
        setupNewHand(gameState);
        processAIActions(gameState);
        // If still hand-complete and spectating, schedule again
        scheduleAutoAdvance();
      }
    }, 5000);
  }
}

// ─── 3-Card Poker: Standalone hand evaluator ─────────────────────────────────
//
// POKERSOLVER VERIFICATION RESULTS (run before implementation):
//
//   Hand.solve(["As","Ks","Qs"]).name  → "High Card"   (FAIL — expected: straight flush)
//   Hand.solve(["As","Ah","Kd"]).name  → "Pair"        (OK)
//   Hand.solve(["As","Kh","Qd"]).name  → "High Card"   (FAIL — expected: straight)
//   Hand.solve(["As","2h","3d"]).name  → "High Card"   (FAIL — expected: straight / ace-low)
//   Hand.solve(["As","Ks","Qs","Jh","Td","9c"]).name → "Straight"  (OK — 6-card works)
//   Royal Flush: hand.name = "Straight Flush", hand.descr = "Royal Flush", card.value = string "A"
//
// CONCLUSION: pokersolver FAILS 3-card evaluation for straights and flushes.
// Pairs and three-of-a-kind evaluate correctly for 3-card inputs.
// 6-card inputs work correctly for the Six Card Bonus bet.
//
// IMPLEMENTATION DECISION: The standalone 3-card evaluator (getThreeCardHandName +
// isThreeCardStraight) is used for ALL 3-card evaluation functions:
//   - dealerQualifies3C()
//   - anteBonus3C()
//   - pairPlusPayout3C()
//   - hasPairOrBetter3C()
//   - compareHands3C()
// The 6-card sixCardPayout3C() continues to use pokersolver (Hand.solve with 6 cards).
//
// ROYAL FLUSH DETECTION for sixCardPayout3C():
//   pokersolver returns hand.name = "Straight Flush" and hand.descr = "Royal Flush"
//   for a royal flush. Detection uses: hand.descr && hand.descr.toLowerCase() === 'royal flush'
//   OR name.includes('royal flush'). Never uses card.value === 'A' (though in this
//   version card.value IS a string "A", the instructions prohibit this approach).

function isThreeCardStraight(cards) {
  // Handles all 3-card straights: A-K-Q down to A-2-3 (ace-low)
  // rankOrder index: 0=A, 1=K, 2=Q, 3=J, 4=T, 5=9, 6=8, 7=7, 8=6, 9=5, 10=4, 11=3, 12=2
  const rankOrder = 'AKQJT98765432';
  const indices = cards.map(c => rankOrder.indexOf(c[0]));
  const sorted = [...indices].sort((a, b) => a - b);
  // Standard consecutive: e.g. [0,1,2] (A-K-Q) or [10,11,12] (4-3-2)
  if (sorted[2] - sorted[0] === 2 && sorted[1] - sorted[0] === 1) return true;
  // Ace-low straight: A-2-3 → indices [0, 11, 12]
  if (sorted[0] === 0 && sorted[1] === 11 && sorted[2] === 12) return true;
  return false;
}

function getThreeCardHandName(cards) {
  // Returns: 'straight flush' | 'three of a kind' | 'straight' | 'flush' | 'pair' | 'high card'
  const rankOrder = 'AKQJT98765432';
  const suits = cards.map(c => c[1]);
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = isThreeCardStraight(cards);
  const ranks = cards.map(c => rankOrder.indexOf(c[0]));
  const rankCounts = {};
  ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const isTrips = counts[0] === 3;
  const isPair = counts[0] === 2;

  if (isStraight && isFlush) return 'straight flush';
  if (isTrips) return 'three of a kind';
  if (isStraight) return 'straight';
  if (isFlush) return 'flush';
  if (isPair) return 'pair';
  return 'high card';
}

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

// ─── Routes ────────────────────────────────────────────────────────────────────

// POST /api/game — Start a new game
app.post('/api/game', (req, res) => {
  // Validation — exact order, exact error messages

  const { tournamentType } = req.body;

  // Step 1: tournamentType whitelist check
  if (!['holdem', 'fivecard', 'threecard', 'letitride'].includes(tournamentType)) {
    return res.status(400).json({ error: "tournamentType must be 'holdem', 'fivecard', 'threecard', or 'letitride'." });
  }

  // ─── 3-Card Poker branch ────────────────────────────────────────────────────
  if (tournamentType === 'threecard') {
    const { bankroll, minBet, maxBet } = req.body;

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

    gameState = {
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
    resetHand3C(gameState);

    return res.status(200).json(serializeState3C(gameState));
  }
  // ─── End 3-Card Poker branch ────────────────────────────────────────────────

  // ─── Let It Ride branch ─────────────────────────────────────────────────────
  if (tournamentType === 'letitride') {
    const { bankroll, minBet, maxBet } = req.body;

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

    gameState = {
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

    return res.status(200).json(serializeStateLIR(gameState));
  }
  // ─── End Let It Ride branch ─────────────────────────────────────────────────

  // Step 1b: 5-Card Draw player cap (only check when tournamentType is valid AND aiCount is an integer)
  if (req.body.tournamentType === 'fivecard' && Number.isInteger(req.body.aiCount) && req.body.aiCount > 5) {
    return res.status(400).json({ error: '5-Card Draw supports a maximum of 5 AI players (6 players total).' });
  }

  // 1. aiCount
  if (!Number.isInteger(req.body.aiCount)) {
    return res.status(400).json({ error: 'aiCount must be an integer between 1 and 11.' });
  }
  if (req.body.aiCount < 1 || req.body.aiCount > 11) {
    return res.status(400).json({ error: 'aiCount must be an integer between 1 and 11.' });
  }

  // 2. startingStack
  if (!Number.isInteger(req.body.startingStack)) {
    return res.status(400).json({ error: 'startingStack must be an integer between 100 and 1000000.' });
  }
  if (req.body.startingStack < 100 || req.body.startingStack > 1000000) {
    return res.status(400).json({ error: 'startingStack must be an integer between 100 and 1000000.' });
  }

  // 3. handsPerLevel
  if (!Number.isInteger(req.body.handsPerLevel)) {
    return res.status(400).json({ error: 'handsPerLevel must be an integer between 1 and 100.' });
  }
  if (req.body.handsPerLevel < 1 || req.body.handsPerLevel > 100) {
    return res.status(400).json({ error: 'handsPerLevel must be an integer between 1 and 100.' });
  }

  // 4. blindSchedule must be an array
  if (!Array.isArray(req.body.blindSchedule)) {
    return res.status(400).json({ error: 'blindSchedule must be an array with at least 2 levels.' });
  }
  if (req.body.blindSchedule.length < 2) {
    return res.status(400).json({ error: 'blindSchedule must be an array with at least 2 levels.' });
  }

  // 5. Each element: small and big must be positive integers, big === small * 2
  for (const level of req.body.blindSchedule) {
    if (!Number.isInteger(level.small) || !Number.isInteger(level.big)) {
      return res.status(400).json({ error: 'Each blind level must have big blind equal to 2x small blind.' });
    }
    if (level.small < 1) {
      return res.status(400).json({ error: 'Each blind level must have big blind equal to 2x small blind.' });
    }
    if (level.big !== level.small * 2) {
      return res.status(400).json({ error: 'Each blind level must have big blind equal to 2x small blind.' });
    }
  }

  // Initialize game state
  const aiCount = req.body.aiCount;
  const startingStack = req.body.startingStack;
  const blindSchedule = req.body.blindSchedule;
  const skillTiers = ['loose-passive', 'tight-aggressive', 'loose-aggressive'];

  const players = [];

  // Human player
  players.push({
    id: 'human',
    name: 'You',
    stack: startingStack,
    holeCards: null,
    bet: 0,
    totalBetThisHand: 0,
    status: 'active',
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    skillTier: null,
    seatIndex: 0,
    hasActedThisRound: false,
    discardCount: req.body.tournamentType === 'fivecard' ? 0 : null
  });

  // AI players
  for (let i = 1; i <= aiCount; i++) {
    players.push({
      id: `ai-${i}`,
      name: AI_NAMES[i - 1],
      stack: startingStack,
      holeCards: null,
      bet: 0,
      totalBetThisHand: 0,
      status: 'active',
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
      skillTier: skillTiers[Math.floor(Math.random() * 3)],
      seatIndex: i,
      hasActedThisRound: false,
      discardCount: req.body.tournamentType === 'fivecard' ? 0 : null
    });
  }

  gameState = {
    gameId: crypto.randomUUID(),
    tournamentType: req.body.tournamentType,
    phase: 'pre-flop',
    players: players,
    communityCards: [],
    pots: [],
    currentBet: 0,
    minRaise: 0,
    handNumber: 1,
    blindLevel: 0,
    handsPlayedAtThisLevel: 0,
    smallBlind: blindSchedule[0].small,
    bigBlind: blindSchedule[0].big,
    actionSeat: null,
    lastAggressorSeat: null,
    drawSeat: null,
    drawOrder: [],
    drawIndex: 0,
    deck: [],
    humanStatus: 'playing',
    config: {
      tournamentType: req.body.tournamentType,
      aiCount: aiCount,
      startingStack: startingStack,
      handsPerLevel: req.body.handsPerLevel,
      blindSchedule: blindSchedule
    },
    eliminationOrder: [],
    lastDealerSeatIndex: -1,
    handResult: []
  };

  setupNewHand(gameState);
  processAIActions(gameState);

  return res.status(200).json(serializeGameState(gameState));
});

// GET /api/game — Get current game state
app.get('/api/game', (req, res) => {
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }
  // 3-Card Poker uses its own serializer
  if (gameState.tournamentType === 'threecard') {
    return res.status(200).json(serializeState3C(gameState));
  }
  // Let It Ride uses its own serializer
  if (gameState.tournamentType === 'letitride') {
    return res.status(200).json(serializeStateLIR(gameState));
  }
  return res.status(200).json(serializeGameState(gameState));
});

// POST /api/action — Human player takes an action
app.post('/api/action', (req, res) => {
  // Validation — exact order, exact error messages

  // Rule 1
  if (!req.body.gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Rule 2
  if (!gameState || req.body.gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Rule 3 — effectively unreachable given rule 2, but implement for completeness
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }

  // Guard (CISO-V4-04): positive whitelist — only tournament games may use this endpoint
  if (!['holdem', 'fivecard'].includes(gameState.tournamentType)) {
    return res.status(400).json({ error: 'This endpoint is only valid for tournament games.' });
  }

  // Rule 4
  const activePhases = ['pre-flop', 'flop', 'turn', 'river', 'post-draw'];
  if (!activePhases.includes(gameState.phase)) {
    return res.status(400).json({ error: 'No action required at this time.' });
  }

  // Rule 5
  const humanPlayer = gameState.players.find(p => p.id === 'human');
  if (gameState.actionSeat !== humanPlayer.seatIndex) {
    return res.status(400).json({ error: 'It is not your turn.' });
  }

  // Rule 6
  const validActions = ['fold', 'check', 'call', 'raise', 'allin'];
  if (!validActions.includes(req.body.action)) {
    return res.status(400).json({ error: 'Invalid action.' });
  }

  // Rule 7 — em dash is U+2014
  if (req.body.action === 'check' && gameState.currentBet > humanPlayer.bet) {
    return res.status(400).json({ error: 'Cannot check \u2014 there is a bet to call.' });
  }

  // Rule 8
  if (req.body.action === 'raise' && (!Number.isInteger(req.body.amount) || req.body.amount <= 0)) {
    return res.status(400).json({ error: 'Raise amount must be a positive integer.' });
  }

  // Rule 9
  if (req.body.action === 'raise' && req.body.amount < gameState.currentBet + gameState.minRaise) {
    return res.status(400).json({ error: 'Raise amount is below the minimum raise.' });
  }

  // Rule 10
  if (req.body.action === 'raise' && req.body.amount > humanPlayer.stack + humanPlayer.bet) {
    return res.status(400).json({ error: 'Raise amount exceeds your stack.' });
  }

  processAction(gameState, humanPlayer, req.body.action, req.body.amount);
  advanceActionSeat(gameState);
  processAIActions(gameState);

  return res.status(200).json(serializeGameState(gameState));
});

// POST /api/draw -- Human player draw action (5-Card Draw only)
app.post('/api/draw', (req, res) => {
  // Validation -- exact order, exact error messages
  // ALL validation must complete before ANY game state mutation

  // Step 1: gameId required
  if (!req.body.gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2: gameId must match
  if (!gameState || req.body.gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 3: game must exist (effectively unreachable given step 2, but implement for completeness)
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }

  // Guard (CISO-V4-04): positive whitelist — only tournament games may use this endpoint
  if (!['holdem', 'fivecard'].includes(gameState.tournamentType)) {
    return res.status(400).json({ error: 'This endpoint is only valid for tournament games.' });
  }

  // Step 4: tournament type must be fivecard
  if (gameState.tournamentType !== 'fivecard') {
    return res.status(400).json({ error: 'Draw action is only valid in 5-Card Draw games.' });
  }

  // Step 5: phase must be draw
  if (gameState.phase !== 'draw') {
    return res.status(400).json({ error: 'It is not the draw phase.' });
  }

  // Step 6: must be human's draw turn
  const humanPlayer = gameState.players.find(p => p.id === 'human');
  if (gameState.drawSeat !== humanPlayer.seatIndex) {
    return res.status(400).json({ error: 'It is not your turn to draw.' });
  }

  // Step 7: discards must be an array
  if (!Array.isArray(req.body.discards)) {
    return res.status(400).json({ error: 'discards must be an array of 0 to 3 card strings.' });
  }

  // Step 7b: each element must be a string (type safety before card-in-hand check)
  for (const element of req.body.discards) {
    if (typeof element !== 'string') {
      return res.status(400).json({ error: 'discards must be an array of 0 to 3 card strings.' });
    }
  }

  // Step 8: max 3 discards
  if (req.body.discards.length > 3) {
    return res.status(400).json({ error: 'You may discard at most 3 cards.' });
  }

  // Step 9: each card must be in human's hand
  for (const card of req.body.discards) {
    if (!humanPlayer.holeCards.includes(card)) {
      return res.status(400).json({ error: 'Invalid discard \u2014 card not in your hand.' });
    }
  }

  // Step 10: no duplicates -- MUST use Set-based check
  if (new Set(req.body.discards).size !== req.body.discards.length) {
    return res.status(400).json({ error: 'Invalid discard \u2014 duplicate card.' });
  }

  // ==== ALL VALIDATION PASSED ==== Now mutate game state ====

  const discards = req.body.discards;

  // Process human's draw: remove discarded cards, deal replacements
  humanPlayer.holeCards = humanPlayer.holeCards.filter(c => !discards.includes(c));
  for (let i = 0; i < discards.length; i++) {
    humanPlayer.holeCards.push(gameState.deck.pop());
  }
  humanPlayer.discardCount = discards.length;

  // Defensive assertion: human must have exactly 5 cards after draw
  if (humanPlayer.holeCards.length !== 5) {
    // This should never happen given the 6-player cap, but guard defensively
    return res.status(500).json({ error: 'Internal error during draw processing.' });
  }

  // Advance past human in draw order
  gameState.drawIndex++;

  // Continue processing remaining AI draws (processDraw picks up from drawIndex)
  processDraw(gameState);

  // If draw phase completed, processDraw set phase to 'post-draw'
  // Now run AI betting actions for the post-draw round
  if (gameState.phase !== 'draw') {
    processAIActions(gameState);
  }

  return res.status(200).json(serializeGameState(gameState));
});

// POST /api/next-hand — Advance from hand-complete to next hand
app.post('/api/next-hand', (req, res) => {
  // Validation — exact order, exact error messages

  // Rule 1
  if (!req.body.gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Rule 2
  if (!gameState || req.body.gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Rule 4 — unreachable given rule 2, but implement for completeness
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }

  // Guard (CISO-V4-04): positive whitelist — only tournament games may use this endpoint
  if (!['holdem', 'fivecard'].includes(gameState.tournamentType)) {
    return res.status(400).json({ error: 'This endpoint is only valid for tournament games.' });
  }

  // Rule 3
  if (gameState.phase !== 'hand-complete') {
    return res.status(400).json({ error: 'Hand is not complete yet.' });
  }

  gameState.handNumber += 1;
  setupNewHand(gameState);
  processAIActions(gameState);

  return res.status(200).json(serializeGameState(gameState));
});

// ─── 3-Card Poker Routes ───────────────────────────────────────────────────────

// POST /api/3c-bet — Human places bets
app.post('/api/3c-bet', (req, res) => {
  const { gameId } = req.body;
  const anteBet = req.body.anteBet;
  const pairPlusBet = (req.body.pairPlusBet !== undefined) ? req.body.pairPlusBet : 0;
  const sixCardBet = (req.body.sixCardBet !== undefined) ? req.body.sixCardBet : 0;

  // Step 1: gameId missing
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2: gameId mismatch (also handles null gameState)
  if (!gameState || gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 3: (unreachable) no game in progress
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }

  // Step 4: tournament type check
  if (gameState.tournamentType !== 'threecard') {
    return res.status(400).json({ error: 'This endpoint is only valid for 3-Card Poker games.' });
  }

  // Step 5: phase check
  if (gameState.phase !== 'betting') {
    return res.status(400).json({ error: 'Bets cannot be placed at this time.' });
  }

  // Step 5b: humanStatus check (CISO-V3-12)
  if (gameState.humanStatus !== 'playing') {
    return res.status(400).json({ error: 'Session is over.' });
  }

  // Step 6: anteBet must be a positive integer
  if (!Number.isInteger(anteBet) || anteBet <= 0) {
    return res.status(400).json({ error: 'anteBet must be a positive integer.' });
  }

  const minBet = gameState.config.minBet;
  const maxBet = gameState.config.maxBet;
  const humanPlayer = gameState.players.find(p => p.id === 'human');

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
  const aiPlayers = gameState.players.filter(p => p.id !== 'human');
  for (const ai of aiPlayers) {
    if (ai.status !== 'bust') {
      ai.cards = [deck.pop(), deck.pop(), deck.pop()];
    }
  }

  // Deal dealer cards (stored server-side, serializeState3C hides them until resolution)
  gameState.dealer.cards = [deck.pop(), deck.pop(), deck.pop()];

  // Mutation 4: Compute AI bets (sequential bankroll cap) and deduct
  for (const ai of aiPlayers) {
    if (ai.status === 'bust' || ai.bankroll <= 0) continue;
    const bets = computeAIBets3C(ai, gameState.config);
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
  gameState.phase = 'dealing';

  return res.status(200).json(serializeState3C(gameState));
});

// POST /api/3c-play — Human decides to play or fold
app.post('/api/3c-play', (req, res) => {
  const { gameId, decision } = req.body;

  // Step 1: gameId missing
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2: gameId mismatch
  if (!gameState || gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 3: (unreachable) no game in progress
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }

  // Step 4: tournament type check
  if (gameState.tournamentType !== 'threecard') {
    return res.status(400).json({ error: 'This endpoint is only valid for 3-Card Poker games.' });
  }

  // Step 5: phase check
  if (gameState.phase !== 'dealing') {
    return res.status(400).json({ error: 'No play decision required at this time.' });
  }

  // Step 6: decision must be 'play' or 'fold' (strict equality, no normalization)
  if (decision !== 'play' && decision !== 'fold') {
    return res.status(400).json({ error: "Decision must be 'play' or 'fold'." });
  }

  // ==== ALL VALIDATION PASSED — BEGIN MUTATION ====

  const humanPlayer = gameState.players.find(p => p.id === 'human');

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
    gameState.dealer.qualifies = dealerQualifies3C(gameState.dealer.cards);

    // Step 2: Process EVERY player (including folded ones — ADV-9)
    for (const player of gameState.players) {
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
        if (!gameState.dealer.qualifies) {
          handResult.anteResult = 'win';
          handResult.playResult = 'push';
        } else {
          const comparison = compareHands3C(player.cards, gameState.dealer.cards);
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
      const rawSC = sixCardPayout3C(player.cards, gameState.dealer.cards, player.sixCardBet);
      handResult.sixCardPayout = rawSC; // 0 on loss (never negative)
      handResult.sixCardResult = rawSC > 0 ? 'win' : (player.sixCardBet > 0 ? 'loss' : null);

      // e. Compute net change
      handResult.netChange = computeNetChange3C(player, handResult);

      // f. Store handResult and apply net change to bankroll
      player.handResult = handResult;
      player.bankroll += handResult.netChange;
    }

    // Step 3: Mark any player with bankroll <= 0 as bust
    for (const player of gameState.players) {
      if (player.bankroll <= 0 && player.status !== 'bust') {
        player.status = 'bust';
      }
    }

    // Step 4: Set phase to hand-complete
    gameState.phase = 'hand-complete';

    // Step 5: Check if human is bust or game-over
    if (humanPlayer.bankroll <= 0) {
      gameState.humanStatus = 'bust';
      gameState.phase = 'game-over';
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'An internal error occurred.' });
  }

  return res.status(200).json(serializeState3C(gameState));
});

// POST /api/3c-next-hand — Advance to next hand
app.post('/api/3c-next-hand', (req, res) => {
  const { gameId } = req.body;

  // Step 1: gameId missing
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2: gameId mismatch
  if (!gameState || gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 3: (unreachable) no game in progress
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }

  // Step 4: tournament type check
  if (gameState.tournamentType !== 'threecard') {
    return res.status(400).json({ error: 'This endpoint is only valid for 3-Card Poker games.' });
  }

  // Step 5: session is over — check before phase check so cashedout/bust returns correct message
  // (after cashout, phase is 'game-over', not 'hand-complete', so this must fire first)
  if (gameState.humanStatus === 'bust' || gameState.humanStatus === 'cashedout') {
    return res.status(400).json({ error: 'Session is over.' });
  }

  // Step 6: phase check
  if (gameState.phase !== 'hand-complete') {
    return res.status(400).json({ error: 'Hand is not complete yet.' });
  }

  // Increment handNumber first, then reset hand
  gameState.handNumber += 1;
  resetHand3C(gameState); // sets per-hand fields to defaults, phase to 'betting'

  return res.status(200).json(serializeState3C(gameState));
});

// POST /api/3c-cashout — Human cashes out
app.post('/api/3c-cashout', (req, res) => {
  const { gameId } = req.body;

  // Step 1: gameId missing
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2: gameId mismatch
  if (!gameState || gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 3: (unreachable) no game in progress
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }

  // Step 4: tournament type check
  if (gameState.tournamentType !== 'threecard') {
    return res.status(400).json({ error: 'This endpoint is only valid for 3-Card Poker games.' });
  }

  // Step 5: can only cash out between hands (betting or hand-complete)
  if (gameState.phase !== 'betting' && gameState.phase !== 'hand-complete') {
    return res.status(400).json({ error: 'You can only cash out between hands.' });
  }

  // CISO-V3-07: exactly two mutations, nothing else
  gameState.humanStatus = 'cashedout';
  gameState.phase = 'game-over';

  return res.status(200).json(serializeState3C(gameState));
});

// ─── Let It Ride Routes ────────────────────────────────────────────────────────

// POST /api/lir-bet — Human places bets
app.post('/api/lir-bet', (req, res) => {
  const { gameId, baseBet, bonusBet } = req.body;

  // Step 1: gameId missing
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2/3: check no-game first (step 3), then gameId mismatch (step 2)
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }
  if (gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 4: tournament type check
  if (gameState.tournamentType !== 'letitride') {
    return res.status(400).json({ error: 'This endpoint is only valid for Let It Ride games.' });
  }

  // Step 5: phase check
  if (gameState.phase !== 'betting') {
    return res.status(400).json({ error: 'Bets cannot be placed at this time.' });
  }

  // Step 6: baseBet must be a positive integer (CISO-V4-05: Number.isInteger, no parseInt)
  if (!Number.isInteger(baseBet) || baseBet < 1) {
    return res.status(400).json({ error: 'baseBet must be a positive integer.' });
  }

  // Step 7: baseBet below minimum
  if (baseBet < gameState.config.minBet) {
    return res.status(400).json({ error: 'Base bet is below the table minimum.' });
  }

  // Step 8: baseBet above maximum
  if (baseBet > gameState.config.maxBet) {
    return res.status(400).json({ error: 'Base bet exceeds the table maximum.' });
  }

  // Step 8b: bonusBet strict boolean validation (CISO-V4-03)
  if (bonusBet !== undefined && bonusBet !== true && bonusBet !== false) {
    return res.status(400).json({ error: 'bonusBet must be true or false.' });
  }

  // Step 9: total cost vs bankroll
  const humanPlayer = gameState.players.find(p => p.id === 'human');
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
  for (const ai of gameState.players.filter(p => p.id !== 'human' && p.status !== 'bust')) {
    const aiBets = computeAIBetsLIR(ai, gameState.config);
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
  for (const player of gameState.players) {
    if (player.bet3 > 0) {
      player.cards = [deck[deckIdx++], deck[deckIdx++], deck[deckIdx++]];
    }
  }

  // Mutation 5: Deal 2 community cards (face-down, stored server-side)
  gameState.community.card1 = deck[deckIdx++];
  gameState.community.card2 = deck[deckIdx++];

  // Mutation 6: Advance to first-decision
  gameState.phase = 'first-decision';

  // Mutation 7: Compute AI Bet 1 decisions immediately
  for (const ai of gameState.players.filter(p => p.id !== 'human' && p.bet3 > 0)) {
    const decision = lirBet1Decision(ai.cards, ai.skillTier);
    if (decision === 'withdraw') {
      ai.bet1Withdrawn = true;
      ai.bet1 = 0;
      ai.bankroll += ai.bet3; // return baseBet (use bet3 as the immutable base)
    }
  }

  return res.status(200).json(serializeStateLIR(gameState));
});

// POST /api/lir-decision — Human decides to withdraw or ride
app.post('/api/lir-decision', (req, res) => {
  const { gameId, betNumber, decision } = req.body;

  // Step 1: gameId missing
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2/3: check no-game first, then gameId mismatch
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }
  if (gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 4: tournament type check
  if (gameState.tournamentType !== 'letitride') {
    return res.status(400).json({ error: 'This endpoint is only valid for Let It Ride games.' });
  }

  // Step 5: phase must be first-decision or second-decision
  if (gameState.phase !== 'first-decision' && gameState.phase !== 'second-decision') {
    return res.status(400).json({ error: 'No decision required at this time.' });
  }

  // Step 6: betNumber === 1 but phase is second-decision
  if (betNumber === 1 && gameState.phase === 'second-decision') {
    return res.status(400).json({ error: 'Bet 1 decision has already been made.' });
  }

  // Step 7: betNumber === 2 but phase is first-decision
  if (betNumber === 2 && gameState.phase === 'first-decision') {
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

  const humanPlayer = gameState.players.find(p => p.id === 'human');

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

  if (gameState.phase === 'first-decision') {
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
      gameState.phase = 'second-decision';

      // Compute AI Bet 2 decisions immediately
      for (const ai of gameState.players.filter(p => p.id !== 'human' && p.bet3 > 0)) {
        const aiDecision = lirBet2Decision(ai.cards, gameState.community.card1, ai.skillTier);
        if (aiDecision === 'withdraw') {
          ai.bet2Withdrawn = true;
          ai.bet2 = 0;
          ai.bankroll += ai.bet3; // return baseBet
        }
      }

      return res.status(200).json(serializeStateLIR(gameState));
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
      for (const player of gameState.players) {
        if (player.bet3 === 0 || player.status === 'bust') continue;

        // Main hand evaluation (5 cards)
        const mainResult = computeLIRMain(player.cards, [gameState.community.card1, gameState.community.card2]);

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
      for (const player of gameState.players) {
        if (player.bankroll <= 0 && player.status !== 'bust') {
          player.status = 'bust';
        }
      }

      // Set phase to hand-complete
      gameState.phase = 'hand-complete';

      // Check human bust — transitions to game-over
      const humanAfter = gameState.players.find(p => p.id === 'human');
      if (humanAfter.bankroll <= 0) {
        gameState.humanStatus = 'bust';
        gameState.phase = 'game-over';
      }

      return res.status(200).json(serializeStateLIR(gameState));
    } catch (err) {
      console.error('lir-decision bet2 error:', err);
      return res.status(500).json({ error: 'An internal error occurred.' });
    }
  }
});

// POST /api/lir-next-hand — Advance to next hand
app.post('/api/lir-next-hand', (req, res) => {
  const { gameId } = req.body;

  // Step 1: gameId missing
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2/3: check no-game first, then gameId mismatch
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }
  if (gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 4: tournament type check
  if (gameState.tournamentType !== 'letitride') {
    return res.status(400).json({ error: 'This endpoint is only valid for Let It Ride games.' });
  }

  // Step 5: humanStatus bust or cashedout (checked before phase to ensure correct error message)
  if (gameState.humanStatus === 'bust' || gameState.humanStatus === 'cashedout') {
    return res.status(400).json({ error: 'Session is over.' });
  }

  // Step 6: phase must be hand-complete
  if (gameState.phase !== 'hand-complete') {
    return res.status(400).json({ error: 'Hand is not complete yet.' });
  }

  // Mutation
  gameState.handNumber += 1;
  resetHandLIR(gameState); // sets per-hand fields and phase to 'betting'

  return res.status(200).json(serializeStateLIR(gameState));
});

// POST /api/lir-cashout — Human cashes out
app.post('/api/lir-cashout', (req, res) => {
  const { gameId } = req.body;

  // Step 1: gameId missing
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required.' });
  }

  // Step 2/3: check no-game first, then gameId mismatch
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }
  if (gameId !== gameState.gameId) {
    return res.status(400).json({ error: 'Invalid gameId.' });
  }

  // Step 4: tournament type check
  if (gameState.tournamentType !== 'letitride') {
    return res.status(400).json({ error: 'This endpoint is only valid for Let It Ride games.' });
  }

  // Step 5: can only cash out between hands (betting or hand-complete)
  if (gameState.phase !== 'betting' && gameState.phase !== 'hand-complete') {
    return res.status(400).json({ error: 'You can only cash out between hands.' });
  }

  // Step 6: Defense-in-depth: reject cashout if already bust or cashed out (CISO-V4-POST-03)
  if (gameState.humanStatus === 'bust' || gameState.humanStatus === 'cashedout') {
    return res.status(400).json({ error: 'Session is over.' });
  }

  // Mutation
  gameState.humanStatus = 'cashedout';
  gameState.phase = 'game-over';

  return res.status(200).json(serializeStateLIR(gameState));
});

// GET /api/health — Health check
app.get('/api/health', (req, res) => {
  return res.status(200).json({ status: 'ok' });
});

// ─── Global error handler (CISO-V3-06) ────────────────────────────────────────
// Suppresses stack traces from reaching HTTP responses
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'An internal error occurred.' });
});

// ─── Port selection and startup ────────────────────────────────────────────────

async function findPort() {
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
  if (envPort) return envPort;

  const net = require('net');
  for (let port = 3001; port <= 3999; port++) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => { server.close(); resolve(true); });
      server.listen(port);
    });
    if (available) return port;
  }
  throw new Error('No available port found between 3001 and 3999');
}

findPort().then((port) => {
  app.listen(port, () => {
    console.log(`Poker server listening on port ${port}`);
  });
});
