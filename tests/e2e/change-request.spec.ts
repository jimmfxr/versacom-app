import { test, expect, BrowserContext, Page } from '@playwright/test'
import { seedScenario, cleanupScenario, disconnectDb } from './helpers/db'
import { loginViaUI } from './helpers/login'

/**
 * Full change-request round-trip:
 *   crew submits a key change → admin sees task and approves → crew's
 *   green "submitted" highlight clears automatically + toast appears
 *
 * No manual page refresh on the crew side — this test exists specifically
 * to guard the fingerprint-based auto-sync added in panel-studio.tsx.
 */
test.describe('change request flow', () => {
  let scenario: Awaited<ReturnType<typeof seedScenario>>
  let crewContext: BrowserContext
  let adminContext: BrowserContext
  let crewPage: Page
  let adminPage: Page

  test.beforeAll(async ({ browser }) => {
    const runId = Date.now().toString().slice(-6)
    scenario = await seedScenario(runId)
    crewContext = await browser.newContext()
    adminContext = await browser.newContext()
    crewPage = await crewContext.newPage()
    adminPage = await adminContext.newPage()
  })

  test.afterAll(async () => {
    await crewContext?.close()
    await adminContext?.close()
    if (scenario) await cleanupScenario(scenario)
    await disconnectDb()
  })

  test('crew submits → admin approves → crew auto-syncs + toast', async () => {
    // 1. Crew logs in and opens their panel
    await loginViaUI(crewPage, scenario.crewFirst, scenario.crewLast, scenario.pin)
    await crewPage.goto(`/projects/${scenario.projectId}/panel/${scenario.equipmentId}`)

    // 2. Crew clicks the first empty key, picks an item, and submits
    //    (Keys render as numbered buttons 1…N — index 0 = button "1")
    const firstKey = crewPage.getByRole('button', { name: /^1$/ }).first()
    await firstKey.click()
    await crewPage.getByPlaceholder(/search by name or code/i).fill(scenario.pickItemName)
    await crewPage.getByText(scenario.pickItemName, { exact: true }).first().click()
    await crewPage.getByRole('button', { name: /submit changes/i }).click()

    // 3. Toast confirms submission, key turns green ("submitted" status)
    await expect(crewPage.getByText(/changes submitted for approval/i)).toBeVisible()

    // 4. Admin logs in and lands on Tasks
    await loginViaUI(adminPage, scenario.adminFirst, scenario.adminLast, scenario.pin)
    await adminPage.goto('/admin')

    // 5. The new task should appear within the polling window (5s + buffer)
    const reviewBtn = adminPage.getByRole('button', { name: /review/i })
    await expect(reviewBtn).toBeVisible({ timeout: 15_000 })
    await reviewBtn.click()

    // 6. Admin approves
    await expect(adminPage.getByRole('button', { name: /^approve$/i })).toBeVisible()
    await adminPage.getByRole('button', { name: /^approve$/i }).click()

    // 7. Crew (no manual refresh) should see the green highlight clear and
    //    the approval toast appear via the 5s polling + fingerprint sync
    await expect(crewPage.getByText(/your request has been approved/i)).toBeVisible({
      timeout: 15_000,
    })
  })
})
