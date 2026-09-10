import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 12000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3410',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'webkit-ipad', use: { ...devices['iPad Pro 11 landscape'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'bun e2e/fixture-server.ts',
    url: 'http://localhost:3410',
    reuseExistingServer: false,
    timeout: 90000,
  },
});
