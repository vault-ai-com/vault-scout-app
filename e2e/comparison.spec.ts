import { test, expect } from "@playwright/test";

test.describe("Comparison", () => {
  test("shows empty state without player IDs", async ({ page }) => {
    await page.goto("comparison");

    await expect(page.locator("h1")).toContainText("Jämförelse");
    await expect(page.locator("text=Inga spelare valda")).toBeVisible();
    await expect(page.locator("text=Hitta spelare")).toBeVisible();
  });

  test("empty state links back to players", async ({ page }) => {
    await page.goto("comparison");

    const link = page.locator('a:has-text("Hitta spelare")');
    await expect(link).toBeVisible();
    await link.click();

    // Should navigate to players page
    await expect(page.locator("h1")).toContainText("Sök och analysera");
  });

  test("back link navigates to players", async ({ page }) => {
    await page.goto("comparison");

    const backLink = page.locator('a:has-text("Tillbaka")');
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page.locator("h1")).toContainText("Sök och analysera");
  });

  test("comparison with valid IDs shows player columns", async ({ page }) => {
    // First get some player IDs from the search
    await page.goto("players");

    const searchInput = page.locator('input[aria-label="Sök spelare"]');
    await searchInput.fill("Gyökeres");
    await page.click('button:has-text("Sök")');

    const results = page.locator("text=spelare hittade");
    const noResults = page.locator("text=Inga spelare matchade din sökning");
    await expect(results.or(noResults)).toBeVisible({ timeout: 30_000 });

    if (await noResults.isVisible()) {
      test.skip();
      return;
    }

    // Click first player to get their ID from URL
    const firstPlayer = page.locator('[class*="card-interactive"]').first();
    await firstPlayer.click();
    await expect(page.locator("text=Spelarprofil")).toBeVisible({ timeout: 15_000 });

    const url = page.url();
    const playerIdMatch = url.match(/players\/([a-f0-9-]+)/);
    if (!playerIdMatch) {
      test.skip();
      return;
    }
    const playerId = playerIdMatch[1];

    // Navigate to comparison with this player ID
    await page.goto(`comparison?ids=${playerId}`);

    // Should show comparison heading (not empty state)
    await expect(page.locator("h1")).toContainText("Jämförelse");

    // Should NOT show empty state since we have a valid ID
    const emptyState = page.locator("text=Inga spelare valda");
    await expect(emptyState).not.toBeVisible({ timeout: 5_000 });

    // Should show player name or loading state (skeleton/actual content)
    const playerName = page.locator('h3.text-foreground, [class*="skeleton-shimmer"]').first();
    await expect(playerName).toBeVisible({ timeout: 15_000 });
  });
});
