'use strict';

// ============================================================
// mississippi.js — Client-side logic for Mississippi Stud
// All DOM updates use textContent only. No innerHTML/outerHTML/
// insertAdjacentHTML/document.write/eval anywhere in this file.
// ============================================================

// ------------------------------------------------------------
// Card display helpers
// ------------------------------------------------------------

const SUIT_SYMBOLS = { s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663' };

function formatCard(cardStr) {
  var rank = cardStr[0] === 'T' ? '10' : cardStr[0];
  return rank + (SUIT_SYMBOLS[cardStr[1]] || cardStr[1]);
}

function suitColor(cardStr) {
  return (cardStr[1] === 'h' || cardStr[1] === 'd') ? 'red' : 'black';
}

function displayCard(el, cardStr) {
  el.textContent = formatCard(cardStr);
  el.style.color = suitColor(cardStr);
  el.classList.remove('ms-card-placeholder');
}

function resetCardSlot(el) {
  el.textContent = '?';
  el.style.color = '';
  el.classList.add('ms-card-placeholder');
}

function addCardToContainer(container, cardStr) {
  var el = document.createElement('span');
  el.className = 'ms-card';
  el.textContent = formatCard(cardStr);
  el.style.color = suitColor(cardStr);
  container.appendChild(el);
}

// ------------------------------------------------------------
// Shorthand DOM selector
// ------------------------------------------------------------

function qs(testid) {
  return document.querySelector('[data-testid="' + testid + '"]');
}

// ------------------------------------------------------------
// Client-side state
// ------------------------------------------------------------

var sessionActive = false;
var currentPhase = 'idle';
var bankroll = 0;
var handNumber = 0;
var currentAnte = 0;
var aiPlayers = [];

// ------------------------------------------------------------
// Button state management
// ------------------------------------------------------------

function updateButtonStates() {
  var isStreet = ['third_street', 'fourth_street', 'fifth_street'].includes(currentPhase);
  qs('btn-new-session').disabled = sessionActive;
  qs('btn-deal').disabled = !(currentPhase === 'idle' && sessionActive);
  qs('btn-raise-1x').disabled = !(isStreet && bankroll >= currentAnte);
  qs('btn-raise-3x').disabled = !(isStreet && bankroll >= currentAnte * 3);
  qs('btn-fold').disabled = !isStreet;
  qs('btn-cash-out').disabled = !(currentPhase === 'idle' && sessionActive);
}

// ------------------------------------------------------------
// Display helpers
// ------------------------------------------------------------

var PHASE_LABELS = {
  idle: 'Idle',
  ante: 'Ante',
  third_street: '3rd Street',
  fourth_street: '4th Street',
  fifth_street: '5th Street',
  showdown: 'Showdown'
};

function updateDisplays() {
  qs('display-bankroll').textContent = '$' + bankroll;
  qs('display-phase').textContent = PHASE_LABELS[currentPhase] || currentPhase;
  if (!sessionActive && bankroll <= 0 && handNumber > 0) {
    qs('display-session-status').textContent = 'Busted';
  } else {
    qs('display-session-status').textContent = sessionActive ? 'Active' : 'Inactive';
  }
}

function updateBetDisplays(bets) {
  qs('display-bet-ante').textContent = '$' + bets.ante;
  qs('display-bet-third').textContent = '$' + bets.thirdStreet;
  qs('display-bet-fourth').textContent = '$' + bets.fourthStreet;
  qs('display-bet-fifth').textContent = '$' + bets.fifthStreet;
  qs('display-bet-bonus').textContent = bets.bonus ? '$' + bets.bonus : '$0';
}

function clearBetDisplays() {
  qs('display-bet-ante').textContent = '$0';
  qs('display-bet-third').textContent = '$0';
  qs('display-bet-fourth').textContent = '$0';
  qs('display-bet-fifth').textContent = '$0';
  qs('display-bet-bonus').textContent = '$0';
}

// ------------------------------------------------------------
// Error helpers
// ------------------------------------------------------------

function clearError() {
  qs('display-error').textContent = '';
}

function showError(msg) {
  qs('display-error').textContent = msg;
}

// ------------------------------------------------------------
// Result display helpers
// ------------------------------------------------------------

function clearResults() {
  qs('display-hand-name').textContent = '';
  qs('display-result').textContent = '';
  qs('display-result').className = 'ms-result';
  qs('display-bonus-result').textContent = '';
}

function displayResultNet(el, net) {
  if (net > 0) {
    el.textContent = 'Win +$' + net;
    el.className = 'ms-result ms-result-win';
  } else if (net === 0) {
    el.textContent = 'Push $0';
    el.className = 'ms-result ms-result-push';
  } else {
    el.textContent = 'Loss -$' + Math.abs(net);
    el.className = 'ms-result ms-result-loss';
  }
}

function displayBonusResult(bonusResult) {
  if (!bonusResult || !bonusResult.placed) {
    qs('display-bonus-result').textContent = '';
    return;
  }
  var net = bonusResult.net;
  var sign = net >= 0 ? '+$' : '-$';
  qs('display-bonus-result').textContent =
    'Bonus: ' + bonusResult.handName + ' ' + sign + Math.abs(net);
}

// ------------------------------------------------------------
// AI seat helpers
// ------------------------------------------------------------

function setAiNames(players) {
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    qs('ai-name-' + p.seat).textContent = p.name;
  }
}

function resetAiActions() {
  for (var n = 1; n <= 5; n++) {
    qs('ai-action-' + n).textContent = '\u2014';
    clearAiCards(n);
    var seat = qs('ai-seat-' + n);
    seat.classList.remove('folded');
  }
}

function clearAiCards(seatNum) {
  var container = document.getElementById('ai-cards-' + seatNum);
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function updateAiActions(aiActions) {
  if (!aiActions || !Array.isArray(aiActions)) return;
  for (var i = 0; i < aiActions.length; i++) {
    var a = aiActions[i];
    var el = qs('ai-action-' + a.seat);
    if (a.action === 'fold') {
      el.textContent = 'Folded';
      qs('ai-seat-' + a.seat).classList.add('folded');
    } else if (a.action === 'raise') {
      el.textContent = 'Raise ' + a.multiplier + 'x';
    }
  }
}

function displayAIShowdown(aiShowdown) {
  if (!aiShowdown || !Array.isArray(aiShowdown)) return;
  for (var i = 0; i < aiShowdown.length; i++) {
    var ai = aiShowdown[i];
    var seatNum = ai.seat;
    var container = document.getElementById('ai-cards-' + seatNum);

    // Clear any prior cards
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Add hole card spans
    if (ai.holeCards && Array.isArray(ai.holeCards)) {
      for (var j = 0; j < ai.holeCards.length; j++) {
        addCardToContainer(container, ai.holeCards[j]);
      }
    }

    // Set action text to hand result
    var actionEl = qs('ai-action-' + seatNum);
    var netText;
    if (ai.net > 0) {
      netText = '+$' + ai.net;
    } else if (ai.net === 0) {
      netText = 'Push';
    } else {
      netText = '-$' + Math.abs(ai.net);
    }
    actionEl.textContent = ai.handName + ' (' + netText + ')';
  }
}

// ------------------------------------------------------------
// Community card helpers
// ------------------------------------------------------------

function resetCommunityCards() {
  resetCardSlot(qs('card-community-0'));
  resetCardSlot(qs('card-community-1'));
}

function updateCommunityCards(communityCards) {
  if (!communityCards || !Array.isArray(communityCards)) return;
  if (communityCards.length >= 1) {
    displayCard(qs('card-community-0'), communityCards[0]);
  }
  if (communityCards.length >= 2) {
    displayCard(qs('card-community-1'), communityCards[1]);
  }
}

// ------------------------------------------------------------
// Fold / Showdown result handlers
// ------------------------------------------------------------

function handleFoldResponse(data) {
  currentPhase = 'idle';
  bankroll = data.finalBankroll;
  sessionActive = (bankroll > 0);

  qs('display-hand-name').textContent = 'Folded';
  displayResultNet(qs('display-result'), data.mainHandLoss);
  displayBonusResult(data.bonusResult);

  // Reveal community cards from AI showdown data (server dealt them for AI resolution)
  if (data.aiShowdown && data.aiShowdown.length > 0 && data.aiShowdown[0].communityCards) {
    updateCommunityCards(data.aiShowdown[0].communityCards);
  }

  displayAIShowdown(data.aiShowdown);

  if (!sessionActive) {
    qs('display-session-status').textContent = 'Busted';
  }

  updateDisplays();
  updateButtonStates();
}

function handleShowdownResponse(data) {
  currentPhase = 'idle';
  bankroll = data.finalBankroll;
  sessionActive = !data.sessionEnded;

  if (data.humanResult) {
    qs('display-hand-name').textContent = data.humanResult.handName;
    displayResultNet(qs('display-result'), data.humanResult.net);
  }

  displayBonusResult(data.bonusResult);
  displayAIShowdown(data.aiShowdown);

  if (data.sessionEnded) {
    qs('display-session-status').textContent = 'Busted';
  }

  updateDisplays();
  updateButtonStates();
}

// ------------------------------------------------------------
// API: New Session
// ------------------------------------------------------------

async function startNewSession() {
  clearError();
  qs('btn-new-session').disabled = true;

  try {
    var res = await fetch('/api/mississippi/new-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    var data = await res.json();

    if (data.error) {
      showError(data.error);
      updateButtonStates();
      return;
    }

    sessionActive = data.sessionActive;
    currentPhase = data.phase;
    bankroll = data.bankroll;
    handNumber = data.handNumber;
    aiPlayers = data.aiPlayers || [];
    currentAnte = 0;

    // Populate AI names and reset actions
    if (aiPlayers.length > 0) {
      setAiNames(aiPlayers);
    }
    resetAiActions();

    // Reset card slots
    resetCardSlot(qs('card-hole-0'));
    resetCardSlot(qs('card-hole-1'));
    resetCardSlot(qs('card-hole-2'));
    resetCommunityCards();

    clearBetDisplays();
    clearResults();

    updateDisplays();
    updateButtonStates();

  } catch (err) {
    showError('Network error. Please try again.');
    updateButtonStates();
  }
}

// ------------------------------------------------------------
// API: Ante / Deal
// ------------------------------------------------------------

async function submitAnte() {
  clearError();
  qs('btn-deal').disabled = true;

  var anteRaw = qs('input-ante').value;
  var bonusRaw = qs('input-bonus').value;
  var ante = parseInt(anteRaw, 10);
  var bonus = parseInt(bonusRaw, 10);

  var payload = { ante: ante };
  if (!isNaN(bonus) && bonus > 0) {
    payload.bonus = bonus;
  }

  try {
    var res = await fetch('/api/mississippi/ante', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();

    if (data.error) {
      showError(data.error);
      updateButtonStates();
      return;
    }

    currentPhase = data.phase;
    bankroll = data.bankroll;
    handNumber = data.handNumber;
    currentAnte = data.bets.ante;

    // Display hole cards
    displayCard(qs('card-hole-0'), data.holeCards[0]);
    displayCard(qs('card-hole-1'), data.holeCards[1]);
    displayCard(qs('card-hole-2'), data.holeCards[2]);

    // Reset community cards to placeholder
    resetCommunityCards();

    // Update bet displays
    updateBetDisplays(data.bets);

    // Reset AI actions to em dash for new hand
    resetAiActions();

    // Clear prior results
    clearResults();

    // Update AI ante info (show "Ante posted" or similar — just show em dash for now, no action yet)
    // aiActions from ante response shows ante placed — but spec only shows the em dash until street actions

    updateDisplays();
    updateButtonStates();

  } catch (err) {
    showError('Network error. Please try again.');
    updateButtonStates();
  }
}

// ------------------------------------------------------------
// API: Street Actions (third-street, fourth-street, fifth-street)
// ------------------------------------------------------------

var PHASE_TO_ENDPOINT = {
  third_street: 'third-street',
  fourth_street: 'fourth-street',
  fifth_street: 'fifth-street'
};

async function submitAction(action, multiplier) {
  clearError();

  // Disable action buttons during fetch (double-click prevention)
  qs('btn-raise-1x').disabled = true;
  qs('btn-raise-3x').disabled = true;
  qs('btn-fold').disabled = true;

  var endpoint = PHASE_TO_ENDPOINT[currentPhase];
  if (!endpoint) {
    showError('Action not allowed in current phase.');
    updateButtonStates();
    return;
  }

  var payload = { action: action };
  if (action === 'raise') {
    payload.multiplier = multiplier;
  }

  try {
    var res = await fetch('/api/mississippi/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();

    if (data.error) {
      showError(data.error);
      updateButtonStates();
      return;
    }

    bankroll = data.bankroll;

    // Update bets if present
    if (data.bets) {
      updateBetDisplays(data.bets);
    }

    // Update community cards if present
    if (data.communityCards && data.communityCards.length > 0) {
      updateCommunityCards(data.communityCards);
    }

    // Update AI actions for this street
    if (data.aiActions) {
      updateAiActions(data.aiActions);
    }

    // Branch on fold vs showdown
    if (data.action === 'fold') {
      handleFoldResponse(data);
      return;
    }

    if (data.phase === 'showdown') {
      handleShowdownResponse(data);
      return;
    }

    // Normal street advance
    currentPhase = data.phase;
    updateDisplays();
    updateButtonStates();

  } catch (err) {
    showError('Network error. Please try again.');
    updateButtonStates();
  }
}

// ------------------------------------------------------------
// API: Cash Out
// ------------------------------------------------------------

async function cashOut() {
  clearError();
  qs('btn-cash-out').disabled = true;

  try {
    var res = await fetch('/api/mississippi/cash-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    var data = await res.json();

    if (data.error) {
      showError(data.error);
      updateButtonStates();
      return;
    }

    sessionActive = false;
    currentPhase = 'idle';
    bankroll = data.finalBankroll;

    qs('display-hand-name').textContent = 'Cashed out';
    qs('display-result').textContent = '$' + data.finalBankroll + ' after ' + data.handsPlayed + ' hands';
    qs('display-result').className = 'ms-result';
    qs('display-bonus-result').textContent = '';

    updateDisplays();
    updateButtonStates();

  } catch (err) {
    showError('Network error. Please try again.');
    updateButtonStates();
  }
}

// ------------------------------------------------------------
// Page load: restore state from GET /api/mississippi/state
// ------------------------------------------------------------

async function restoreState() {
  try {
    var res = await fetch('/api/mississippi/state');
    var data = await res.json();

    if (!data.sessionActive) {
      // Default state — no active session
      sessionActive = false;
      currentPhase = 'idle';
      bankroll = 0;
      updateDisplays();
      updateButtonStates();
      return;
    }

    sessionActive = data.sessionActive;
    currentPhase = data.phase;
    bankroll = data.bankroll;
    handNumber = data.handNumber;
    currentAnte = (data.bets && data.bets.ante) ? data.bets.ante : 0;
    aiPlayers = data.aiPlayers || [];

    // Restore AI names
    if (aiPlayers.length > 0) {
      setAiNames(aiPlayers);
    }

    // Restore hole cards if available
    if (data.holeCards && data.holeCards.length === 3) {
      displayCard(qs('card-hole-0'), data.holeCards[0]);
      displayCard(qs('card-hole-1'), data.holeCards[1]);
      displayCard(qs('card-hole-2'), data.holeCards[2]);
    }

    // Restore community cards (show card if present, '?' if not)
    if (data.communityCards) {
      if (data.communityCards.length >= 1) {
        displayCard(qs('card-community-0'), data.communityCards[0]);
      }
      if (data.communityCards.length >= 2) {
        displayCard(qs('card-community-1'), data.communityCards[1]);
      }
    }

    // Restore bet displays
    if (data.bets) {
      updateBetDisplays(data.bets);
    }

    updateDisplays();
    updateButtonStates();

  } catch (err) {
    // On error, fall back to default state
    sessionActive = false;
    currentPhase = 'idle';
    bankroll = 0;
    updateDisplays();
    updateButtonStates();
  }
}

// ------------------------------------------------------------
// Button wiring
// ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  qs('btn-new-session').addEventListener('click', startNewSession);
  qs('btn-deal').addEventListener('click', submitAnte);
  qs('btn-raise-1x').addEventListener('click', function () { submitAction('raise', 1); });
  qs('btn-raise-3x').addEventListener('click', function () { submitAction('raise', 3); });
  qs('btn-fold').addEventListener('click', function () { submitAction('fold'); });
  qs('btn-cash-out').addEventListener('click', cashOut);

  // Restore state on page load
  restoreState();
});
