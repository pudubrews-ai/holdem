/**
 * UI Tester A — Groups 1–3 (UI tests only)
 * Mississippi Stud Iteration 1
 * Tests: 1.2, 1.3, 2.5, 3.13
 */

const { chromium } = require('playwright');

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

const results = [];

function pass(id) {
  results.push({ id, status: 'PASS' });
  console.log(`TEST ${id} — PASS`);
}

function fail(id, description, expected, received, severity, pattern) {
  results.push({ id, status: 'FAIL', description, expected, received, severity, pattern });
  console.log(`TEST ${id} — ${description} — FAIL`);
  console.log(`  Expected: ${expected}`);
  console.log(`  Received: ${received}`);
  console.log(`  Severity: ${severity}`);
  if (pattern) console.log(`  Pattern: ${pattern}`);
}

/**
 * Bring the server to phase=idle, no active session.
 * Handles any mid-hand state by folding out, then cashing out.
 */
async function ensureNoSession() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const stateResp = await fetch(`${BASE_URL}/api/mississippi/state`);
      const state = await stateResp.json();

      if (!state.sessionActive) return; // already no session

      const phase = state.phase;
      if (phase === 'third_street') {
        await fetch(`${BASE_URL}/api/mississippi/third-street`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fold' })
        });
      } else if (phase === 'fourth_street') {
        await fetch(`${BASE_URL}/api/mississippi/fourth-street`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fold' })
        });
      } else if (phase === 'fifth_street') {
        await fetch(`${BASE_URL}/api/mississippi/fifth-street`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fold' })
        });
      }

      // After resolving hand (or if idle), cash out
      const stateAfter = await (await fetch(`${BASE_URL}/api/mississippi/state`)).json();
      if (stateAfter.sessionActive && stateAfter.phase === 'idle') {
        await fetch(`${BASE_URL}/api/mississippi/cash-out`, { method: 'POST' });
      }
    } catch (e) {
      // retry
    }
  }
}

/**
 * Ensure session is active and at phase=idle.
 * Starts a new session if needed.
 */
async function ensureIdleSession() {
  await ensureNoSession();
  const resp = await fetch(`${BASE_URL}/api/mississippi/new-session`, { method: 'POST' });
  const data = await resp.json();
  return data;
}

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Reset state before test suite
  await ensureNoSession();

  try {
    // =============================================
    // GROUP 1 — Server Health and Navigation (UI)
    // =============================================
    console.log('\n--- GROUP 1: Server Health and Navigation ---');

    // TEST 1.2 — Mississippi Stud page loads
    {
      const page = await context.newPage();
      try {
        await page.goto(`${BASE_URL}/mississippi.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        const btnNewSession = page.locator('[data-testid="btn-new-session"]');
        await btnNewSession.waitFor({ state: 'visible', timeout: 5000 });
        pass('1.2');
      } catch (e) {
        fail('1.2', 'Mississippi Stud page loads',
          'Page loads, data-testid="btn-new-session" is visible',
          `Error: ${e.message.split('\n')[0]}`,
          'Critical',
          'page.goto + locator.waitFor');
      } finally {
        await page.close();
      }
    }

    // TEST 1.3 — Main menu contains Mississippi Stud link
    {
      const page = await context.newPage();
      try {
        await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        const link = page.locator('a[href*="mississippi"]');
        await link.waitFor({ state: 'visible', timeout: 5000 });
        const href = await link.getAttribute('href');
        if (href && href.includes('mississippi')) {
          pass('1.3');
        } else {
          fail('1.3', 'Main menu contains Mississippi Stud link',
            'Link to /mississippi.html visible on index.html',
            `Link href found: ${href}`,
            'Critical',
            'page.locator(\'a[href*="mississippi"]\').waitFor');
        }
      } catch (e) {
        fail('1.3', 'Main menu contains Mississippi Stud link',
          'Page contains a link to /mississippi.html',
          `Error: ${e.message.split('\n')[0]}`,
          'Critical',
          'page.locator(\'a[href*="mississippi"]\').waitFor');
      } finally {
        await page.close();
      }
    }

    // =============================================
    // GROUP 2 — Session Lifecycle (UI: test 2.5)
    // =============================================
    console.log('\n--- GROUP 2: Session Lifecycle (UI) ---');

    // TEST 2.5 — New session button triggers session start
    // Precondition: no active session → btn-new-session must be enabled
    {
      await ensureNoSession();

      const page = await context.newPage();
      try {
        await page.goto(`${BASE_URL}/mississippi.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });

        const btnNewSession = page.locator('[data-testid="btn-new-session"]');
        await btnNewSession.waitFor({ state: 'visible', timeout: 5000 });

        // Verify button is enabled before clicking
        const isDisabledBefore = await btnNewSession.isDisabled();
        if (isDisabledBefore) {
          fail('2.5', 'New session button triggers session start',
            'btn-new-session enabled when no session active',
            'btn-new-session is disabled before click (session may already be active on page load)',
            'High',
            'locator.isDisabled');
        } else {
          // Click new session button
          await btnNewSession.click();

          // Assert: bankroll shows 1000
          const displayBankroll = page.locator('[data-testid="display-bankroll"]');
          await displayBankroll.waitFor({ state: 'visible', timeout: 8000 });
          const bankrollText = await displayBankroll.textContent();
          const bankrollOk = bankrollText && bankrollText.includes('1000');

          // Assert: session status shows active (any truthy content indicating active)
          const displaySessionStatus = page.locator('[data-testid="display-session-status"]');
          let sessionStatusOk = false;
          try {
            await displaySessionStatus.waitFor({ state: 'visible', timeout: 5000 });
            const sessionStatusText = await displaySessionStatus.textContent();
            // Accept any non-empty content, or content that suggests "active"
            sessionStatusOk = sessionStatusText && sessionStatusText.trim() !== '';
          } catch (e2) {
            // If element not found, that's a failure but not blocking
          }

          // Assert: btn-new-session is disabled after click
          const btnNewSessionDisabled = await btnNewSession.isDisabled();

          // Assert: btn-deal is enabled
          const btnDeal = page.locator('[data-testid="btn-deal"]');
          await btnDeal.waitFor({ state: 'visible', timeout: 5000 });
          const btnDealEnabled = !(await btnDeal.isDisabled());

          const issues = [];
          if (!bankrollOk) issues.push(`Bankroll text: "${bankrollText}" (expected to contain "1000")`);
          if (!sessionStatusOk) issues.push('display-session-status not visible or empty');
          if (!btnNewSessionDisabled) issues.push('btn-new-session is NOT disabled after session start');
          if (!btnDealEnabled) issues.push('btn-deal is disabled (expected enabled)');

          if (issues.length === 0) {
            pass('2.5');
          } else {
            fail('2.5', 'New session button triggers session start',
              'bankroll=1000, session active display, btn-new-session disabled, btn-deal enabled',
              issues.join('; '),
              'High',
              'locator.click + locator.waitFor + locator.isDisabled');
          }
        }
      } catch (e) {
        fail('2.5', 'New session button triggers session start',
          'bankroll=1000, session active display, btn-new-session disabled, btn-deal enabled',
          `Error: ${e.message.split('\n')[0]}`,
          'High',
          'locator.click + locator.waitFor + locator.isDisabled');
      } finally {
        await page.close();
      }
    }

    // =============================================
    // GROUP 3 — Ante and Deal (UI: test 3.13)
    // =============================================
    console.log('\n--- GROUP 3: Ante and Deal (UI) ---');

    // TEST 3.13 — Deal button submits ante
    // Precondition: session active, phase = idle
    {
      await ensureIdleSession();

      const page = await context.newPage();
      try {
        await page.goto(`${BASE_URL}/mississippi.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });

        // Wait for deal button to be enabled (session already active via API)
        const btnDeal = page.locator('[data-testid="btn-deal"]');
        await btnDeal.waitFor({ state: 'visible', timeout: 5000 });

        // Enter ante value of 10 in input-ante
        const inputAnte = page.locator('[data-testid="input-ante"]');
        await inputAnte.waitFor({ state: 'visible', timeout: 5000 });
        await inputAnte.fill('10');

        // Click btn-deal
        await btnDeal.click();

        // Assert: hole cards visible and have content
        const cardHole0 = page.locator('[data-testid="card-hole-0"]');
        const cardHole1 = page.locator('[data-testid="card-hole-1"]');
        const cardHole2 = page.locator('[data-testid="card-hole-2"]');

        await cardHole0.waitFor({ state: 'visible', timeout: 8000 });
        await cardHole1.waitFor({ state: 'visible', timeout: 5000 });
        await cardHole2.waitFor({ state: 'visible', timeout: 5000 });

        const card0Text = (await cardHole0.textContent() || '').trim();
        const card1Text = (await cardHole1.textContent() || '').trim();
        const card2Text = (await cardHole2.textContent() || '').trim();

        const cardsHaveContent = card0Text !== '' && card1Text !== '' && card2Text !== '';

        // Assert: phase shows third street indicator
        // Accept "third", "3rd", "third_street"
        const displayPhase = page.locator('[data-testid="display-phase"]');
        await displayPhase.waitFor({ state: 'visible', timeout: 5000 });
        const phaseText = (await displayPhase.textContent() || '').trim();
        const phaseShowsThirdStreet = phaseText.toLowerCase().includes('third') ||
                                      phaseText.toLowerCase().includes('3rd') ||
                                      phaseText.toLowerCase().includes('third_street');

        // Assert: display-bet-ante shows "10" or "$10"
        const displayBetAnte = page.locator('[data-testid="display-bet-ante"]');
        await displayBetAnte.waitFor({ state: 'visible', timeout: 5000 });
        const betAnteText = (await displayBetAnte.textContent() || '').trim();
        const betAnteOk = betAnteText.includes('10');

        // Assert: action buttons raise-1x, raise-3x, fold are enabled
        const btnRaise1x = page.locator('[data-testid="btn-raise-1x"]');
        const btnRaise3x = page.locator('[data-testid="btn-raise-3x"]');
        const btnFold = page.locator('[data-testid="btn-fold"]');

        await btnRaise1x.waitFor({ state: 'visible', timeout: 5000 });
        await btnRaise3x.waitFor({ state: 'visible', timeout: 5000 });
        await btnFold.waitFor({ state: 'visible', timeout: 5000 });

        const raise1xEnabled = !(await btnRaise1x.isDisabled());
        const raise3xEnabled = !(await btnRaise3x.isDisabled());
        const foldEnabled = !(await btnFold.isDisabled());

        const issues = [];
        if (!cardsHaveContent) {
          issues.push(`Hole cards missing content: ["${card0Text}", "${card1Text}", "${card2Text}"]`);
        }
        if (!phaseShowsThirdStreet) {
          issues.push(`Phase display does not show third street: "${phaseText}"`);
        }
        if (!betAnteOk) {
          issues.push(`Bet-ante display: "${betAnteText}" (expected to contain "10")`);
        }
        if (!raise1xEnabled) issues.push('btn-raise-1x is disabled (expected enabled)');
        if (!raise3xEnabled) issues.push('btn-raise-3x is disabled (expected enabled)');
        if (!foldEnabled) issues.push('btn-fold is disabled (expected enabled)');

        if (issues.length === 0) {
          pass('3.13');
        } else {
          fail('3.13', 'Deal button submits ante',
            'Hole cards shown, third street phase, ante displayed, action buttons enabled',
            issues.join('; '),
            'High',
            'locator.fill + locator.click + locator.waitFor + locator.isDisabled');
        }
      } catch (e) {
        fail('3.13', 'Deal button submits ante',
          'Hole cards shown, third street phase, ante displayed, action buttons enabled',
          `Error: ${e.message.split('\n')[0]}`,
          'High',
          'locator.fill + locator.click + locator.waitFor + locator.isDisabled');
      } finally {
        await page.close();
      }
    }

  } finally {
    await browser.close();
  }

  return results;
}

// Run and output results
runTests().then(results => {
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const total = results.length;

  const critFails = results.filter(r => r.status === 'FAIL' && r.severity === 'Critical').length;
  const highFails = results.filter(r => r.status === 'FAIL' && r.severity === 'High').length;
  const medFails = results.filter(r => r.status === 'FAIL' && r.severity === 'Medium').length;
  const lowFails = results.filter(r => r.status === 'FAIL' && r.severity === 'Low').length;

  console.log('\n=====================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed, 0 skipped out of ${total}`);
  console.log(`Critical: ${critFails} | High: ${highFails} | Medium: ${medFails} | Low: ${lowFails}`);
  console.log('Skipped groups: none');
  console.log('=====================================');

  console.log('\n__RESULTS_JSON__');
  console.log(JSON.stringify(results, null, 2));
}).catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
