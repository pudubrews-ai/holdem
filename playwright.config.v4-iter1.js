// Playwright config — V4 Iteration 1
// Port: 3001 (from reports/v4/server-port.md)

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: 'ui-tests-v4-iter1.spec.js',
  timeout: 90000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  reporter: [['list'], ['json', { outputFile: 'reports/v4/pw-results-v4-iter1.json' }]],
  workers: 1,
});
