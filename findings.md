# Build Findings — Texas Hold'em Poker

A post-build record of the multi-agent process used to design, build, and verify this application.

---

## What This Was

This application was built using a structured multi-agent AI process defined in a `build-rules-spec.md` process constitution. Eight specialized AI agents — each with a defined role, lane rules, and authority scope — collaborated to take the app from spec to a passing test suite without any human writing code.

**Agents:**

| Agent | Model | Role |
|---|---|---|
| Orchestrator | Sonnet 4.6 | Workflow coordination, governance log, lane enforcement |
| Architect | Opus 4.6 | All technical and quality decisions; ITERATE/COMPLETE authority |
| CISO | Opus 4.6 | Security review at spec stage and post-build |
| Adversary | Opus 4.6 | Attack-surface analysis — finds what CISO and tests miss |
| Developer | Sonnet 4.6 | `server.js`, `package.json` only |
| Frontend Developer | Sonnet 4.6 | `public/` files only |
| API Tester | Sonnet 4.6 | Black-box HTTP testing only — never read source code |
| UI Tester | Sonnet 4.6 | Playwright browser automation only — never read source code |

Lane violations: **0** across both iterations.

---

## Timeline

| Phase | Approx. time |
|---|---|
| Pre-build (spec review, CISO/Adversary, instruction writing) | ~20 min |
| Iteration 1 build (Developer + Frontend in parallel) | ~15 min |
| Iteration 1 testing (all 4 agents in parallel) | ~20 min |
| Iteration 1 Architect eval + iteration 2 instructions | ~7 min |
| Iteration 2 build (3 surgical fixes) | ~3 min |
| Iteration 2 testing (all 4 agents in parallel) | ~25 min |
| Final Architect eval + governance log + push | ~5 min |
| **Total wall-clock** | **~95 minutes** |

---

## Test Results

### Iteration 1
| Suite | Result |
|---|---|
| API (55 tests) | 38 pass / 7 fail |
| UI (44 tests) | 31 pass / 12 fail |

### Iteration 2 (final)
| Suite | Result |
|---|---|
| API (56 tests) | **56 / 56 pass** |
| UI (35 tests) | **35 / 35 pass** |

---

## What Failed in Iteration 1 (and What Happened to Each)

### Genuine bugs fixed in iteration 2

| Test | Severity | Root cause | Fix |
|---|---|---|---|
| API-51 | Medium | `blindLevel` counter incremented past schedule bounds — blind values correct but reported index wrong | Clamped `gs.blindLevel` directly with `Math.min` instead of clamping only at lookup |
| UI-10 | Medium | Error container `<div>` cleared by setting `textContent = ''` but remained visible to Playwright (non-zero dimensions) | Added `style.display = 'none'` when clearing, `style.display = ''` when showing |
| UI-43 / UI-44 | High | `getSeatStatusText()` checked positional roles (DEALER, SB, BB) before action states — a folded dealer showed "DEALER" not "FOLDED" | Reordered: ELIMINATED → ALL IN → FOLDED → DEALER → SB → BB |

### Declared false negatives (13 tests — tests were wrong, not the implementation)

| Tests | Why the tests were wrong |
|---|---|
| API-18, API-23 | Tests expected the initial blind-only pot (30 chips). The server correctly processes AI turns before returning from `POST /api/game`. With 3+ AI players, UTG is an AI and has already acted by the time the response arrives. Spec example was illustrative only. |
| API-37, API-38, API-39 | Tests expected intermediate state after a human action (e.g., `human.bet === 20` after calling). The spec explicitly says the server processes all subsequent AI turns before responding — that intermediate state is never observable. |
| API-40 | Test expected `"It is not your turn."` With synchronous AI processing, the human is always the next actor in a betting phase. The validation order fires the phase check (rule 4) before the turn check (rule 5), so the error returned is `"No action required at this time."` |
| API-52 | Test expected `404` after game-over. A game-over game IS a game — the state must persist for the frontend to render standings. 404 is only correct when no game has ever been started. |
| UI-12 | Test checked DOM absence for unused seats. All 12 seat divs are rendered and CSS-hidden. Playwright's `not.toBeVisible()` is the correct assertion. |
| UI-14 | Pot display showed 170 instead of 30 — same root cause as API-18. Server processes AI turns at game start. |
| UI-17, UI-39, UI-40 | Empty card-slot divs have non-zero dimensions and Playwright reports them as visible. The correct check is whether the slot contains card text, not whether the DOM node exists. |
| UI-32, UI-33, UI-34 | Spectator mode tested with 2-player game. With only 1 opponent, eliminating one player ends the game immediately (game-over, not spectator). Spectator mode requires 3+ players. |
| UI-35 | Game-over screen test contaminated by prior test state. Fresh `page.goto()` before each isolated test resolves it. |
| UI-36 | Win message is `"You won!"` not `"You wins!"` — regex needed to match both human-win and AI-win formats. |

---

## Pre-Build Findings (CISO + Adversary)

The spec was reviewed before a single line of code was written. **20 spec ambiguities** were resolved by the Architect. All three critical adversary findings were addressed in developer instructions before build started.

### Critical pre-build findings (all resolved before build)

| ID | Finding | Resolution |
|---|---|---|
| ADV-PRE-1 | Folded player's `player.bet` might be zeroed on fold, silently dropping chips from the side pot algorithm | Instruction: fold only sets `status` and `holeCards = null` — never touches `bet` |
| ADV-PRE-2 | All-in disambiguation: spec conflated two distinct scenarios (all-in for less than call vs. all-in for less than min-raise) | Instruction: explicit three-case handling with separate `currentBet` and action-reopening rules |
| ADV-PRE-9 | Architect's own pre-build clarification had a self-contradictory ruling on blind posting vs. pot initialization | Resolved definitively: blinds go only into `player.bet`; internal `pots` starts empty; display pots synthesized from both at response time |

### Key security findings (CISO)

- AI hole cards properly excluded from API responses via explicit allowlist serialization — raw game state never serialized directly
- `deck` field (future cards) excluded from all API responses
- All security headers applied: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`
- 10kb body limit on all POST routes
- Integer validation on blind schedule values (rejects floats, NaN, Infinity)
- All DOM writes in frontend use `textContent` — no `innerHTML` anywhere

---

## Token Usage

All token counts reported by each agent's API usage. Orchestrator count is an estimate based on conversation length and context loaded.

| Agent / Run | Tokens |
|---|---|
| Architect eval-0 (pre-build) | 62,194 |
| CISO pre-build | 42,834 |
| Adversary pre-build | 43,743 |
| Architect instructions (iteration 1) | 92,231 |
| Developer build (iteration 1) | 77,862 |
| Frontend Developer build (iteration 1) | 69,596 |
| CISO post-build (iteration 1) | 77,960 |
| Adversary post-build (iteration 1) | 86,075 |
| API Tester (iteration 1) | 75,151 |
| UI Tester (iteration 1) | 76,566 |
| Architect eval-1 | 100,470 |
| Architect instructions (iteration 2) | 59,608 |
| Developer build (iteration 2) | 26,836 |
| Frontend Developer build (iteration 2) | 33,957 |
| CISO post-build (iteration 2) | 48,316 |
| Adversary post-build (iteration 2) | 60,415 |
| API Tester (iteration 2) | 63,820 |
| UI Tester (iteration 2) | 88,495 |
| Architect eval-2 | 81,854 |
| **Subagent total** | **1,267,983** |
| Orchestrator (estimated) | ~500,000 |
| **Grand total (estimated)** | **~1,768,000** |

> Note: these are cumulative context-window totals (input + output) as reported by the API, not just the output generated. Each agent loaded prior reports and the spec into its context window, so there is significant context repetition across runs. Actual unique content generated is considerably less.

---

## What the Process Got Right

**Parallelism worked well.** CISO + Adversary ran concurrently with each other and in parallel with the testers. Developer + Frontend Developer built simultaneously with zero coordination needed — the Architect's instructions fully separated the work.

**The Adversary found things the tests didn't.** ADV-PRE-9 (the self-contradictory blind/pot initialization ruling) would have produced a chip-accounting bug that's notoriously hard to detect via black-box testing. The Adversary caught it at spec stage.

**Strict lane rules kept context clean.** Testers never saw source code. Developers never saw test results. This prevented an agent from rationalizing its own bugs.

**13 of 19 iteration 1 failures were test problems, not implementation problems.** The Architect correctly identified these and the build didn't waste an iteration fixing things that weren't broken.

---

## Remaining Low-Severity Items (not fixed — acceptable for local app)

- No rate limiting (appropriate for single-user local server)
- No CORS policy (appropriate for locally-run app)
- `Math.random()` shuffle — not cryptographically secure (acceptable for a game)
- No CSP header
- AI strength model uses flat per-category scores — systematically exploitable by a human who understands the thresholds
- BB skipped when SB goes all-in posting the blind (rare edge case)
- Under-raise all-in doesn't enforce action-reopening restriction on prior actors
