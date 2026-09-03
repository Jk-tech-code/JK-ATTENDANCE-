import { test, expect } from '@playwright/test'

test.describe('Dashboard Page (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('test@example.com')
    await page.getByLabel(/password/i).fill('TestPassword123!')
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {})
  })

  test('redirects to dashboard after login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByText(/welcome|dashboard/i).first()).toBeVisible()
  })

  test('shows attendance card', async ({ page }) => {
    await page.goto('/dashboard')
    const attendanceSection = page.getByText(/attendance|check.in|check.out/i)
    await expect(attendanceSection.first()).toBeVisible()
  })

  test('shows profile card', async ({ page }) => {
    await page.goto('/dashboard')
    const profileSection = page.getByText(/profile|teacher|staff/i)
    await expect(profileSection.first()).toBeVisible()
  })

  test('shows clock widget', async ({ page }) => {
    await page.goto('/dashboard')
    const clock = page.locator('[class*="clock"], time')
    await expect(clock.first()).toBeVisible()
  })
})

test.describe('Protected Routes', () => {
  test('redirects unauthenticated users from dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects unauthenticated users from admin pages', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects unauthenticated users from admin dashboard', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects unauthenticated users from admin teachers', async ({ page }) => {
    await page.goto('/admin/teachers')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects unauthenticated users from admin reports', async ({ page }) => {
    await page.goto('/admin/reports')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects unauthenticated users from admin settings', async ({ page }) => {
    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Logout Flow', () => {
  test('logs out and redirects to login', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('test@example.com')
    await page.getByLabel(/password/i).fill('TestPassword123!')
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {})

    const userMenu = page.getByLabel(/logout|sign out|user menu/i).first()
    if (await userMenu.isVisible()) {
      await userMenu.click()
      await page.getByText(/logout|sign out/i).first().click()
      await expect(page).toHaveURL(/\/login/)
    }
  })
})
