import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: false, env: { PORT: '3100', DATA_DIR: path.resolve('test-results/boards') } },
});
