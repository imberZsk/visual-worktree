import { defineConfig } from '@playwright/test'

// E2E_TEST_TIMEOUT_MS 存储单个 Electron 用户流程允许的最长执行时间。
const E2E_TEST_TIMEOUT_MS = 60_000
// E2E_EXPECT_TIMEOUT_MS 存储异步界面状态断言允许的最长等待时间。
const E2E_EXPECT_TIMEOUT_MS = 10_000

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: E2E_TEST_TIMEOUT_MS,
  expect: { timeout: E2E_EXPECT_TIMEOUT_MS },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: 'test-results/e2e-artifacts',
})
