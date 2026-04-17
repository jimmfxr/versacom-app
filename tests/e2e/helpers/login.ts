import type { Page } from '@playwright/test'

/** Drive the real login form so we exercise the same auth path users do. */
export async function loginViaUI(
  page: Page,
  firstName: string,
  lastName: string,
  pin: string,
) {
  await page.goto('/login')
  await page.getByLabel('First name').fill(firstName)
  await page.getByLabel('Last name').fill(lastName)
  await page.getByLabel(/PIN/i).fill(pin)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
    page.getByRole('button', { name: /sign in|log in|continue/i }).click(),
  ])
}
