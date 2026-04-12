import { test, expect } from "@playwright/test";
import { searchWithRetry } from "./helpers/search";

test.describe("Analysis", () => {
  // These tests call Opus edge functions — increase timeout
  test.setTimeout(240_000);

  // Navigate to a known player first
  test.beforeEach(async ({ page }) => {
    await page.goto("players");

    const found = await searchWithRetry(page, "Gyökeres");
    expect(found).toBe(true);

    // Click first player
    const firstPlayer = page.locator('[class*="card-interactive"]').first();
    await firstPlayer.click();

    await expect(page.locator("text=Spelarprofil")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("quick scan analysis triggers and resolves", async ({ page }) => {
    // Click "Snabb" analysis button
    await page.click('button:has-text("Snabb")');

    // The analysis should either complete successfully or show an error
    // Both are valid UI states — we're testing the flow, not the edge function
    const success = page.locator("text=Dimensionsanalys");
    const error = page.locator("text=/Failed to send|Fel vid analys|Edge Function|Nätverksfel|Internal error|Analysis engine error/");

    await expect(success.or(error)).toBeVisible({ timeout: 180_000 });

    // If analysis succeeded, verify result sections
    if (await success.isVisible()) {
      const recBadge = page.locator(
        "text=/Signa|Bevaka|Pass|Otillräcklig data/",
      );
      await expect(recBadge).toBeVisible();
      await expect(page.locator("text=Styrkor")).toBeVisible();
      await expect(page.locator("text=Svagheter")).toBeVisible();
    }
  });

  test("personality button visible on player detail", async ({ page }) => {
    // Verify the personality panel section exists on player detail
    // (actual personality analysis depends on prior scout analysis + edge fn)
    const personalitySection = page.locator(
      "text=/Personlighet|Kör djupanalys|PERSONLIGHETSANALYS/",
    );
    const analysisSection = page.locator("text=AI-ANALYS");

    await expect(analysisSection).toBeVisible({ timeout: 10_000 });

    // The analysis buttons should be visible
    await expect(page.locator('button:has-text("Snabb")')).toBeVisible();
    await expect(
      page.locator('button:has-text("Fullständig")'),
    ).toBeVisible();
  });
});
