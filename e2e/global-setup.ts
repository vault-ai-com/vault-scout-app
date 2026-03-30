import { test as setup, expect } from "@playwright/test";

setup("authenticate", async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL!;
  const password = process.env.TEST_USER_PASSWORD!;

  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Vault AI Scout");

  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click('button[type="submit"]');

  // Wait for dashboard heading to appear (authenticated state)
  await expect(page.locator("h1:has-text('Dashboard')")).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: ".auth/user.json" });
});
