import { test, expect } from "@playwright/test";

test.describe("Players", () => {
  test("shows search page with empty state", async ({ page }) => {
    await page.goto("players");

    await expect(page.locator("h1")).toContainText("Sök och analysera");
    await expect(page.locator('input[aria-label="Sök spelare"]')).toBeVisible();
    await expect(page.locator("text=Sök efter spelare")).toBeVisible();
  });

  test("search for player returns results", async ({ page }) => {
    await page.goto("players");

    const searchInput = page.locator('input[aria-label="Sök spelare"]');
    await searchInput.fill("Gyökeres");
    await page.click('button:has-text("Sök")');

    // Wait for results
    await expect(page.locator("text=spelare hittade")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("click player navigates to detail", async ({ page }) => {
    await page.goto("players");

    const searchInput = page.locator('input[aria-label="Sök spelare"]');
    await searchInput.fill("Gyökeres");
    await page.click('button:has-text("Sök")');

    // Wait for results and click first player card
    await expect(page.locator("text=spelare hittade")).toBeVisible({
      timeout: 30_000,
    });

    // PlayerCard is a link — click the first one
    const firstPlayer = page.locator('[class*="card-interactive"]').first();
    await firstPlayer.click();

    // Should show player detail with breadcrumb
    await expect(page.locator("text=Spelarprofil")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("text=Tillbaka")).toBeVisible();
  });

  test("empty search shows no results message", async ({ page }) => {
    await page.goto("players");

    const searchInput = page.locator('input[aria-label="Sök spelare"]');
    await searchInput.fill("xyznonexistent12345");
    await page.click('button:has-text("Sök")');

    await expect(
      page.locator("text=Inga spelare matchade din sökning"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
