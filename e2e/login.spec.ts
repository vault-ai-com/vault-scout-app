import { test, expect } from "@playwright/test";

// These tests run WITHOUT storageState (fresh browser)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Login", () => {
  test("shows login form", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Vault AI Scout");
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.locator("#login-password")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText("Logga in");
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/");
    await page.fill("#login-email", "wrong@example.com");
    await page.fill("#login-password", "wrongpassword");
    await page.click('button[type="submit"]');

    await expect(page.locator('[role="alert"]')).toContainText(
      "Fel e-post eller lösenord",
      { timeout: 15_000 },
    );
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.goto("/");
    await page.fill("#login-email", process.env.TEST_USER_EMAIL!);
    await page.fill("#login-password", process.env.TEST_USER_PASSWORD!);
    await page.click('button[type="submit"]');

    await expect(page.locator("h1:has-text('Dashboard')")).toBeVisible({ timeout: 30_000 });
  });
});
