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
    player.holeCards = [gs.deck.pop(), gs.deck.pop()];
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
    if (player.status === 'active') {
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
          hand: Hand.solve([...p.holeCards, ...gs.communityCards])
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

  // Deal community cards and advance phase
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

  // Set action seat to first active player left of dealer
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
  if (gs.phase === 'pre-flop') {
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

// ─── Main AI processing loop ──────────────────────────────────────────────────

function processAIActions(gs) {
  while (true) {
    // Check if we should stop
    if (gs.phase === 'hand-complete' || gs.phase === 'game-over') {
      // Schedule auto-advance for spectating games
      scheduleAutoAdvance();
      break;
    }

    // Check if betting round is complete
    if (isBettingRoundComplete(gs)) {
      advanceStreet(gs);
      continue; // re-check: new street may need AI actions or may skip betting
    }

    // Check if only one non-folded player remains
    const nonFolded = gs.players.filter(p =>
      p.status !== 'folded' && p.status !== 'eliminated'
    );
    if (nonFolded.length === 1) {
      // Run out remaining community cards, then showdown
      runOutCommunityCards(gs);
      runShowdown(gs);
      scheduleAutoAdvance();
      break;
    }

    // Check if all remaining players are all-in (no one can act)
    const activeBettors = gs.players.filter(p => p.status === 'active');
    if (activeBettors.length <= 1 && nonFolded.length > 1) {
      // At most one player can still bet. Skip remaining betting.
      // Collect bets, run out cards, showdown
      buildPots(gs.players, gs.pots);
      resetAllBets(gs);
      runOutCommunityCards(gs);
      runShowdown(gs);
      scheduleAutoAdvance();
      break;
    }

    // Find current action player
    const actionPlayer = gs.players.find(p => p.seatIndex === gs.actionSeat);

    if (!actionPlayer) break; // safety

    // If it is the human's turn, stop (return to client)
    if (actionPlayer.id === 'human') break;

    // If it is an AI's turn, compute and execute action
    if (actionPlayer.id.startsWith('ai-')) {
      const aiAction = computeAIAction(gs, actionPlayer);
      processAction(gs, actionPlayer, aiAction.action, aiAction.amount);
      advanceActionSeat(gs);
      continue;
    }

    // Safety: should not reach here
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
    seatIndex: player.seatIndex
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

// ─── Routes ────────────────────────────────────────────────────────────────────

// POST /api/game — Start a new game
app.post('/api/game', (req, res) => {
  // Validation — exact order, exact error messages

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
    hasActedThisRound: false
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
      hasActedThisRound: false
    });
  }

  gameState = {
    gameId: crypto.randomUUID(),
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
    deck: [],
    humanStatus: 'playing',
    config: {
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

  // Rule 4
  const activePhases = ['pre-flop', 'flop', 'turn', 'river'];
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

  // Rule 3
  if (gameState.phase !== 'hand-complete') {
    return res.status(400).json({ error: 'Hand is not complete yet.' });
  }

  // Rule 4 — unreachable given rule 2, but implement for completeness
  if (!gameState) {
    return res.status(404).json({ error: 'No game in progress.' });
  }

  gameState.handNumber += 1;
  setupNewHand(gameState);
  processAIActions(gameState);

  return res.status(200).json(serializeGameState(gameState));
});

// GET /api/health — Health check
app.get('/api/health', (req, res) => {
  return res.status(200).json({ status: 'ok' });
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
