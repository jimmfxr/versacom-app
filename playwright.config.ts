import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

// Load .env.test.local first (test-only overrides), then fall back to .env.local
dotenv.config({ path: '.env.test.local' })
dotenv.config({ path: '.env.local' })

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // tests share a DB; serialise to keep them simple
  forbidOnly: isCI,
  retries: 0,
  workers: 1,
  reporter: isCI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: {
      // Tests run against TEST_DATABASE_URL — surfaced as DATABASE_URL inside
      // the spawned dev server so Prisma picks it up.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      DATABASE_URL_UNPOOLED:
        process.env.TEST_DATABASE_URL_UNPOOLED ?? process.env.TEST_DATABASE_URL ?? '',
    },
  },
})
