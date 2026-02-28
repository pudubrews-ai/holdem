// ============================================================
// Global state
// ============================================================
let currentGameState = null;
let currentGameId = null;
let previousGameState = null;
let pollingInterval = null;
let actionInFlight = false;
let drawSelectedIndices = [];

// 3-Card Poker polling (separate from tournament polling)
let threecardPollInterval = null;

// Let It Ride state and polling
let lirState = null;
let lirPollInterval = null;

// ============================================================
// Screen management
// ============================================================
function showScreen(name) {
    var screens = ['screen-config', 'screen-game', 'screen-threecard', 'screen-letitride', 'screen-gameover'];
    screens.forEach(function(id) {
        document.getElementById(id).style.display = 'none';
    });
    document.getElementById('screen-' + name).style.display = 'block';
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
// Config validation helpers
// ============================================================
function clearAllConfigErrors() {
    var errorEls = document.querySelectorAll('.config-error');
    for (var i = 0; i < errorEls.length; i++) {
        errorEls[i].textContent = '';
        errorEls[i].style.display = 'none';
    }
}

function validateTournamentConfig() {
    var allValid = true;

    // Tournament type error is cleared (threecard check removed from here)
    var ttError = document.querySelector('[data-testid="config-error-tournament-type"]');
    ttError.textContent = '';
    ttError.style.display = 'none';

    var tournamentType = document.querySelector('[data-testid="config-tournament-type"]').value;

    // Update AI count max based on tournament type
    var aiCountInput = document.querySelector('[data-testid="config-ai-count"]');
    if (tournamentType === 'fivecard') {
        aiCountInput.max = '5';
    } else {
        aiCountInput.max = '11';
    }

    // AI count
    var aiCount = parseInt(aiCountInput.value, 10);
    var aiError = document.querySelector('[data-testid="config-error-ai-count"]');
    var aiMax = tournamentType === 'fivecard' ? 5 : 11;
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > aiMax) {
        if (tournamentType === 'fivecard' && Number.isInteger(aiCount) && aiCount > 5) {
            aiError.textContent = '5-Card Draw supports a maximum of 5 AI players.';
        } else {
            aiError.textContent = 'Number of AI players must be between 1 and ' + aiMax + '.';
        }
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

    document.querySelector('[data-testid="config-start-btn"]').disabled = !allValid;
    return allValid;
}

function validateThreecardConfig() {
    var valid = true;

    // 1. Bankroll
    var bankrollRaw = document.querySelector('[data-testid="config-bankroll"]').value;
    var bankroll = parseInt(bankrollRaw, 10);
    var bankrollErrEl = document.querySelector('[data-testid="config-error-bankroll"]');
    if (!Number.isInteger(bankroll) || String(bankroll) !== String(bankrollRaw).trim() || bankroll < 100 || bankroll > 1000000) {
        bankrollErrEl.textContent = 'Starting bankroll must be between 100 and 1,000,000.';
        bankrollErrEl.style.display = '';
        valid = false;
    } else {
        bankrollErrEl.textContent = '';
        bankrollErrEl.style.display = 'none';
    }

    // 2. Min bet
    var minBetRaw = document.querySelector('[data-testid="config-min-bet"]').value;
    var minBet = parseInt(minBetRaw, 10);
    var minBetErrEl = document.querySelector('[data-testid="config-error-min-bet"]');
    if (!Number.isInteger(minBet) || String(minBet) !== String(minBetRaw).trim() || minBet < 1 || minBet > 10000) {
        minBetErrEl.textContent = 'Minimum bet must be between 1 and 10,000.';
        minBetErrEl.style.display = '';
        valid = false;
    } else {
        minBetErrEl.textContent = '';
        minBetErrEl.style.display = 'none';
    }

    // 3. Max bet
    var maxBetRaw = document.querySelector('[data-testid="config-max-bet"]').value;
    var maxBet = parseInt(maxBetRaw, 10);
    var maxBetErrEl = document.querySelector('[data-testid="config-error-max-bet"]');
    if (!Number.isInteger(maxBet) || String(maxBet) !== String(maxBetRaw).trim() || maxBet < 1 || maxBet > 500000) {
        maxBetErrEl.textContent = 'Maximum bet must be between 1 and 500,000.';
        maxBetErrEl.style.display = '';
        valid = false;
    } else {
        maxBetErrEl.textContent = '';
        maxBetErrEl.style.display = 'none';
    }

    // 4. Max >= Min (only if both are individually valid)
    if (valid && maxBet < minBet) {
        document.querySelector('[data-testid="config-error-max-bet"]').textContent = 'Maximum bet must be greater than or equal to minimum bet.';
        document.querySelector('[data-testid="config-error-max-bet"]').style.display = '';
        valid = false;
    }

    document.querySelector('[data-testid="config-start-btn"]').disabled = !valid;
    return valid;
}

function validateConfig() {
    var type = document.querySelector('[data-testid="config-tournament-type"]').value;

    if (type === 'threecard' || type === 'letitride') {
        return validateThreecardConfig();
    } else {
        return validateTournamentConfig();
    }
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

// Format a card string as rank+suit symbol (e.g. "A♠")
function formatCardFace(card) {
    return displayRank(card) + displaySuit(card);
}

// ============================================================
// Card rendering (tournament screens)
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

    var expectedCardCount = (gameState.tournamentType === 'fivecard') ? 5 : 2;

    if (player.holeCards && player.holeCards.length > 0) {
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
        // AI player with hidden cards -- show card backs during active play
        var activePhases = ['pre-flop', 'flop', 'turn', 'river', 'draw', 'post-draw', 'showdown', 'hand-complete'];
        if (activePhases.indexOf(gameState.phase) !== -1) {
            for (var j = 0; j < expectedCardCount; j++) {
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
    var communityArea = document.querySelector('[data-testid="community-cards"]');
    if (currentGameState && currentGameState.tournamentType === 'fivecard') {
        communityArea.style.display = 'none';
        return;
    } else {
        communityArea.style.display = '';
    }

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
// Game type label
// ============================================================
function renderGameTypeLabel(gameState) {
    var labelEl = document.querySelector('[data-testid="game-type-label"]');
    if (!labelEl) return;
    if (gameState.tournamentType === 'fivecard') {
        labelEl.textContent = '5-Card Draw';
    } else {
        labelEl.textContent = 'Texas Hold\'em';
    }
}

// ============================================================
// Draw panel
// ============================================================
function renderDrawPanel(gameState) {
    var panel = document.querySelector('[data-testid="draw-panel"]');

    // Only show during draw phase when it is the human's turn
    var humanPlayer = null;
    for (var i = 0; i < gameState.players.length; i++) {
        if (gameState.players[i].id === 'human') {
            humanPlayer = gameState.players[i];
            break;
        }
    }

    var isHumanDrawTurn = (
        gameState.tournamentType === 'fivecard' &&
        gameState.phase === 'draw' &&
        gameState.drawSeat === 0 &&
        humanPlayer &&
        humanPlayer.holeCards &&
        humanPlayer.holeCards.length === 5 &&
        gameState.humanStatus !== 'spectating'
    );

    if (!isHumanDrawTurn) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = '';

    // Render each card button
    for (var c = 0; c < 5; c++) {
        var cardBtn = document.querySelector('[data-testid="draw-card-' + c + '"]');
        var card = humanPlayer.holeCards[c];
        cardBtn.textContent = displayRank(card) + displaySuit(card);
        cardBtn.style.color = suitColor(card);

        // Preserve selection state -- only reset if this is a new hand
        // (drawSelectedIndices is managed by click handlers)
    }

    // Update discard count display
    var countEl = document.querySelector('[data-testid="draw-discard-count"]');
    countEl.textContent = 'Discarding: ' + drawSelectedIndices.length + ' card(s)';

    // Update submit button text
    var submitBtn = document.querySelector('[data-testid="draw-submit-btn"]');
    if (drawSelectedIndices.length > 0) {
        submitBtn.textContent = 'Draw ' + drawSelectedIndices.length + ' Card(s)';
    } else {
        submitBtn.textContent = 'Stand Pat';
    }
}

// ============================================================
// Draw status
// ============================================================
function renderDrawStatus(gameState) {
    var statusEl = document.querySelector('[data-testid="draw-status"]');

    // Only show during draw phase when it is an AI's turn (not the human's turn)
    if (gameState.tournamentType !== 'fivecard' ||
        gameState.phase !== 'draw' ||
        gameState.drawSeat === null ||
        gameState.drawSeat === 0) {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
        return;
    }

    // Find the player whose turn it is to draw
    var drawPlayer = null;
    for (var i = 0; i < gameState.players.length; i++) {
        if (gameState.players[i].seatIndex === gameState.drawSeat) {
            drawPlayer = gameState.players[i];
            break;
        }
    }

    if (drawPlayer) {
        statusEl.style.display = '';
        statusEl.textContent = drawPlayer.name + ' is drawing...';
    } else {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
    }
}

// ============================================================
// Seat discards
// ============================================================
function renderSeatDiscards(player, gameState) {
    var discardsEl = document.querySelector('[data-testid="seat-' + player.seatIndex + '-discards"]');
    if (!discardsEl) return;

    if (gameState.tournamentType === 'fivecard' &&
        player.discardCount !== null && player.discardCount !== undefined &&
        player.discardCount > 0) {
        discardsEl.textContent = 'Drew: ' + player.discardCount;
        discardsEl.style.display = '';
    } else if (gameState.tournamentType !== 'fivecard') {
        // Hide entirely in Hold'em games
        discardsEl.textContent = '';
        discardsEl.style.display = 'none';
    } else {
        // fivecard but discardCount is 0 or null -- show empty
        discardsEl.textContent = '';
        discardsEl.style.display = '';
    }
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

    // Discards display (5-Card Draw only)
    renderSeatDiscards(player, gameState);
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
    var activePhases = ['pre-flop', 'flop', 'turn', 'river', 'post-draw'];
    var isHumanTurn = activePhases.indexOf(gameState.phase) !== -1 && gameState.actionSeat === 0;

    // Hide action panel during draw phase (draw panel handles that phase)
    if (gameState.phase === 'draw') {
        panel.style.display = 'none';
        return;
    }

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
            if (winnerNames[0] === 'You') {
                line.textContent = 'You win ' + potResult.amount + ' chips';
            } else {
                line.textContent = winnerNames[0] + ' wins ' + potResult.amount + ' chips';
            }
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
    if (gameState.tournamentType === 'letitride') {
        render3CGameOver(gameState); // LIR uses the same game-over display as 3-Card Poker
        return;
    }
    if (gameState.tournamentType === 'threecard') {
        render3CGameOver(gameState);
        return;
    }

    // Tournament game-over (unchanged from V2)
    showScreen('gameover');
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

    // Hide 3-Card-specific elements for tournament game-over
    var finalBankrollEl = document.querySelector('[data-testid="gameover-final-bankroll"]');
    var handsPlayedEl = document.querySelector('[data-testid="gameover-hands-played"]');
    if (finalBankrollEl) finalBankrollEl.style.display = 'none';
    if (handsPlayedEl) handsPlayedEl.style.display = 'none';

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

function render3CGameOver(state) {
    var humanPlayer = state.players.find(function(p) { return p.id === 'human'; });
    var isBust = state.humanStatus === 'bust';

    document.querySelector('[data-testid="gameover-message"]').textContent =
        isBust ? 'Busted!' : 'Cashed Out!';

    document.querySelector('[data-testid="gameover-final-bankroll"]').textContent =
        'Final bankroll: ' + (humanPlayer ? humanPlayer.bankroll : 0) + ' chips';

    document.querySelector('[data-testid="gameover-hands-played"]').textContent =
        'Hands played: ' + state.handNumber;

    // Show 3-Card-specific elements
    setVisible('[data-testid="gameover-final-bankroll"]', true);
    setVisible('[data-testid="gameover-hands-played"]', true);

    // Clear tournament standings for 3-Card game-over
    var standingsEl = document.querySelector('[data-testid="gameover-standings"]');
    while (standingsEl.firstChild) standingsEl.removeChild(standingsEl.firstChild);

    showScreen('gameover');
}

// ============================================================
// Polling (tournament)
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
// Master render function (tournament + 3-Card routing)
// ============================================================
function renderGameState(gameState) {
    // Route Let It Ride to its own renderer
    if (gameState.tournamentType === 'letitride') {
        renderLIRGameState(gameState);
        return;
    }

    // Route 3-Card Poker to its own renderer
    if (gameState.tournamentType === 'threecard') {
        render3CGameState(gameState);
        return;
    }

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
        showScreen('game');
    }

    // Clear action labels and reset draw selection on new hand
    if (!prevState || prevState.handNumber !== gameState.handNumber) {
        clearActionLabels();
        drawSelectedIndices = [];
        // Reset draw card button states
        for (var dc = 0; dc < 5; dc++) {
            var drawCardBtn = document.querySelector('[data-testid="draw-card-' + dc + '"]');
            if (drawCardBtn) drawCardBtn.setAttribute('data-selected', 'false');
        }
    } else {
        updateActionLabels(prevState, gameState);
    }

    // Render each component
    renderHandInfo(gameState.handNumber, gameState.blindLevel);
    renderCommunityCards(gameState.communityCards);
    renderPotDisplay(gameState.pots);
    renderBlindDisplay(gameState.smallBlind, gameState.bigBlind);
    renderGameTypeLabel(gameState);

    // Render all seats -- first hide all, then show active players
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

    // Draw panel and draw status (5-Card Draw only)
    renderDrawPanel(gameState);
    renderDrawStatus(gameState);

    // Hand result banner
    renderHandResult(gameState);

    // Next hand button
    updateNextHandButton(gameState);

    // Spectator banner
    updateSpectatorBanner(gameState);

    // Polling control
    if (gameState.phase === 'hand-complete') {
        if (gameState.humanStatus === 'spectating') {
            // Keep polling -- server will auto-advance after 5 seconds
        } else {
            stopPolling();
        }
    } else if (gameState.phase === 'draw' &&
               gameState.drawSeat === 0 &&
               gameState.humanStatus !== 'spectating') {
        // Stop polling when draw panel is visible (human is choosing discards)
        stopPolling();
    }
}

// ============================================================
// sendAction -- with debouncing
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
// sendDraw
// ============================================================
function sendDraw(discards) {
    if (actionInFlight) return;
    actionInFlight = true;

    // Stop polling while draw is in flight
    stopPolling();

    // Hide draw panel immediately to prevent double-submits
    document.querySelector('[data-testid="draw-panel"]').style.display = 'none';

    fetch('/api/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: currentGameId, discards: discards })
    })
    .then(function(response) {
        return response.json().then(function(data) {
            return { ok: response.ok, data: data };
        });
    })
    .then(function(result) {
        if (result.ok) {
            currentGameState = result.data;
            drawSelectedIndices = []; // reset selection
            renderGameState(result.data);
        } else {
            console.error('Draw error:', result.data.error);
            // Re-show draw panel so user can try again
            if (currentGameState) {
                renderDrawPanel(currentGameState);
            }
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    })
    .finally(function() {
        actionInFlight = false;
        // Resume polling unless at hand-complete or game-over
        if (currentGameState &&
            currentGameState.phase !== 'hand-complete' &&
            currentGameState.phase !== 'game-over') {
            startPolling();
        }
        if (currentGameState &&
            currentGameState.phase === 'hand-complete' &&
            currentGameState.humanStatus === 'spectating') {
            startPolling();
        }
    });
}

// ============================================================
// 3-Card Poker: utility
// ============================================================
function setVisible(selector, visible) {
    var el = document.querySelector(selector);
    if (el) el.style.display = visible ? 'block' : 'none';
}

// Client-side 3-card hand name evaluator (mirrors server's getThreeCardHandName).
// Returns a display-friendly hand name from a 3-card array e.g. ["Ah","Kd","Qc"].
function getThreeCardHandNameClient(cards) {
    var rankOrder = 'AKQJT98765432';
    var suits = cards.map(function(c) { return c[1]; });
    var isFlush = suits.every(function(s) { return s === suits[0]; });

    // Straight detection (mirrors server's isThreeCardStraight)
    var rankIndices = cards.map(function(c) { return rankOrder.indexOf(c[0]); });
    var sorted = rankIndices.slice().sort(function(a, b) { return a - b; });
    var isStraight = (sorted[2] - sorted[0] === 2 && sorted[1] - sorted[0] === 1);
    // A-2-3 (ace-low straight): rankOrder 'AKQJT98765432' gives A=0, 3=11, 2=12, so sorted=[0,11,12]
    if (!isStraight && sorted[0] === 0 && sorted[1] === 11 && sorted[2] === 12) {
        isStraight = true;
    }

    // Rank counts for pair / trips
    var rankCounts = {};
    rankIndices.forEach(function(r) { rankCounts[r] = (rankCounts[r] || 0) + 1; });
    var counts = Object.values(rankCounts).sort(function(a, b) { return b - a; });
    var isTrips = counts[0] === 3;
    var isPair  = counts[0] === 2;

    if (isStraight && isFlush) return 'Straight Flush';
    if (isTrips)  return 'Three of a Kind';
    if (isStraight) return 'Straight';
    if (isFlush)  return 'Flush';
    if (isPair)   return 'Pair';
    return 'High Card';
}

// ============================================================
// 3-Card Poker: polling
// ============================================================
function startThreecardPolling(state) {
    stopThreecardPolling(); // clear any existing interval first

    var pollPhases = ['dealing', 'resolution'];
    if (pollPhases.indexOf(state.phase) === -1) {
        // Fix 4: If game is over, route to game-over screen before returning
        if (state.phase === 'game-over') {
            renderGameOver(state);
        }
        return; // do not poll during betting, hand-complete, or game-over
    }

    threecardPollInterval = setInterval(function() {
        fetch('/api/game')
            .then(function(resp) {
                if (!resp.ok) return null;
                return resp.json();
            })
            .then(function(data) {
                if (!data) return;
                render3CGameState(data);
                // Stop polling when phase leaves the polling phases
                if (pollPhases.indexOf(data.phase) === -1) {
                    stopThreecardPolling();
                }
                // If game over, transition to game-over screen
                if (data.phase === 'game-over') {
                    stopThreecardPolling();
                    renderGameOver(data);
                }
            })
            .catch(function() {
                // Ignore polling errors silently
            });
    }, 1000);
}

function stopThreecardPolling() {
    if (threecardPollInterval !== null) {
        clearInterval(threecardPollInterval);
        threecardPollInterval = null;
    }
}

// ============================================================
// 3-Card Poker: master render function
// ============================================================
function render3CGameState(state) {
    // Fix 1: Guard — if game is over, route to game-over screen immediately
    if (state.phase === 'game-over' || state.humanStatus === 'bust' || state.humanStatus === 'cashedout') {
        renderGameOver(state);
        return;
    }

    var phase = state.phase;

    // Header
    document.querySelector('[data-testid="tc-game-label"]').textContent = '3-Card Poker';
    document.querySelector('[data-testid="tc-hand-number"]').textContent = 'Hand ' + state.handNumber;
    document.querySelector('[data-testid="tc-table-limits"]').textContent =
        'Min: ' + state.config.minBet + ' | Max: ' + state.config.maxBet;

    // Dealer area
    var revealDealer = phase === 'resolution' || phase === 'hand-complete';
    for (var i = 0; i < 3; i++) {
        var dealerCardEl = document.querySelector('[data-testid="tc-dealer-card-' + i + '"]');
        if (revealDealer && state.dealer.cards && state.dealer.cards[i]) {
            dealerCardEl.textContent = formatCardFace(state.dealer.cards[i]);
            dealerCardEl.style.color = suitColor(state.dealer.cards[i]);
        } else {
            dealerCardEl.textContent = '[card]';
            dealerCardEl.style.color = '';
        }
    }
    var dealerStatusEl = document.querySelector('[data-testid="tc-dealer-status"]');
    if (revealDealer && state.dealer.qualifies !== null) {
        dealerStatusEl.textContent = state.dealer.qualifies ? 'Qualifies' : 'Does Not Qualify';
    } else {
        dealerStatusEl.textContent = '';
    }

    // Player seats
    state.players.forEach(function(player) {
        var n = player.seatIndex;
        document.querySelector('[data-testid="tc-seat-' + n + '-name"]').textContent = player.name;
        document.querySelector('[data-testid="tc-seat-' + n + '-bankroll"]').textContent = player.bankroll + ' chips';

        // Cards: shown face-up for all players (except during "betting" phase when cards are null)
        for (var c = 0; c < 3; c++) {
            var cardEl = document.querySelector('[data-testid="tc-seat-' + n + '-card-' + c + '"]');
            if (player.cards && player.cards[c]) {
                cardEl.textContent = formatCardFace(player.cards[c]);
                cardEl.style.color = suitColor(player.cards[c]); // RED SUIT FIX
            } else {
                cardEl.textContent = '';
                cardEl.style.color = '';
            }
        }

        // Bets
        document.querySelector('[data-testid="tc-seat-' + n + '-ante"]').textContent =
            player.anteBet > 0 ? 'Ante: ' + player.anteBet : '';
        document.querySelector('[data-testid="tc-seat-' + n + '-play"]').textContent =
            player.playBet > 0 ? 'Play: ' + player.playBet : '';
        document.querySelector('[data-testid="tc-seat-' + n + '-pairplus"]').textContent =
            player.pairPlusBet > 0 ? 'Pair+: ' + player.pairPlusBet : '';
        document.querySelector('[data-testid="tc-seat-' + n + '-sixcard"]').textContent =
            player.sixCardBet > 0 ? '6-Card: ' + player.sixCardBet : '';

        // Result: shown during resolution and hand-complete
        var resultEl = document.querySelector('[data-testid="tc-seat-' + n + '-result"]');
        if ((phase === 'resolution' || phase === 'hand-complete') && player.handResult) {
            var net = player.handResult.netChange;
            resultEl.textContent = (net >= 0 ? '+' : '') + net;
        } else {
            resultEl.textContent = '';
        }

        // Status
        var statusEl = document.querySelector('[data-testid="tc-seat-' + n + '-status"]');
        if (player.folded) {
            statusEl.textContent = 'FOLDED';
        } else if (player.status === 'bust') {
            statusEl.textContent = 'BUST';
        } else {
            statusEl.textContent = '';
        }
    });

    var humanPlayer = state.players.find(function(p) { return p.id === 'human'; });

    // Panel visibility
    setVisible('[data-testid="tc-bet-panel"]', phase === 'betting');
    setVisible('[data-testid="tc-play-panel"]', phase === 'dealing');
    setVisible('[data-testid="tc-results-panel"]', phase === 'resolution' || phase === 'hand-complete');
    setVisible('[data-testid="tc-next-hand-btn"]', phase === 'hand-complete');

    var showCashOut = phase === 'betting' || phase === 'hand-complete';
    setVisible('[data-testid="tc-cashout-btn"]', showCashOut);
    if (showCashOut && humanPlayer) {
        document.querySelector('[data-testid="tc-cashout-btn"]').textContent =
            'Cash Out (' + humanPlayer.bankroll + ' chips)';
    }

    // Bet panel content
    if (phase === 'betting' && humanPlayer) {
        // Clear per-hand display elements when a new hand's betting phase begins
        document.querySelector('[data-testid="tc-human-hand-name"]').textContent = '';
        document.querySelector('[data-testid="tc-human-bankroll"]').textContent =
            'Bankroll: ' + humanPlayer.bankroll;
        var anteInput = document.querySelector('[data-testid="tc-ante-input"]');
        anteInput.min = state.config.minBet;
        anteInput.max = state.config.maxBet;
        var ppInput = document.querySelector('[data-testid="tc-pairplus-input"]');
        ppInput.min = 0;
        ppInput.max = state.config.maxBet;
        var scInput = document.querySelector('[data-testid="tc-sixcard-input"]');
        scInput.min = 0;
        scInput.max = state.config.maxBet;
    }

    // Play panel content
    if (phase === 'dealing' && humanPlayer) {
        document.querySelector('[data-testid="tc-play-btn"]').textContent =
            'Play (costs ' + humanPlayer.anteBet + ')';
        document.querySelector('[data-testid="tc-fold-btn"]').textContent =
            'Fold (forfeit ' + humanPlayer.anteBet + ')';
    }

    // Results panel content
    if ((phase === 'resolution' || phase === 'hand-complete') && humanPlayer && humanPlayer.handResult) {
        var hr = humanPlayer.handResult;
        var netChange = hr.netChange;

        document.querySelector('[data-testid="tc-results-net"]').textContent =
            (netChange >= 0 ? '+' : '') + netChange + ' chips';

        document.querySelector('[data-testid="tc-dealer-hand-name"]').textContent =
            state.dealer.qualifies !== null
                ? (state.dealer.qualifies ? 'Dealer qualifies' : 'Dealer does not qualify')
                : '';

        document.querySelector('[data-testid="tc-human-hand-name"]').textContent =
            humanPlayer.cards ? getThreeCardHandNameClient(humanPlayer.cards) : '';

        // Build results summary
        var parts = [];
        if (hr.anteResult === 'win') parts.push('Ante: +' + humanPlayer.anteBet);
        else if (hr.anteResult === 'loss') parts.push('Ante: -' + humanPlayer.anteBet);
        else if (hr.anteResult === 'push') parts.push('Ante: push');
        if (hr.playResult === 'win') parts.push('Play: +' + humanPlayer.playBet);
        else if (hr.playResult === 'loss') parts.push('Play: -' + humanPlayer.playBet);
        else if (hr.playResult === 'push') parts.push('Play: push');
        if (hr.anteBonus > 0) parts.push('Ante Bonus: +' + hr.anteBonus);
        if (hr.pairPlusResult === 'win') parts.push('Pair Plus: +' + hr.pairPlusPayout);
        else if (hr.pairPlusResult === 'loss') parts.push('Pair Plus: -' + humanPlayer.pairPlusBet);
        if (hr.sixCardResult === 'win') parts.push('Six Card: +' + hr.sixCardPayout);
        else if (hr.sixCardResult === 'loss') parts.push('Six Card: -' + humanPlayer.sixCardBet);
        document.querySelector('[data-testid="tc-results-summary"]').textContent = parts.join(', ');
    }
}

// ============================================================
// Error display utility
// ============================================================
function showError(msg) {
    console.error(msg);
}

// ============================================================
// Let It Ride: polling
// ============================================================
function startLIRPolling() {
    if (lirPollInterval) return; // already polling
    lirPollInterval = setInterval(function() {
        fetch('/api/game')
            .then(function(res) {
                if (!res.ok) return null;
                return res.json();
            })
            .then(function(data) {
                if (!data) return;
                renderLIRGameState(data);
            })
            .catch(function() {
                // silently ignore polling errors
            });
    }, 1000);
}

function stopLIRPolling() {
    if (lirPollInterval) {
        clearInterval(lirPollInterval);
        lirPollInterval = null;
    }
}

// ============================================================
// Let It Ride: community card renderer
// ============================================================
function renderLIRCommunityCards(state) {
    var card1El = document.querySelector('[data-testid="lir-community-card-1"]');
    var card2El = document.querySelector('[data-testid="lir-community-card-2"]');

    // During betting, no cards are dealt yet — show nothing
    if (state.phase === 'betting') {
        card1El.textContent = '';
        card1El.style.color = '';
        card1El.classList.remove('card-back', 'card-face');
        card2El.textContent = '';
        card2El.style.color = '';
        card2El.classList.remove('card-back', 'card-face');
        return;
    }

    if (state.community.card1) {
        card1El.textContent = formatCardFace(state.community.card1);
        card1El.style.color = suitColor(state.community.card1);
        card1El.classList.remove('card-back');
        card1El.classList.add('card-face');
    } else {
        card1El.textContent = '';
        card1El.style.color = '';
        card1El.classList.add('card-back');
        card1El.classList.remove('card-face');
    }

    if (state.community.card2) {
        card2El.textContent = formatCardFace(state.community.card2);
        card2El.style.color = suitColor(state.community.card2);
        card2El.classList.remove('card-back');
        card2El.classList.add('card-face');
    } else {
        card2El.textContent = '';
        card2El.style.color = '';
        card2El.classList.add('card-back');
        card2El.classList.remove('card-face');
    }
}

// ============================================================
// Let It Ride: seat renderer
// ============================================================
function renderLIRSeats(state) {
    for (var si = 0; si < state.players.length; si++) {
        var player = state.players[si];
        var n = player.seatIndex;
        var prefix = 'lir-seat-' + n;

        // Name
        var nameEl = document.querySelector('[data-testid="' + prefix + '-name"]');
        nameEl.textContent = player.name;

        // Bankroll
        var bankEl = document.querySelector('[data-testid="' + prefix + '-bankroll"]');
        bankEl.textContent = player.bankroll + ' chips';

        // Cards (3 hole cards, always face-up when present)
        var cardsEl = document.querySelector('[data-testid="' + prefix + '-cards"]');
        cardsEl.innerHTML = ''; // safe: clears container before programmatic rebuild
        if (player.cards) {
            for (var ci = 0; ci < player.cards.length; ci++) {
                var card = player.cards[ci];
                var cardEl = document.createElement('span');
                cardEl.className = 'lir-card';
                cardEl.textContent = formatCardFace(card);
                cardEl.style.color = suitColor(card); // RED SUIT FIX
                cardsEl.appendChild(cardEl);
            }
        }

        // Bet 1
        var bet1El = document.querySelector('[data-testid="' + prefix + '-bet1"]');
        if (player.bet1Withdrawn) {
            bet1El.textContent = 'Bet 1: WITHDRAWN';
        } else if (player.bet1 > 0) {
            bet1El.textContent = 'Bet 1: ' + player.bet1;
        } else {
            bet1El.textContent = '';
        }

        // Bet 2
        var bet2El = document.querySelector('[data-testid="' + prefix + '-bet2"]');
        if (player.bet2Withdrawn) {
            bet2El.textContent = 'Bet 2: WITHDRAWN';
        } else if (player.bet2 > 0) {
            bet2El.textContent = 'Bet 2: ' + player.bet2;
        } else {
            bet2El.textContent = '';
        }

        // Bet 3
        var bet3El = document.querySelector('[data-testid="' + prefix + '-bet3"]');
        if (player.bet3 > 0) {
            bet3El.textContent = 'Bet 3: ' + player.bet3;
        } else {
            bet3El.textContent = '';
        }

        // Bonus
        var bonusEl = document.querySelector('[data-testid="' + prefix + '-bonus"]');
        if (player.bonusBet > 0) {
            bonusEl.textContent = 'Bonus: ' + player.bonusBet;
        } else {
            bonusEl.textContent = '';
        }

        // Result (shown during hand-complete or game-over)
        var resultEl = document.querySelector('[data-testid="' + prefix + '-result"]');
        if (player.handResult && (state.phase === 'hand-complete' || state.phase === 'game-over')) {
            var net = player.handResult.netChange;
            var baseBetR = player.bet3;
            var totalDeductedR = baseBetR * 3 + player.bonusBet;
            var withdrawalsR = (player.bet1Withdrawn ? baseBetR : 0) + (player.bet2Withdrawn ? baseBetR : 0);
            var overallPnL = net + withdrawalsR - totalDeductedR;
            if (overallPnL >= 0) {
                resultEl.textContent = '+' + overallPnL + ' chips';
            } else {
                resultEl.textContent = overallPnL + ' chips';
            }
        } else {
            resultEl.textContent = '';
        }

        // Status
        var statusEl = document.querySelector('[data-testid="' + prefix + '-status"]');
        statusEl.textContent = player.status === 'bust' ? 'BUST' : '';
    }
}

// ============================================================
// Let It Ride: bet panel renderer
// ============================================================
function renderLIRBetPanel(state) {
    var human = null;
    for (var i = 0; i < state.players.length; i++) {
        if (state.players[i].seatIndex === 0) { human = state.players[i]; break; }
    }
    var input = document.querySelector('[data-testid="lir-base-bet-input"]');
    var checkbox = document.querySelector('[data-testid="lir-bonus-checkbox"]');
    var totalEl = document.querySelector('[data-testid="lir-total-cost"]');
    var bankrollEl = document.querySelector('[data-testid="lir-human-bankroll"]');
    var cashoutBtn = document.querySelector('[data-testid="lir-cashout-btn"]');

    // Set input constraints
    input.min = state.config.minBet;
    input.max = state.config.maxBet;
    if (!input.value) input.value = state.config.minBet;

    // Update total cost display on input change
    function updateTotal() {
        var base = parseInt(input.value) || 0;
        var bonus = checkbox.checked ? base : 0;
        totalEl.textContent = 'Total: ' + (base * 3 + bonus) + ' chips';
    }
    input.oninput = updateTotal;
    checkbox.onchange = updateTotal;
    updateTotal();

    if (human) {
        bankrollEl.textContent = 'Bankroll: ' + human.bankroll;
        cashoutBtn.textContent = 'Cash Out (' + human.bankroll + ' chips)';
    }
}

// ============================================================
// Let It Ride: decision panel renderer
// ============================================================
function renderLIRDecisionPanel(state) {
    var human = null;
    for (var i = 0; i < state.players.length; i++) {
        if (state.players[i].seatIndex === 0) { human = state.players[i]; break; }
    }
    var baseBet = human ? human.bet3 : 0;

    var promptEl = document.querySelector('[data-testid="lir-decision-prompt"]');
    var withdrawBtn = document.querySelector('[data-testid="lir-withdraw-btn"]');

    if (state.phase === 'first-decision') {
        promptEl.textContent = 'Withdraw Bet 1?';
    } else {
        promptEl.textContent = 'Withdraw Bet 2?';
    }
    withdrawBtn.textContent = 'Withdraw (' + baseBet + ' chips back)';
}

// ============================================================
// Let It Ride: results panel renderer
// ============================================================
function renderLIRResultsPanel(state) {
    var human = null;
    for (var i = 0; i < state.players.length; i++) {
        if (state.players[i].seatIndex === 0) { human = state.players[i]; break; }
    }
    if (!human || !human.handResult) return;

    var result = human.handResult;
    var handNameEl = document.querySelector('[data-testid="lir-hand-name"]');
    handNameEl.textContent = result.handName;

    // Build breakdown string
    var baseBet = human.bet3;
    var parts = [];

    // Bet 1
    if (result.bet1Result === 'withdrawn') {
        parts.push('Bet 1: withdrawn');
    } else if (result.bet1Result === 'win') {
        parts.push('Bet 1: +' + (baseBet * (result.mainPayout + 1)));
    } else {
        parts.push('Bet 1: -' + baseBet);
    }

    // Bet 2
    if (result.bet2Result === 'withdrawn') {
        parts.push('Bet 2: withdrawn');
    } else if (result.bet2Result === 'win') {
        parts.push('Bet 2: +' + (baseBet * (result.mainPayout + 1)));
    } else {
        parts.push('Bet 2: -' + baseBet);
    }

    // Bet 3
    if (result.bet3Result === 'win') {
        parts.push('Bet 3: +' + (baseBet * (result.mainPayout + 1)));
    } else {
        parts.push('Bet 3: -' + baseBet);
    }

    // Bonus
    if (result.bonusResult === 'win') {
        parts.push('Bonus: +' + (human.bonusBet * (result.bonusPayout + 1)));
    } else if (result.bonusResult === 'loss') {
        parts.push('Bonus: -' + human.bonusBet);
    }

    var breakdownEl = document.querySelector('[data-testid="lir-results-breakdown"]');
    breakdownEl.textContent = parts.join(' | ');

    // Net result (overall P&L from player perspective)
    var netEl = document.querySelector('[data-testid="lir-results-net"]');
    var totalDeducted = baseBet * 3 + human.bonusBet;
    var withdrawals = (human.bet1Withdrawn ? baseBet : 0) + (human.bet2Withdrawn ? baseBet : 0);
    var overallPnL = result.netChange + withdrawals - totalDeducted;
    if (overallPnL >= 0) {
        netEl.textContent = '+' + overallPnL + ' chips';
    } else {
        netEl.textContent = overallPnL + ' chips';
    }
}

// ============================================================
// Let It Ride: panel visibility controller
// ============================================================
function renderLIRPanels(state) {
    var betPanel = document.querySelector('[data-testid="lir-bet-panel"]');
    var decisionPanel = document.querySelector('[data-testid="lir-decision-panel"]');
    var resultsPanel = document.querySelector('[data-testid="lir-results-panel"]');

    // Hide all
    betPanel.style.display = 'none';
    decisionPanel.style.display = 'none';
    resultsPanel.style.display = 'none';

    if (state.phase === 'betting') {
        betPanel.style.display = '';
        renderLIRBetPanel(state);
    } else if (state.phase === 'first-decision' || state.phase === 'second-decision') {
        decisionPanel.style.display = '';
        renderLIRDecisionPanel(state);
    } else if (state.phase === 'hand-complete') {
        resultsPanel.style.display = '';
        renderLIRResultsPanel(state);
    }
    // game-over: no panel (handled by showScreen('screen-gameover'))
}

// ============================================================
// Let It Ride: master renderer
// ============================================================
function renderLIRGameState(state) {
    lirState = state;

    // Header
    var handNumEl = document.querySelector('[data-testid="lir-hand-number"]');
    handNumEl.textContent = 'Hand ' + state.handNumber;

    var limitsEl = document.querySelector('[data-testid="lir-table-limits"]');
    limitsEl.textContent = 'Min: ' + state.config.minBet + ' | Max: ' + state.config.maxBet;

    // Community cards
    renderLIRCommunityCards(state);

    // Player seats
    renderLIRSeats(state);

    // Panel visibility
    renderLIRPanels(state);

    // Polling control
    if (state.phase === 'first-decision' || state.phase === 'second-decision') {
        startLIRPolling();
    } else {
        stopLIRPolling();
    }

    // Game over
    if (state.phase === 'game-over') {
        renderGameOver(state);
        showScreen('gameover');
    }
}

// ============================================================
// Event listeners -- attached once at initialization
// ============================================================

// Tournament type change listener: show/hide field groups and re-validate
document.querySelector('[data-testid="config-tournament-type"]').addEventListener('change', function() {
    var type = document.querySelector('[data-testid="config-tournament-type"]').value;
    var tournamentFields = document.getElementById('tournament-config-fields');
    var threecardFields = document.getElementById('threecard-config-fields');

    if (type === 'threecard' || type === 'letitride') {
        tournamentFields.style.display = 'none';
        threecardFields.style.display = 'block';
        // Clear tournament error divs
        var ttError = document.querySelector('[data-testid="config-error-tournament-type"]');
        ttError.textContent = '';
        ttError.style.display = 'none';
    } else {
        threecardFields.style.display = 'none';
        tournamentFields.style.display = 'block';
        // Clear 3-Card error divs
        document.querySelector('[data-testid="config-error-bankroll"]').textContent = '';
        document.querySelector('[data-testid="config-error-bankroll"]').style.display = 'none';
        document.querySelector('[data-testid="config-error-min-bet"]').textContent = '';
        document.querySelector('[data-testid="config-error-min-bet"]').style.display = 'none';
        document.querySelector('[data-testid="config-error-max-bet"]').textContent = '';
        document.querySelector('[data-testid="config-error-max-bet"]').style.display = 'none';
    }
    validateConfig();
});

// Config field blur/input validation (tournament fields)
document.querySelector('[data-testid="config-ai-count"]').addEventListener('blur', validateConfig);
document.querySelector('[data-testid="config-starting-stack"]').addEventListener('blur', validateConfig);
document.querySelector('[data-testid="config-hands-per-level"]').addEventListener('blur', validateConfig);
document.querySelector('[data-testid="config-blind-schedule"]').addEventListener('blur', validateConfig);

document.querySelector('[data-testid="config-ai-count"]').addEventListener('input', validateConfig);
document.querySelector('[data-testid="config-starting-stack"]').addEventListener('input', validateConfig);
document.querySelector('[data-testid="config-hands-per-level"]').addEventListener('input', validateConfig);
document.querySelector('[data-testid="config-blind-schedule"]').addEventListener('input', validateConfig);

// Config field blur/input validation (3-Card Poker fields)
document.querySelector('[data-testid="config-bankroll"]').addEventListener('blur', validateConfig);
document.querySelector('[data-testid="config-min-bet"]').addEventListener('blur', validateConfig);
document.querySelector('[data-testid="config-max-bet"]').addEventListener('blur', validateConfig);

document.querySelector('[data-testid="config-bankroll"]').addEventListener('input', validateConfig);
document.querySelector('[data-testid="config-min-bet"]').addEventListener('input', validateConfig);
document.querySelector('[data-testid="config-max-bet"]').addEventListener('input', validateConfig);

// Start Game button
document.querySelector('[data-testid="config-start-btn"]').addEventListener('click', function() {
    if (!validateConfig()) return;

    var type = document.querySelector('[data-testid="config-tournament-type"]').value;
    var body;

    if (type === 'letitride') {
        body = {
            tournamentType: 'letitride',
            bankroll: parseInt(document.querySelector('[data-testid="config-bankroll"]').value, 10),
            minBet: parseInt(document.querySelector('[data-testid="config-min-bet"]').value, 10),
            maxBet: parseInt(document.querySelector('[data-testid="config-max-bet"]').value, 10)
        };
    } else if (type === 'threecard') {
        body = {
            tournamentType: 'threecard',
            bankroll: parseInt(document.querySelector('[data-testid="config-bankroll"]').value, 10),
            minBet: parseInt(document.querySelector('[data-testid="config-min-bet"]').value, 10),
            maxBet: parseInt(document.querySelector('[data-testid="config-max-bet"]').value, 10)
        };
    } else {
        var aiCount = parseInt(document.querySelector('[data-testid="config-ai-count"]').value, 10);
        var startingStack = parseInt(document.querySelector('[data-testid="config-starting-stack"]').value, 10);
        var handsPerLevel = parseInt(document.querySelector('[data-testid="config-hands-per-level"]').value, 10);
        var blindSchedule = parseBlindSchedule(document.querySelector('[data-testid="config-blind-schedule"]').value);
        body = {
            tournamentType: type,
            aiCount: aiCount,
            startingStack: startingStack,
            handsPerLevel: handsPerLevel,
            blindSchedule: blindSchedule
        };
    }

    fetch('/api/game', {
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
        if (!result.ok) {
            console.error('Game start failed:', result.data.error);
            return;
        }
        var state = result.data;
        currentGameState = state;
        currentGameId = state.gameId;
        previousGameState = null;

        if (state.tournamentType === 'letitride') {
            showScreen('letitride');
            renderLIRGameState(state);
        } else if (state.tournamentType === 'threecard') {
            showScreen('threecard');
            render3CGameState(state);
            // Do NOT start polling — initial phase is "betting" which requires human input
        } else {
            showScreen('game');
            renderGameState(state);
            startPolling();
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    });
});

// Action buttons (tournament)
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

// Draw card toggle handlers (5-Card Draw)
for (var drawIdx = 0; drawIdx < 5; drawIdx++) {
    (function(idx) {
        document.querySelector('[data-testid="draw-card-' + idx + '"]').addEventListener('click', function() {
            var btn = document.querySelector('[data-testid="draw-card-' + idx + '"]');
            var isSelected = btn.getAttribute('data-selected') === 'true';

            if (isSelected) {
                // Deselect
                btn.setAttribute('data-selected', 'false');
                var pos = drawSelectedIndices.indexOf(idx);
                if (pos !== -1) drawSelectedIndices.splice(pos, 1);
            } else {
                // Select -- but enforce max 3
                if (drawSelectedIndices.length >= 3) return; // do nothing if 3 already selected
                btn.setAttribute('data-selected', 'true');
                drawSelectedIndices.push(idx);
            }

            // Update discard count display
            var countEl = document.querySelector('[data-testid="draw-discard-count"]');
            countEl.textContent = 'Discarding: ' + drawSelectedIndices.length + ' card(s)';

            // Update submit button text
            var submitBtn = document.querySelector('[data-testid="draw-submit-btn"]');
            if (drawSelectedIndices.length > 0) {
                submitBtn.textContent = 'Draw ' + drawSelectedIndices.length + ' Card(s)';
            } else {
                submitBtn.textContent = 'Stand Pat';
            }
        });
    })(drawIdx);
}

// Draw submit handler
document.querySelector('[data-testid="draw-submit-btn"]').addEventListener('click', function() {
    if (!currentGameState || !currentGameState.players) return;
    var humanPlayer = null;
    for (var i = 0; i < currentGameState.players.length; i++) {
        if (currentGameState.players[i].id === 'human') {
            humanPlayer = currentGameState.players[i];
            break;
        }
    }
    if (!humanPlayer || !humanPlayer.holeCards) return;

    // Build discards array from selected indices
    var discards = [];
    for (var j = 0; j < drawSelectedIndices.length; j++) {
        var cardIdx = drawSelectedIndices[j];
        if (cardIdx >= 0 && cardIdx < humanPlayer.holeCards.length) {
            discards.push(humanPlayer.holeCards[cardIdx]);
        }
    }

    sendDraw(discards);
});

// Next hand button (tournament)
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
    stopThreecardPolling();
    stopLIRPolling();
    lirState = null;
    currentGameState = null;
    currentGameId = null;
    previousGameState = null;
    actionInFlight = false;
    showScreen('config');
    // Reset tournament type and show tournament fields
    document.querySelector('[data-testid="config-tournament-type"]').value = 'holdem';
    document.getElementById('tournament-config-fields').style.display = 'block';
    document.getElementById('threecard-config-fields').style.display = 'none';
    // Reset AI count max back to 11
    document.querySelector('[data-testid="config-ai-count"]').max = '11';
    // Reset draw state
    drawSelectedIndices = [];
    // Reset config form to defaults
    document.querySelector('[data-testid="config-ai-count"]').value = '5';
    document.querySelector('[data-testid="config-starting-stack"]').value = '1000';
    document.querySelector('[data-testid="config-hands-per-level"]').value = '5';
    document.querySelector('[data-testid="config-blind-schedule"]').value = '10/20\n25/50\n50/100\n100/200\n200/400';
    // Reset 3-Card fields to defaults
    document.querySelector('[data-testid="config-bankroll"]').value = '1000';
    document.querySelector('[data-testid="config-min-bet"]').value = '5';
    document.querySelector('[data-testid="config-max-bet"]').value = '500';
    // Clear all errors
    var errorEls = document.querySelectorAll('.config-error');
    for (var i = 0; i < errorEls.length; i++) {
        errorEls[i].textContent = '';
        errorEls[i].style.display = 'none';
    }
    // Hide 3-Card gameover elements
    var finalBankrollEl = document.querySelector('[data-testid="gameover-final-bankroll"]');
    var handsPlayedEl = document.querySelector('[data-testid="gameover-hands-played"]');
    if (finalBankrollEl) finalBankrollEl.style.display = 'none';
    if (handsPlayedEl) handsPlayedEl.style.display = 'none';
    // Re-validate to set button state
    validateConfig();
});

// ============================================================
// 3-Card Poker button handlers
// ============================================================

// Place Bets button
document.querySelector('[data-testid="tc-place-bets-btn"]').addEventListener('click', function() {
    var anteBet = parseInt(document.querySelector('[data-testid="tc-ante-input"]').value, 10);
    var pairPlusBet = parseInt(document.querySelector('[data-testid="tc-pairplus-input"]').value, 10) || 0;
    var sixCardBet = parseInt(document.querySelector('[data-testid="tc-sixcard-input"]').value, 10) || 0;
    var body = { gameId: currentGameId, anteBet: anteBet, pairPlusBet: pairPlusBet, sixCardBet: sixCardBet };
    fetch('/api/3c-bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(function(resp) {
        return resp.json().then(function(data) { return { ok: resp.ok, data: data }; });
    })
    .then(function(result) {
        if (result.ok) {
            currentGameState = result.data;
            render3CGameState(result.data);
            startThreecardPolling(result.data);
        } else {
            console.error('Bet error:', result.data.error);
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    });
});

// Clear Bets button
document.querySelector('[data-testid="tc-clear-bets-btn"]').addEventListener('click', function() {
    document.querySelector('[data-testid="tc-ante-input"]').value = '';
    document.querySelector('[data-testid="tc-pairplus-input"]').value = '0';
    document.querySelector('[data-testid="tc-sixcard-input"]').value = '0';
});

// Play button
document.querySelector('[data-testid="tc-play-btn"]').addEventListener('click', function() {
    fetch('/api/3c-play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: currentGameId, decision: 'play' })
    })
    .then(function(resp) {
        return resp.json().then(function(data) { return { ok: resp.ok, data: data }; });
    })
    .then(function(result) {
        if (result.ok) {
            currentGameState = result.data;
            // Fix 3: Check for game-over before delegating to render3CGameState
            if (result.data.phase === 'game-over') {
                renderGameOver(result.data);
                stopThreecardPolling();
                return;
            }
            render3CGameState(result.data);
            startThreecardPolling(result.data);
        } else {
            console.error('Play error:', result.data.error);
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    });
});

// Fold button
document.querySelector('[data-testid="tc-fold-btn"]').addEventListener('click', function() {
    fetch('/api/3c-play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: currentGameId, decision: 'fold' })
    })
    .then(function(resp) {
        return resp.json().then(function(data) { return { ok: resp.ok, data: data }; });
    })
    .then(function(result) {
        if (result.ok) {
            currentGameState = result.data;
            // Fix 2: Check for game-over before delegating to render3CGameState
            if (result.data.phase === 'game-over') {
                renderGameOver(result.data);
                stopThreecardPolling();
                return;
            }
            render3CGameState(result.data);
            startThreecardPolling(result.data);
        } else {
            console.error('Fold error:', result.data.error);
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    });
});

// Next Hand button (3-Card)
document.querySelector('[data-testid="tc-next-hand-btn"]').addEventListener('click', function() {
    fetch('/api/3c-next-hand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: currentGameId })
    })
    .then(function(resp) {
        return resp.json().then(function(data) { return { ok: resp.ok, data: data }; });
    })
    .then(function(result) {
        if (result.ok) {
            currentGameState = result.data;
            render3CGameState(result.data);
            // Do NOT start polling — new phase is "betting" which requires human input
        } else {
            console.error('Next hand error:', result.data.error);
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    });
});

// Cash Out button
document.querySelector('[data-testid="tc-cashout-btn"]').addEventListener('click', function() {
    fetch('/api/3c-cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: currentGameId })
    })
    .then(function(resp) {
        return resp.json().then(function(data) { return { ok: resp.ok, data: data }; });
    })
    .then(function(result) {
        if (result.ok) {
            stopThreecardPolling();
            currentGameState = result.data;
            renderGameOver(result.data);
        } else {
            console.error('Cash out error:', result.data.error);
        }
    })
    .catch(function(err) {
        console.error('Network error:', err);
    });
});

// ============================================================
// Let It Ride button handlers
// ============================================================

// Place Bets button
document.querySelector('[data-testid="lir-place-bets-btn"]').addEventListener('click', function() {
    var input = document.querySelector('[data-testid="lir-base-bet-input"]');
    var checkbox = document.querySelector('[data-testid="lir-bonus-checkbox"]');
    var baseBet = parseInt(input.value);
    var bonusBet = checkbox.checked;

    fetch('/api/lir-bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: lirState.gameId, baseBet: baseBet, bonusBet: bonusBet })
    })
    .then(function(res) {
        return res.json().then(function(data) { return { ok: res.ok, data: data }; });
    })
    .then(function(result) {
        if (!result.ok) {
            showError(result.data.error);
            return;
        }
        renderLIRGameState(result.data);
        var humanPlayer = null;
        for (var i = 0; i < result.data.players.length; i++) {
            if (result.data.players[i].seatIndex === 0) { humanPlayer = result.data.players[i]; break; }
        }
        var bankrollEl = document.querySelector('[data-testid="lir-human-bankroll"]');
        if (bankrollEl && humanPlayer) {
            bankrollEl.textContent = 'Bankroll: ' + humanPlayer.bankroll;
        }
    })
    .catch(function() {
        showError('Network error.');
    });
});

// Withdraw button
document.querySelector('[data-testid="lir-withdraw-btn"]').addEventListener('click', function() {
    var betNumber = lirState.phase === 'first-decision' ? 1 : 2;
    fetch('/api/lir-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: lirState.gameId, betNumber: betNumber, decision: 'withdraw' })
    })
    .then(function(res) {
        return res.json().then(function(data) { return { ok: res.ok, data: data }; });
    })
    .then(function(result) {
        if (!result.ok) { showError(result.data.error); return; }
        renderLIRGameState(result.data);
    })
    .catch(function() {
        showError('Network error.');
    });
});

// Let It Ride button
document.querySelector('[data-testid="lir-ride-btn"]').addEventListener('click', function() {
    var betNumber = lirState.phase === 'first-decision' ? 1 : 2;
    fetch('/api/lir-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: lirState.gameId, betNumber: betNumber, decision: 'ride' })
    })
    .then(function(res) {
        return res.json().then(function(data) { return { ok: res.ok, data: data }; });
    })
    .then(function(result) {
        if (!result.ok) { showError(result.data.error); return; }
        renderLIRGameState(result.data);
    })
    .catch(function() {
        showError('Network error.');
    });
});

// Next Hand button (LIR)
document.querySelector('[data-testid="lir-next-hand-btn"]').addEventListener('click', function() {
    fetch('/api/lir-next-hand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: lirState.gameId })
    })
    .then(function(res) {
        return res.json().then(function(data) { return { ok: res.ok, data: data }; });
    })
    .then(function(result) {
        if (!result.ok) { showError(result.data.error); return; }
        renderLIRGameState(result.data);
    })
    .catch(function() {
        showError('Network error.');
    });
});

// Cash Out handler (shared by both cash-out buttons)
function handleLIRCashout() {
    fetch('/api/lir-cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: lirState.gameId })
    })
    .then(function(res) {
        return res.json().then(function(data) { return { ok: res.ok, data: data }; });
    })
    .then(function(result) {
        if (!result.ok) { showError(result.data.error); return; }
        renderLIRGameState(result.data);
    })
    .catch(function() {
        showError('Network error.');
    });
}

document.querySelector('[data-testid="lir-cashout-btn"]').addEventListener('click', handleLIRCashout);
document.querySelector('[data-testid="lir-cashout-btn-result"]').addEventListener('click', handleLIRCashout);

// ============================================================
// Initial page load
// ============================================================
// Validate config on load to set initial button state
// (defaults are all valid, so button should be enabled)
validateConfig();
