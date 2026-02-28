// UI Tester B — Iteration 2 — Groups 4, 5, 6, 8 (UI tests only)
// Mississippi Stud — Tests: 4.9, 4.10, 4.11, 5.6, 6.7, 6.8, 8.12
// Groups 7, 9: no UI tests

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;
const TIMEOUT = 15000;
const results = [];

function record(id, status, notes) {
  results.push({ id, status, notes });
  const mark = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`[${mark}] ${id}${notes ? ' — ' + notes : ''}`);
}

function apiFetch(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: PORT,
      path,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitFor(fn, timeout, interval) {
  timeout = timeout || TIMEOUT;
  interval = interval || 200;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fn();
      if (r !== false && r !== null && r !== undefined) return r;
    } catch (e) { /* keep waiting */ }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('waitFor timed out after ' + timeout + 'ms');
}

async function waitForEnabled(locator) {
  return waitFor(async () => {
    const enabled = await locator.isEnabled();
    return enabled ? true : false;
  });
}

async function bringToIdle() {
  // Ensure server state is idle
  const state = await apiFetch('/api/mississippi/state');
  if (!state.body.sessionActive) return;
  const phase = state.body.phase;
  if (phase === 'idle') return;
  if (phase === 'third_street') {
    await apiFetch('/api/mississippi/third-street', 'POST', { action: 'fold' });
  } else if (phase === 'fourth_street') {
    await apiFetch('/api/mississippi/fourth-street', 'POST', { action: 'fold' });
  } else if (phase === 'fifth_street') {
    await apiFetch('/api/mississippi/fifth-street', 'POST', { action: 'raise', multiplier: 1 });
  }
  // Wait for idle
  await waitFor(async () => {
    const s = await apiFetch('/api/mississippi/state');
    return s.body.phase === 'idle';
  });
}

async function ensureSession() {
  const state = await apiFetch('/api/mississippi/state');
  if (!state.body.sessionActive) {
    await apiFetch('/api/mississippi/new-session', 'POST', {});
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.sessionActive;
    });
  }
}

async function setupFreshHand(page, ante, bonus) {
  // Ensure session active and at idle
  await ensureSession();
  await bringToIdle();

  // Navigate to page to reset UI state
  await page.goto(`${BASE_URL}/mississippi.html`);
  await page.waitForLoadState('networkidle');

  // Fill ante
  const anteInput = page.locator('[data-testid="input-ante"]');
  await anteInput.fill(String(ante || 10));
  await anteInput.dispatchEvent('input');

  // Fill bonus
  const bonusInput = page.locator('[data-testid="input-bonus"]');
  await bonusInput.fill(String(bonus || 0));
  await bonusInput.dispatchEvent('input');

  // Click deal — wait for it to be enabled first
  const dealBtn = page.locator('[data-testid="btn-deal"]');
  await waitForEnabled(dealBtn);
  await dealBtn.click();

  // Wait for third_street phase
  await waitFor(async () => {
    const s = await apiFetch('/api/mississippi/state');
    return s.body.phase === 'third_street';
  });

  // Wait for hole cards to appear in UI
  await waitFor(async () => {
    const c0 = await page.locator('[data-testid="card-hole-0"]').textContent();
    return c0 && c0 !== '?';
  });
}

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // =============================================
  // TEST 4.9 — Raise 1x button triggers 3rd Street raise (UI)
  // =============================================
  console.log('\n--- TEST 4.9 ---');
  try {
    await setupFreshHand(page, 10, 0);

    const phaseText = await page.locator('[data-testid="display-phase"]').textContent();
    console.log('  Phase text before action:', phaseText);

    const raise1xEnabled = await page.locator('[data-testid="btn-raise-1x"]').isEnabled();
    console.log('  btn-raise-1x enabled:', raise1xEnabled);

    await page.locator('[data-testid="btn-raise-1x"]').click();

    // Wait for fourth_street
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'fourth_street';
    });

    // Check display-bet-third shows raise amount
    const betThird = await waitFor(async () => {
      const txt = await page.locator('[data-testid="display-bet-third"]').textContent();
      return txt && txt !== '$0' && txt !== '0' ? txt : false;
    });
    console.log('  display-bet-third:', betThird);

    const phaseAfter = await page.locator('[data-testid="display-phase"]').textContent();
    console.log('  Phase after raise:', phaseAfter);

    // community-0 should still be placeholder before making 4th street decision
    const community0 = await page.locator('[data-testid="card-community-0"]').textContent();
    console.log('  card-community-0 (before 4th street decision):', community0);

    const betThirdOk = betThird && betThird !== '$0' && betThird !== '0';
    const phaseOk = phaseAfter && (
      phaseAfter.toLowerCase().includes('fourth') ||
      phaseAfter.toLowerCase().includes('4th') ||
      phaseAfter.toLowerCase().includes('4 ')
    );
    const communityPlaceholder = !community0 || community0 === '?' || community0.trim() === '?';

    if (betThirdOk && phaseOk && communityPlaceholder) {
      record('4.9', 'PASS', `display-bet-third="${betThird}", phase="${phaseAfter}", community-0="${community0}" (placeholder before 4th decision)`);
    } else {
      const issues = [];
      if (!betThirdOk) issues.push(`display-bet-third shows "${betThird}" (expected non-zero amount)`);
      if (!phaseOk) issues.push(`display-phase shows "${phaseAfter}" (expected 4th Street indicator)`);
      if (!communityPlaceholder) issues.push(`card-community-0 shows "${community0}" (expected "?" placeholder)`);
      record('4.9', 'FAIL', issues.join('; '));
    }
  } catch (e) {
    record('4.9', 'FAIL', 'Exception: ' + e.message);
    console.error(e);
  }

  // =============================================
  // TEST 4.10 — Raise 3x button triggers 3rd Street raise (UI)
  // =============================================
  console.log('\n--- TEST 4.10 ---');
  try {
    await setupFreshHand(page, 10, 0);

    const phaseCheck = await apiFetch('/api/mississippi/state');
    console.log('  Current phase:', phaseCheck.body.phase);

    const raise3xEnabled = await page.locator('[data-testid="btn-raise-3x"]').isEnabled();
    console.log('  btn-raise-3x enabled:', raise3xEnabled);

    await page.locator('[data-testid="btn-raise-3x"]').click();

    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'fourth_street';
    });

    const betThird = await waitFor(async () => {
      const txt = await page.locator('[data-testid="display-bet-third"]').textContent();
      return txt && txt !== '$0' && txt !== '0' ? txt : false;
    });
    console.log('  display-bet-third:', betThird);

    const betThirdNum = parseInt((betThird || '').replace(/[^0-9]/g, ''), 10);
    console.log('  Parsed bet-third value:', betThirdNum);

    if (betThirdNum === 30) {
      record('4.10', 'PASS', `display-bet-third="${betThird}" (3x ante = 30)`);
    } else {
      record('4.10', 'FAIL', `Expected display-bet-third=30 (3x ante), got "${betThird}" (parsed: ${betThirdNum})`);
    }
  } catch (e) {
    record('4.10', 'FAIL', 'Exception: ' + e.message);
    console.error(e);
  }

  // =============================================
  // TEST 4.11 — Fold button triggers fold and shows result (UI)
  // =============================================
  console.log('\n--- TEST 4.11 ---');
  try {
    await setupFreshHand(page, 10, 0);

    const phaseCheck = await apiFetch('/api/mississippi/state');
    console.log('  Current phase:', phaseCheck.body.phase);

    const foldEnabled = await page.locator('[data-testid="btn-fold"]').isEnabled();
    console.log('  btn-fold enabled:', foldEnabled);

    await page.locator('[data-testid="btn-fold"]').click();

    // After fold, phase returns to idle
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'idle';
    });

    // display-result should show fold/loss message
    const resultText = await waitFor(async () => {
      const txt = await page.locator('[data-testid="display-result"]').textContent();
      return txt && txt.trim() !== '' ? txt : false;
    });
    console.log('  display-result:', resultText);

    const raise1xDisabled = await page.locator('[data-testid="btn-raise-1x"]').isDisabled();
    const raise3xDisabled = await page.locator('[data-testid="btn-raise-3x"]').isDisabled();
    const foldDisabled = await page.locator('[data-testid="btn-fold"]').isDisabled();
    const dealEnabled = await page.locator('[data-testid="btn-deal"]').isEnabled();
    console.log('  raise-1x disabled:', raise1xDisabled, '| raise-3x disabled:', raise3xDisabled, '| fold disabled:', foldDisabled, '| deal enabled:', dealEnabled);

    const resultOk = resultText && resultText.trim() !== '';
    const buttonsDisabled = raise1xDisabled && raise3xDisabled && foldDisabled;

    if (resultOk && buttonsDisabled && dealEnabled) {
      record('4.11', 'PASS', `display-result="${resultText}", action buttons disabled, deal enabled`);
    } else {
      const issues = [];
      if (!resultOk) issues.push(`display-result is empty (got "${resultText}")`);
      if (!buttonsDisabled) issues.push(`Action buttons not all disabled (raise-1x:${raise1xDisabled}, raise-3x:${raise3xDisabled}, fold:${foldDisabled})`);
      if (!dealEnabled) issues.push(`btn-deal is not enabled after fold`);
      record('4.11', 'FAIL', issues.join('; '));
    }
  } catch (e) {
    record('4.11', 'FAIL', 'Exception: ' + e.message);
    console.error(e);
  }

  // =============================================
  // TEST 5.6 — Community card shown in UI at 4th Street decision (UI)
  // =============================================
  console.log('\n--- TEST 5.6 ---');
  try {
    // Setup fresh hand at third_street
    await setupFreshHand(page, 10, 0);

    // Raise 1x at 3rd street to reach fourth_street
    await page.locator('[data-testid="btn-raise-1x"]').click();
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'fourth_street';
    });

    // Now at fourth_street — raise 1x (reveals community card 0, advances to fifth_street)
    const raise1x4 = page.locator('[data-testid="btn-raise-1x"]');
    await waitForEnabled(raise1x4);
    await raise1x4.click();

    // Wait for fifth_street
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'fifth_street';
    });

    // Check community card 0 shows a real card (not placeholder)
    const community0 = await waitFor(async () => {
      const txt = await page.locator('[data-testid="card-community-0"]').textContent();
      return txt && txt !== '?' ? txt : false;
    });
    console.log('  card-community-0 after 4th street raise:', community0);

    // Check community card 1 still shows placeholder (not revealed until 5th street raise)
    const community1 = await page.locator('[data-testid="card-community-1"]').textContent();
    console.log('  card-community-1 (should be placeholder):', community1);

    const community0Ok = community0 && community0 !== '?';
    const community1Placeholder = !community1 || community1 === '?' || community1.trim() === '?';

    if (community0Ok && community1Placeholder) {
      record('5.6', 'PASS', `card-community-0="${community0}" (revealed), card-community-1="${community1}" (still placeholder at 5th street)`);
    } else {
      const issues = [];
      if (!community0Ok) issues.push(`card-community-0="${community0}" (expected revealed card, not "?")`);
      if (!community1Placeholder) issues.push(`card-community-1="${community1}" (expected placeholder "?" before 5th street decision)`);
      record('5.6', 'FAIL', issues.join('; '));
    }
  } catch (e) {
    record('5.6', 'FAIL', 'Exception: ' + e.message);
    console.error(e);
  }

  // =============================================
  // TEST 6.7 — Both community cards shown in UI at showdown (UI)
  // =============================================
  console.log('\n--- TEST 6.7 ---');
  try {
    // We should be at fifth_street from 5.6
    const stateCheck = await apiFetch('/api/mississippi/state');
    console.log('  Phase going into 6.7:', stateCheck.body.phase);

    if (stateCheck.body.phase !== 'fifth_street') {
      // Set up a fresh path to fifth_street
      await setupFreshHand(page, 10, 0);
      await page.locator('[data-testid="btn-raise-1x"]').click();
      await waitFor(async () => {
        const s = await apiFetch('/api/mississippi/state');
        return s.body.phase === 'fourth_street';
      });
      const r4 = page.locator('[data-testid="btn-raise-1x"]');
      await waitForEnabled(r4);
      await r4.click();
      await waitFor(async () => {
        const s = await apiFetch('/api/mississippi/state');
        return s.body.phase === 'fifth_street';
      });
    }

    // Raise 1x at 5th street to reach showdown
    const raise1x5 = page.locator('[data-testid="btn-raise-1x"]');
    await waitForEnabled(raise1x5);
    await raise1x5.click();

    // Wait for idle (showdown complete)
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'idle';
    });

    // Check both community cards revealed
    const community0 = await waitFor(async () => {
      const txt = await page.locator('[data-testid="card-community-0"]').textContent();
      return txt && txt !== '?' ? txt : false;
    });
    console.log('  card-community-0:', community0);

    const community1 = await waitFor(async () => {
      const txt = await page.locator('[data-testid="card-community-1"]').textContent();
      return txt && txt !== '?' ? txt : false;
    });
    console.log('  card-community-1:', community1);

    const handName = await page.locator('[data-testid="display-hand-name"]').textContent();
    console.log('  display-hand-name:', handName);

    const resultText = await page.locator('[data-testid="display-result"]').textContent();
    console.log('  display-result:', resultText);

    const raise1xDisabled = await page.locator('[data-testid="btn-raise-1x"]').isDisabled();
    const raise3xDisabled = await page.locator('[data-testid="btn-raise-3x"]').isDisabled();
    const foldDisabled = await page.locator('[data-testid="btn-fold"]').isDisabled();
    const dealEnabled = await page.locator('[data-testid="btn-deal"]').isEnabled();
    console.log('  Buttons: raise-1x disabled:', raise1xDisabled, '| raise-3x disabled:', raise3xDisabled, '| fold disabled:', foldDisabled, '| deal enabled:', dealEnabled);

    const community0Ok = community0 && community0 !== '?';
    const community1Ok = community1 && community1 !== '?';
    const handNameOk = handName && handName.trim() !== '';
    const resultOk = resultText && resultText.trim() !== '';
    const buttonsOk = raise1xDisabled && raise3xDisabled && foldDisabled && dealEnabled;

    if (community0Ok && community1Ok && handNameOk && resultOk && buttonsOk) {
      record('6.7', 'PASS', `community-0="${community0}", community-1="${community1}", hand="${handName}", result="${resultText}"`);
    } else {
      const issues = [];
      if (!community0Ok) issues.push(`card-community-0="${community0}" (not revealed)`);
      if (!community1Ok) issues.push(`card-community-1="${community1}" (not revealed)`);
      if (!handNameOk) issues.push(`display-hand-name="${handName}" (empty)`);
      if (!resultOk) issues.push(`display-result="${resultText}" (empty)`);
      if (!buttonsOk) issues.push(`Button state: raise-1x disabled=${raise1xDisabled}, raise-3x disabled=${raise3xDisabled}, fold disabled=${foldDisabled}, deal enabled=${dealEnabled}`);
      record('6.7', 'FAIL', issues.join('; '));
    }
  } catch (e) {
    record('6.7', 'FAIL', 'Exception: ' + e.message);
    console.error(e);
  }

  // =============================================
  // TEST 6.8 — AI hole cards revealed in UI at showdown
  // May need multiple attempts if Loose AI folds early
  // =============================================
  console.log('\n--- TEST 6.8 ---');
  try {
    // We should be at idle after 6.7 showdown — UI still shows showdown state.
    // Card elements are <span class="ms-card"> inside #ai-cards-{n} divs.
    // Do NOT call setupFreshHand here (which navigates away and resets UI).
    // Instead, check current page state first, then run another hand without nav if needed.

    async function playHandToShowdown() {
      // Bring server to idle without page nav
      await bringToIdle();
      // Place ante via API (so we don't need to re-navigate)
      await apiFetch('/api/mississippi/ante', 'POST', { ante: 10 });
      await waitFor(async () => {
        const s = await apiFetch('/api/mississippi/state');
        return s.body.phase === 'third_street';
      });
      // Click 3rd street raise button on current page
      const r3 = page.locator('[data-testid="btn-raise-1x"]');
      await waitForEnabled(r3);
      await r3.click();
      await waitFor(async () => {
        const s = await apiFetch('/api/mississippi/state');
        return s.body.phase === 'fourth_street';
      });
      const r4 = page.locator('[data-testid="btn-raise-1x"]');
      await waitForEnabled(r4);
      await r4.click();
      await waitFor(async () => {
        const s = await apiFetch('/api/mississippi/state');
        return s.body.phase === 'fifth_street';
      });
      const r5 = page.locator('[data-testid="btn-raise-1x"]');
      await waitForEnabled(r5);
      await r5.click();
      await waitFor(async () => {
        const s = await apiFetch('/api/mississippi/state');
        return s.body.phase === 'idle';
      });
      // Small pause for UI to update
      await new Promise(r => setTimeout(r, 500));
    }

    async function checkAICards() {
      const seatsWithCards = [];
      const seatsWithoutCards = [];
      const foldedSeats = [];

      for (let seat = 1; seat <= 5; seat++) {
        const isFolded = await page.evaluate((s) => {
          const el = document.querySelector('[data-testid="ai-seat-' + s + '"]');
          return el ? el.classList.contains('folded') : false;
        }, seat);

        // Check innerHTML of #ai-cards-{seat} for ms-card spans
        const innerHTML = await page.evaluate((s) => {
          const el = document.getElementById('ai-cards-' + s);
          return el ? el.innerHTML : '';
        }, seat);

        // Card content is present if there are ms-card spans with rank+suit
        const hasCards = innerHTML && innerHTML.includes('ms-card') && innerHTML.length > 10;
        console.log(`  Seat ${seat}: folded=${isFolded}, innerHTML snippet="${innerHTML.substring(0, 60).trim()}"`);

        if (isFolded) {
          foldedSeats.push(seat);
        } else if (hasCards) {
          seatsWithCards.push(seat);
        } else {
          seatsWithoutCards.push(seat);
        }
      }

      return { seatsWithCards, seatsWithoutCards, foldedSeats };
    }

    let test68Pass = false;
    let test68Notes = '';
    let attemptCount = 0;
    const MAX_ATTEMPTS = 3;

    // First check current showdown display from 6.7
    let checkResult = await checkAICards();
    console.log(`  After 6.7 showdown — with cards: [${checkResult.seatsWithCards}], without: [${checkResult.seatsWithoutCards}], folded: [${checkResult.foldedSeats}]`);

    if (checkResult.seatsWithCards.length > 0) {
      test68Pass = true;
      test68Notes = `AI hole cards revealed for non-folded seats [${checkResult.seatsWithCards}]. Folded: [${checkResult.foldedSeats}].`;
    }

    // If not yet passing, play additional hands
    while (!test68Pass && attemptCount < MAX_ATTEMPTS) {
      attemptCount++;
      console.log(`\n  Attempt ${attemptCount}: playing new hand to showdown...`);
      await playHandToShowdown();
      checkResult = await checkAICards();
      console.log(`  With cards: [${checkResult.seatsWithCards}], without: [${checkResult.seatsWithoutCards}], folded: [${checkResult.foldedSeats}]`);

      if (checkResult.seatsWithCards.length > 0) {
        test68Pass = true;
        test68Notes = `AI hole cards revealed for non-folded seats [${checkResult.seatsWithCards}] on attempt ${attemptCount}. Folded: [${checkResult.foldedSeats}].`;
        if (checkResult.seatsWithoutCards.length > 0) {
          test68Notes += ` Non-folded seats [${checkResult.seatsWithoutCards}] showed no card content — possible UI bug.`;
        }
      } else if (checkResult.foldedSeats.length === 5) {
        test68Notes = `Attempt ${attemptCount}: all 5 AI seats folded, cannot verify card display.`;
      } else {
        test68Notes = `Attempt ${attemptCount}: non-folded seats [${checkResult.seatsWithoutCards}] have no card content.`;
      }
    }

    if (test68Pass) {
      record('6.8', 'PASS', test68Notes);
    } else {
      record('6.8', 'FAIL', test68Notes || 'AI hole cards not visible for non-folded seats after ' + MAX_ATTEMPTS + ' attempts');
    }
  } catch (e) {
    record('6.8', 'FAIL', 'Exception: ' + e.message);
    console.error(e);
  }

  // =============================================
  // TEST 8.12 — Bonus display shown in UI (UI)
  // =============================================
  console.log('\n--- TEST 8.12 ---');
  try {
    // Setup fresh hand WITH bonus bet
    await setupFreshHand(page, 10, 5);

    const stateCheck = await apiFetch('/api/mississippi/state');
    console.log('  Phase after deal with bonus:', stateCheck.body.phase);
    console.log('  Bets.bonus:', stateCheck.body.bets ? stateCheck.body.bets.bonus : 'N/A');

    // Play to showdown: raise 1x at each street
    await page.locator('[data-testid="btn-raise-1x"]').click();
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'fourth_street';
    });

    const r4 = page.locator('[data-testid="btn-raise-1x"]');
    await waitForEnabled(r4);
    await r4.click();
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'fifth_street';
    });

    const r5 = page.locator('[data-testid="btn-raise-1x"]');
    await waitForEnabled(r5);
    await r5.click();
    await waitFor(async () => {
      const s = await apiFetch('/api/mississippi/state');
      return s.body.phase === 'idle';
    });

    // Check display-bonus-result shows bonus outcome
    const bonusResultText = await waitFor(async () => {
      const txt = await page.locator('[data-testid="display-bonus-result"]').textContent();
      return txt && txt.trim() !== '' ? txt : false;
    });
    console.log('  display-bonus-result:', bonusResultText);

    if (bonusResultText && bonusResultText.trim() !== '') {
      record('8.12', 'PASS', `display-bonus-result="${bonusResultText}"`);
    } else {
      record('8.12', 'FAIL', `display-bonus-result is empty or missing after showdown with bonus bet`);
    }
  } catch (e) {
    record('8.12', 'FAIL', 'Exception: ' + e.message);
    console.error(e);
  }

  await browser.close();

  // =============================================
  // Print final results
  // =============================================
  console.log('\n\n=== FINAL RESULTS ===');
  let passed = 0, failed = 0, skipped = 0;
  for (const r of results) {
    if (r.status === 'PASS') passed++;
    else if (r.status === 'SKIP') skipped++;
    else failed++;
    console.log(`[${r.status}] ${r.id} — ${r.notes}`);
  }
  console.log(`\nTotal: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${results.length}`);

  fs.writeFileSync('/tmp/ui-tester-b-iter2-results.json', JSON.stringify(results, null, 2));
  console.log('Results written to /tmp/ui-tester-b-iter2-results.json');
}

runTests().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
