import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test('loads without errors', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/JK Attendance/)
  })

  test('has hero section with CTA', async ({ page }) => {
    await page.goto('/')
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
  })

  test('has navigation links', async ({ page }) => {
    await page.goto('/')
    const nav = page.locator('nav')
    await expect(nav).toBeVisible()
  })

  test('has login button in header', async ({ page }) => {
    await page.goto('/')
    const loginButton = page.getByRole('link', { name: /sign in|login/i })
    await expect(loginButton.first()).toBeVisible()
  })
})

test.describe('Login Page', () => {
  test('loads without errors', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/JK Attendance/)
  })

  test('has email input', async ({ page }) => {
    await page.goto('/login')
    const emailInput = page.getByLabel(/email/i)
    await expect(emailInput).toBeVisible()
  })

  test('has password input', async ({ page }) => {
    await page.goto('/login')
    const passwordInput = page.getByLabel(/password/i)
    await expect(passwordInput).toBeVisible()
  })

  test('has sign in button', async ({ page }) => {
    await page.goto('/login')
    const signInButton = page.getByRole('button', { name: /sign in|login/i })
    await expect(signInButton).toBeVisible()
  })

  test('has forgot password link', async ({ page }) => {
    await page.goto('/login')
    const forgotLink = page.getByText(/forgot.*password/i)
    await expect(forgotLink).toBeVisible()
  })

  test('has google sign in option', async ({ page }) => {
    await page.goto('/login')
    const googleButton = page.getByText(/google/i)
    await expect(googleButton).toBeVisible()
  })

  test('shows validation errors on empty submit', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await expect(page.getByText(/required|email|password/i).first()).toBeVisible()
  })
})

test.describe('Help Page', () => {
  test('loads without errors', async ({ page }) => {
    await page.goto('/help')
    await expect(page).toHaveTitle(/JK Attendance/)
  })

  test('has contact information', async ({ page }) => {
    await page.goto('/help')
    const content = page.getByText(/contact|support|help/i)
    await expect(content.first()).toBeVisible()
  })
})

test.describe('Not Found Page', () => {
  test('shows 404 page for unknown routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist')
    await expect(page.getByText(/404|not found/i).first()).toBeVisible()
  })

  test('has back to home link', async ({ page }) => {
    await page.goto('/this-page-does-not-exist')
    const homeLink = page.getByRole('link', { name: /home|go back|return/i })
    await expect(homeLink.first()).toBeVisible()
  })
})
