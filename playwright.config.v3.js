const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: 'ui-tests-v3.spec.js',
  timeout: 90000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  reporter: [['list'], ['json', { outputFile: 'reports/v3/pw-results-v3.json' }]],
  workers: 1,
});
