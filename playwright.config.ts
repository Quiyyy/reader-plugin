import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4178', viewport: { width: 1280, height: 900 }, launchOptions: { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) }, trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/start-test-server.mjs', url: 'http://127.0.0.1:4178/health', reuseExistingServer: false, timeout: 15000 },
});
