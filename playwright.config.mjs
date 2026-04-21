import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  reporter: [['list']],
  webServer: {
    command: 'npx --yes serve -p 5173 -L .',
    url: 'http://localhost:5173/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://localhost:5173/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ipad',
      testMatch: /(ipad|game-end)\.spec\.mjs$/,
      // iPad Mini portrait on WebKit only. We don't test this suite on Chromium
      // because the coin-flip rendering was specifically tuned for WebKit.
      use: { ...devices['iPad Mini'], browserName: 'webkit' },
    },
    {
      name: 'flip-order',
      testMatch: /flip-order\.spec\.mjs$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
