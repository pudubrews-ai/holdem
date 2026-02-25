// ============================================================
// Global state
// ============================================================
let currentGameState = null;
let currentGameId = null;
let previousGameState = null;
let pollingInterval = null;
let actionInFlight = false;

// ============================================================
// Screen management
// ============================================================
function showScreen(screenId) {
    document.getElementById('screen-config').style.display = 'none';
    document.getElementById('screen-game').style.display = 'none';
    document.getElementById('screen-gameover').style.display = 'none';
    document.getElementById(screenId).style.display = '';
}

// ============================================================
// Blind schedule parser
// ============================================================
function parseBlindSchedule(text) {
    var lines = text.split('\n');
    var validLevels = [];
    for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].trim();
        if (trimmed === '') continue;
        var match = trimmed.match(/^(\d+)\/(\d+)$/);
        if (!match) continue;
        var small = parseInt(match[1], 10);
        var big = parseInt(match[2], 10);
        if (small >= 1 && big === small * 2) {
            validLevels.push({ small: small, big: big });
        }
    }
    return validLevels;
}

// ============================================================
// Config validation
// ============================================================
function validateConfig() {
    var allValid = true;

    // AI count
    var aiCount = parseInt(document.querySelector('[data-testid="config-ai-count"]').value, 10);
    var aiError = document.querySelector('[data-testid="config-error-ai-count"]');
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > 11) {
        aiError.textContent = 'Number of AI players must be between 1 and 11.';
        aiError.style.display = '';
        allValid = false;
    } else {
        aiError.textContent = '';
        aiError.style.display = 'none';
    }

    // Starting stack
    var stack = parseInt(document.querySelector('[data-testid="config-starting-stack"]').value, 10);
    var stackError = document.querySelector('[data-testid="config-error-starting-stack"]');
    if (!Number.isInteger(stack) || stack < 100 || stack > 1000000) {
        stackError.textContent = 'Starting stack must be between 100 and 1,000,000.';
        stackError.style.display = '';
        allValid = false;
    } else {
        stackError.textContent = '';
        stackError.style.display = 'none';
    }

    // Hands per level
    var hpl = parseInt(document.querySelector('[data-testid="config-hands-per-level"]').value, 10);
    var hplError = document.querySelector('[data-testid="config-error-hands-per-level"]');
    if (!Number.isInteger(hpl) || hpl < 1 || hpl > 100) {
        hplError.textContent = 'Hands per blind level must be between 1 and 100.';
        hplError.style.display = '';
        allValid = false;
    } else {
        hplError.textContent = '';
        hplError.style.display = 'none';
    }

    // Blind schedule
    var scheduleText = document.querySelector('[data-testid="config-blind-schedule"]').value;
    var scheduleError = document.querySelector('[data-testid="config-error-blind-schedule"]');
    var validLevels = parseBlindSchedule(scheduleText);
    if (validLevels.length < 2) {
        scheduleError.textContent = 'Blind schedule must contain at least 2 valid levels (format: small/big, big must be 2x small).';
        scheduleError.style.display = '';
        allValid = false;
    } else {
        scheduleError.textContent = '';
        scheduleError.style.display = 'none';
    }

    // Enable/disable start button
    document.querySelector('[data-testid="config-start-btn"]').disabled = !allValid;

    return allValid;
}

// ============================================================
// Card display helpers
// ============================================================
function displayRank(card) {
    var rank = card[0];
    var rankMap = {
        '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
        '7': '7', '8': '8', '9': '9', 'T': '10',
        'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A'
    };
    return rankMap[rank] || rank;
}

function displaySuit(card) {
    var suit = card[1];
    var suitMap = { 's': '\u2660', 'h': '\u2665', 'd': '\u2666', 'c': '\u2663' };
    return suitMap[suit] || suit;
}

function suitColor(card) {
    var suit = card[1];
    return (suit === 'h' || suit === 'd') ? 'red' : 'black';
}

// ============================================================
// Card rendering
// ============================================================
function renderCard(containerEl, card) {
    while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);
    var cardEl = document.createElement('span');
    cardEl.className = 'card card-face';
    cardEl.style.color = suitColor(card);
    cardEl.textContent = displayRank(card) + displaySuit(card);
    containerEl.appendChild(cardEl);
}

function renderCardBack(containerEl) {
    while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);
    var cardEl = document.createElement('span');
    cardEl.className = 'card card-back';
    cardEl.textContent = '??';
    containerEl.appendChild(cardEl);
}

function renderSeatCards(player, gameState) {
    var cardsEl = document.querySelector('[data-testid="seat-' + player.seatIndex + '-cards"]');

    // Clear existing cards
    while (cardsEl.firstChild) cardsEl.removeChild(cardsEl.firstChild);

    if (player.status === 'eliminated') {
        return;
    }

    if (player.holeCards && player.holeCards.length === 2) {
        // Show face-up cards (human's own cards, or AI at showdown/hand-complete)
        for (var i = 0; i < player.holeCards.length; i++) {
            var card = player.holeCards[i];
            var cardSlot = document.createElement('span');
            cardSlot.className = 'card card-face';
            cardSlot.style.color = suitColor(card);
            cardSlot.textContent = displayRank(card) + displaySuit(card);
            cardsEl.appendChild(cardSlot);
        }
    } else if (player.id !== 'human' && player.status !== 'folded' && player.status !== 'eliminated') {
        // AI player with hidden cards — show card backs during active play
        var activePhases = ['pre-flop', 'flop', 'turn', 'river', 'showdown', 'hand-complete'];
        if (activePhases.indexOf(gameState.phase) !== -1) {
            for (var j = 0; j < 2; j++) {
                var backSlot = document.createElement('span');
                backSlot.className = 'card card-back';
                backSlot.textContent = '??';
                cardsEl.appendChild(backSlot);
            }
        }
    }
    // If human and holeCards is null (spectating, eliminated), show nothing
}

// ============================================================
// Community cards
// ============================================================
function renderCommunityCards(communityCards) {
    for (var i = 0; i < 5; i++) {
        var slot = document.querySelector('[data-testid="community-card-' + i + '"]');
        // Clear slot
        while (slot.firstChild) slot.removeChild(slot.firstChild);

        if (i < communityCards.length) {
            var card = communityCards[i];
            slot.className = 'card-slot card-face';
            slot.style.color = suitColor(card);
            slot.textContent = displayRank(card) + displaySuit(card);
        } else {
            slot.className = 'card-slot';
            slot.textContent = '';
            slot.style.color = '';
        }
    }
}

// ============================================================
// Pot and blind display
// ============================================================
function renderPotDisplay(pots) {
    var potEl = document.querySelector('[data-testid="pot-display"]');
    var totalPot = pots.reduce(function(sum, p) { return sum + p.amount; }, 0);
    potEl.textContent = 'Pot: ' + totalPot;
}

function renderBlindDisplay(smallBlind, bigBlind) {
    var blindEl = document.querySelector('[data-testid="blind-display"]');
    blindEl.textContent = 'Blinds: ' + smallBlind + '/' + bigBlind;
}

// ============================================================
// Hand info display
// ============================================================
function renderHandInfo(handNumber, blindLevel) {
    var infoEl = document.querySelector('[data-testid="hand-info"]');
    // Display blind level as 1-indexed
    infoEl.textContent = 'Hand ' + handNumber + ' \u2014 Level ' + (blindLevel + 1);
}

// ============================================================
// Seat status
// ============================================================
function getSeatStatusText(player) {
    if (player.status === 'eliminated') return 'ELIMINATED';
    if (player.status === 'all-in') return 'ALL IN';
    if (player.status === 'folded') return 'FOLDED';
    if (player.isDealer && player.isSmallBlind) return 'DEALER / SB';
    if (player.isDealer) return 'DEALER';
    if (player.isSmallBlind) return 'SB';
    if (player.isBigBlind) return 'BB';
    return '';
}

// ============================================================
// Seat rendering
// ============================================================
function renderSeat(player, gameState) {
    var seatEl = document.querySelector('[data-testid="seat-' + player.seatIndex + '"]');
    if (!seatEl) return;
    seatEl.style.display = ''; // show this seat

    // Name
    var nameEl = document.querySelector('[data-testid="seat-' + player.seatIndex + '-name"]');
    nameEl.textContent = player.name;

    // Stack
    var stackEl = document.querySelector('[data-testid="seat-' + player.seatIndex + '-stack"]');
    stackEl.textContent = player.stack + ' chips';

    // Cards
    renderSeatCards(player, gameState);

    // Bet
    var betEl = document.querySelector('[data-testid="seat-' + player.seatIndex + '-bet"]');
    betEl.textContent = player.bet > 0 ? 'Bet: ' + player.bet : '';

    // Status badge
    var statusEl = document.querySelector('[data-testid="seat-' + player.seatIndex + '-status"]');
    statusEl.textContent = getSeatStatusText(player);
}

// ============================================================
// Active seat highlighting
// ============================================================
function highlightActiveSeat(actionSeat) {
    for (var i = 0; i < 12; i++) {
        var seatEl = document.querySelector('[data-testid="seat-' + i + '"]');
        if (seatEl) {
            if (actionSeat !== null && actionSeat === i) {
                seatEl.classList.add('active-turn');
            } else {
                seatEl.classList.remove('active-turn');
            }
        }
    }
}

// ============================================================
// Action labels
// ============================================================
function clearActionLabels() {
    for (var i = 0; i < 12; i++) {
        var actionEl = document.querySelector('[data-testid="seat-' + i + '-action"]');
        if (actionEl) actionEl.textContent = '';
    }
}

function updateActionLabels(prevState, currentState) {
    for (var idx = 0; idx < currentState.players.length; idx++) {
        var player = currentState.players[idx];
        var prev = null;
        for (var j = 0; j < prevState.players.length; j++) {
            if (prevState.players[j].id === player.id) {
                prev = prevState.players[j];
                break;
            }
        }
        if (!prev) continue;

        var actionEl = document.querySelector('[data-testid="seat-' + player.seatIndex + '-action"]');
        if (!actionEl) continue;

        if (prev.status !== 'folded' && player.status === 'folded') {
            actionEl.textContent = 'Fold';
        } else if (prev.status !== 'all-in' && player.status === 'all-in') {
            actionEl.textContent = 'All In';
        } else if (player.bet > prev.bet && currentState.currentBet > prevState.currentBet) {
            actionEl.textContent = 'Raise';
        } else if (player.bet > prev.bet) {
            actionEl.textContent = 'Call';
        } else if (
            player.status === 'active' && prev.status === 'active' &&
            player.bet === prev.bet &&
            player.bet === currentState.currentBet &&
            prevState.actionSeat === player.seatIndex
        ) {
            actionEl.textContent = 'Check';
        }
        // Otherwise keep existing label
    }
}

// ============================================================
// Action panel
// ============================================================
function updateActionPanel(gameState) {
    var panel = document.querySelector('[data-testid="action-panel"]');
    var humanPlayer = null;
    for (var i = 0; i < gameState.players.length; i++) {
        if (gameState.players[i].id === 'human') {
            humanPlayer = gameState.players[i];
            break;
        }
    }
    var activePhases = ['pre-flop', 'flop', 'turn', 'river'];
    var isHumanTurn = activePhases.indexOf(gameState.phase) !== -1 && gameState.actionSeat === 0;

    panel.style.display = isHumanTurn ? '' : 'none';
    if (!isHumanTurn || !humanPlayer) return;

    var currentBet = gameState.currentBet;
    var playerBet = humanPlayer.bet;
    var playerStack = humanPlayer.stack;
    var callAmount = currentBet - playerBet;
    var minRaiseTotal = currentBet + gameState.minRaise;

    // Fold button: disabled if check is available (player has matched current bet)
    var foldBtn = document.querySelector('[data-testid="action-fold"]');
    foldBtn.disabled = (playerBet === currentBet);

    // Check button: disabled if there is a bet to call
    var checkBtn = document.querySelector('[data-testid="action-check"]');
    checkBtn.disabled = (currentBet > playerBet);

    // Call button: shows "Call {amount}", disabled if no bet to call
    var callBtn = document.querySelector('[data-testid="action-call"]');
    var effectiveCallAmount = Math.min(callAmount, playerStack);
    callBtn.textContent = 'Call ' + effectiveCallAmount;
    callBtn.disabled = (currentBet === playerBet);

    // Raise input
    var raiseInput = document.querySelector('[data-testid="action-raise-input"]');
    raiseInput.min = minRaiseTotal;
    raiseInput.max = playerStack + playerBet;
    var currentRaiseVal = parseInt(raiseInput.value, 10);
    if (!currentRaiseVal || currentRaiseVal < minRaiseTotal) {
        raiseInput.value = minRaiseTotal;
    }

    // Raise button
    var raiseBtn = document.querySelector('[data-testid="action-raise-btn"]');
    raiseBtn.textContent = 'Raise';

    // All-in button
    var allinBtn = document.querySelector('[data-testid="action-allin"]');
    allinBtn.textContent = 'All In (' + playerStack + ')';
}

// ============================================================
// Hand result banner
// ============================================================
function renderHandResult(gameState) {
    var resultEl = document.querySelector('[data-testid="hand-result"]');
    var showResult = (gameState.phase === 'showdown' || gameState.phase === 'hand-complete');

    resultEl.style.display = showResult ? '' : 'none';

    if (!showResult || !gameState.handResult || gameState.handResult.length === 0) {
        while (resultEl.firstChild) resultEl.removeChild(resultEl.firstChild);
        return;
    }

    // Clear and rebuild
    while (resultEl.firstChild) resultEl.removeChild(resultEl.firstChild);

    for (var i = 0; i < gameState.handResult.length; i++) {
        var potResult = gameState.handResult[i];
        var line = document.createElement('div');
        var winnerNames = potResult.winners.map(function(id) {
            for (var k = 0; k < gameState.players.length; k++) {
                if (gameState.players[k].id === id) return gameState.players[k].name;
            }
            return id;
        });

        if (winnerNames.length === 1) {
            line.textContent = winnerNames[0] + ' wins ' + potResult.amount + ' chips';
        } else {
            line.textContent = winnerNames.join(' and ') + ' split ' + potResult.amount + ' chips';
        }
        resultEl.appendChild(line);
    }
}

// ============================================================
// Next hand button
// ============================================================
function updateNextHandButton(gameState) {
    var btn = document.querySelector('[data-testid="next-hand-btn"]');
    var show = gameState.phase === 'hand-complete' && gameState.humanStatus !== 'spectating';
    btn.style.display = show ? '' : 'none';
}

// ============================================================
// Spectator banner
// ============================================================
function updateSpectatorBanner(gameState) {
    var banner = document.querySelector('[data-testid="spectator-banner"]');
    if (gameState.humanStatus === 'spectating') {
        banner.style.display = '';
        banner.textContent = 'You have been eliminated. Watching remaining players...';
    } else {
        banner.style.display = 'none';
        banner.textContent = '';
    }
}

// ============================================================
// Game over screen
// ============================================================
function renderGameOver(gameState) {
    showScreen('screen-gameover');
    stopPolling();

    var msgEl = document.querySelector('[data-testid="gameover-message"]');
    if (gameState.humanStatus === 'won') {
        msgEl.textContent = 'You won!';
    } else {
        var winner = null;
        for (var i = 0; i < gameState.players.length; i++) {
            if (gameState.players[i].status !== 'eliminated') {
                winner = gameState.players[i];
                break;
            }
        }
        msgEl.textContent = (winner ? winner.name : 'Unknown') + ' wins!';
    }

    // Standings
    var standingsEl = document.querySelector('[data-testid="gameover-standings"]');
    while (standingsEl.firstChild) standingsEl.removeChild(standingsEl.firstChild);

    if (gameState.standings) {
        for (var j = 0; j < gameState.standings.length; j++) {
            var entry = gameState.standings[j];
            var row = document.createElement('div');
            row.textContent = entry.position + '. ' + entry.name;
            standingsEl.appendChild(row);
        }
    } else {
        // Fallback: display players by stack (winner first, then others)
        var sorted = gameState.players.slice().sort(function(a, b) { return b.stack - a.stack; });
        for (var k = 0; k < sorted.length; k++) {
            var fallbackRow = document.createElement('div');
            fallbackRow.textContent = (k + 1) + '. ' + sorted[k].name;
            standingsEl.appendChild(fallbackRow);
        }
    }
}

// ============================================================
// Polling
// ============================================================
function startPolling() {
    if (pollingInterval) return; // already polling
    pollingInterval = setInterval(function() {
        fetch('/api/game')
            .then(function(response) {
                if (!response.ok) return null;
                return response.json();
            })
            .then(function(data) {
                if (!data) return;
                currentGameState = data;
                renderGameState(data);
            })
            .catch(function() {
                // Ignore polling errors silently
            });
    }, 1000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// ============================================================
// Master render function
// ============================================================
function renderGameState(gameState) {
    // Store previous state for action label diffing
    var prevState = previousGameState;
    previousGameState = JSON.parse(JSON.stringify(gameState)); // deep clone

    // Check for game-over first
    if (gameState.phase === 'game-over') {
        renderGameOver(gameState);
        return;
    }

    // Ensure game screen is visible (not gameover screen)
    // Only switch if we are not already on game screen
    if (document.getElementById('screen-game').style.display === 'none') {
        showScreen('screen-game');
    }

    // Clear action labels on new hand
    if (!prevState || prevState.handNumber !== gameState.handNumber) {
        clearActionLabels();
    } else {
        updateActionLabels(prevState, gameState);
    }

    // Render each component
    renderHandInfo(gameState.handNumber, gameState.blindLevel);
    renderCommunityCards(gameState.communityCards);
    renderPotDisplay(gameState.pots);
    renderBlindDisplay(gameState.smallBlind, gameState.bigBlind);

    // Render all seats — first hide all, then show active players
    for (var i = 0; i < 12; i++) {
        var seatEl = document.querySelector('[data-testid="seat-' + i + '"]');
        if (seatEl) seatEl.style.display = 'none';
    }
    for (var idx = 0; idx < gameState.players.length; idx++) {
        renderSeat(gameState.players[idx], gameState);
    }

    // Highlight active player
    highlightActiveSeat(gameState.actionSeat);

    // Action panel
    updateActionPanel(gameState);

    // Hand result banner
    renderHandResult(gameState);

    // Next hand button
    updateNextHandButton(gameState);

    // Spectator banner
    updateSpectatorBanner(gameState);

    // Polling control
    if (gameState.phase === 'hand-complete') {
        if (gameState.humanStatus === 'spectating') {
            // Keep polling — server will auto-advance after 5 seconds
        } else {
            stopPolling();
        }
    }
}

// ============================================================
// sendAction — with debouncing
// ============================================================
function sendAction(action, amount) {
    if (actionInFlight) return; // prevent double-sends
    actionInFlight = true;

    // Stop polling while action is in flight
    stopPolling();

    // Hide action panel immediately to prevent double-clicks
    document.querySelector('[data-testid="action-panel"]').style.display = 'none';

    var body = { gameId: currentGameId, action: action };
    if (action === 'raise') body.amount = amount;

    fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(function(response) {
        return response.json().then(function(data) {
            return { ok: response.ok, data: data };
        });
    })
    .then(function(result) {
        if (result.ok) {
            currentGameState = result.data;
            renderGameState(result.data);
        } else {
            console.error('Action error:', result.data.error);
            // Re-show action panel so user can try again
            if (currentGameState) {
                updateActionPanel(currentGameState);
            }
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    })
    .finally(function() {
        actionInFlight = false;
        // Resume polling unless we are at hand-complete or game-over
        if (currentGameState &&
            currentGameState.phase !== 'hand-complete' &&
            currentGameState.phase !== 'game-over') {
            startPolling();
        }
        // Special case: if spectating at hand-complete, keep polling
        if (currentGameState &&
            currentGameState.phase === 'hand-complete' &&
            currentGameState.humanStatus === 'spectating') {
            startPolling();
        }
    });
}

// ============================================================
// Event listeners — attached once at initialization
// ============================================================

// Config field blur validation
document.querySelector('[data-testid="config-ai-count"]').addEventListener('blur', validateConfig);
document.querySelector('[data-testid="config-starting-stack"]').addEventListener('blur', validateConfig);
document.querySelector('[data-testid="config-hands-per-level"]').addEventListener('blur', validateConfig);
document.querySelector('[data-testid="config-blind-schedule"]').addEventListener('blur', validateConfig);

// Also validate on input changes for better UX
document.querySelector('[data-testid="config-ai-count"]').addEventListener('input', validateConfig);
document.querySelector('[data-testid="config-starting-stack"]').addEventListener('input', validateConfig);
document.querySelector('[data-testid="config-hands-per-level"]').addEventListener('input', validateConfig);
document.querySelector('[data-testid="config-blind-schedule"]').addEventListener('input', validateConfig);

// Start Game button
document.querySelector('[data-testid="config-start-btn"]').addEventListener('click', function() {
    if (!validateConfig()) return;

    var aiCount = parseInt(document.querySelector('[data-testid="config-ai-count"]').value, 10);
    var startingStack = parseInt(document.querySelector('[data-testid="config-starting-stack"]').value, 10);
    var handsPerLevel = parseInt(document.querySelector('[data-testid="config-hands-per-level"]').value, 10);
    var blindSchedule = parseBlindSchedule(document.querySelector('[data-testid="config-blind-schedule"]').value);

    fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            aiCount: aiCount,
            startingStack: startingStack,
            handsPerLevel: handsPerLevel,
            blindSchedule: blindSchedule
        })
    })
    .then(function(response) {
        return response.json().then(function(data) {
            return { ok: response.ok, data: data };
        });
    })
    .then(function(result) {
        if (!result.ok) {
            console.error('Game start failed:', result.data.error);
            return;
        }
        var gameData = result.data;
        currentGameState = gameData;
        currentGameId = gameData.gameId;
        previousGameState = null;
        showScreen('screen-game');
        renderGameState(gameData);
        startPolling();
    })
    .catch(function(err) {
        console.error('Network error:', err);
    });
});

// Action buttons
document.querySelector('[data-testid="action-fold"]').addEventListener('click', function() {
    sendAction('fold');
});

document.querySelector('[data-testid="action-check"]').addEventListener('click', function() {
    sendAction('check');
});

document.querySelector('[data-testid="action-call"]').addEventListener('click', function() {
    sendAction('call');
});

document.querySelector('[data-testid="action-raise-btn"]').addEventListener('click', function() {
    var amount = parseInt(document.querySelector('[data-testid="action-raise-input"]').value, 10);
    sendAction('raise', amount);
});

document.querySelector('[data-testid="action-allin"]').addEventListener('click', function() {
    sendAction('allin');
});

// Next hand button
document.querySelector('[data-testid="next-hand-btn"]').addEventListener('click', function() {
    fetch('/api/next-hand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: currentGameId })
    })
    .then(function(response) {
        return response.json().then(function(data) {
            return { ok: response.ok, data: data };
        });
    })
    .then(function(result) {
        if (result.ok) {
            currentGameState = result.data;
            renderGameState(result.data);
            // Resume polling
            startPolling();
        } else {
            console.error('Next hand error:', result.data.error);
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    });
});

// Play Again button
document.querySelector('[data-testid="play-again-btn"]').addEventListener('click', function() {
    stopPolling();
    currentGameState = null;
    currentGameId = null;
    previousGameState = null;
    actionInFlight = false;
    showScreen('screen-config');
    // Reset config form to defaults
    document.querySelector('[data-testid="config-ai-count"]').value = '5';
    document.querySelector('[data-testid="config-starting-stack"]').value = '1000';
    document.querySelector('[data-testid="config-hands-per-level"]').value = '5';
    document.querySelector('[data-testid="config-blind-schedule"]').value = '10/20\n25/50\n50/100\n100/200\n200/400';
    // Clear errors
    var errorEls = document.querySelectorAll('.config-error');
    for (var i = 0; i < errorEls.length; i++) {
        errorEls[i].textContent = '';
        errorEls[i].style.display = 'none';
    }
    // Re-validate to set button state
    validateConfig();
});

// ============================================================
// Initial page load
// ============================================================
// Validate config on load to set initial button state
// (defaults are all valid, so button should be enabled)
validateConfig();
