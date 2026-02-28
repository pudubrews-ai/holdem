// Playwright config — V4 Iteration 3
// UI tests for poker V4 (Hold'em, 5-Card Draw, 3-Card Poker, Let It Ride)
// Server: http://localhost:3001

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: 'ui-tests-v4-iter3.spec.js',
  timeout: 60000,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15000,
    navigationTimeout: 30000,
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
