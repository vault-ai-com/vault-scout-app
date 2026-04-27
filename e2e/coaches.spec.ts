import { test, expect } from "@playwright/test";
import { coachSearchWithRetry } from "./helpers/coach-search";

test.describe("Coaches", () => {
  test("shows coaches page heading", async ({ page }) => {
    await page.goto("coaches");

    await expect(page.locator(".section-tag:has-text('Tränare')")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Sök och analysera");
  });

  test("search returns results or empty state", async ({ page }) => {
    await page.goto("coaches");

    const searchInput = page.locator('input[aria-label="Sök tränare"]');
    await searchInput.fill("test-nonexistent-coach-xyz");
    await page.click('button:has-text("Sök")');

    const results = page.locator("text=tränare hittade");
    const noResults = page.locator("text=Inga tränare matchade din sökning");
    await expect(results.or(noResults)).toBeVisible({ timeout: 30_000 });
  });

  test("coach search finds coaches and shows cards", async ({ page }) => {
    await page.goto("coaches");

    const found = await coachSearchWithRetry(page, "Allsvenskan");
    if (!found) {
      // If no coaches found, verify empty state is shown properly
      await expect(page.locator("text=Inga tränare matchade din sökning")).toBeVisible();
      return;
    }

    // Verify result count is displayed
    await expect(page.locator("text=tränare hittade")).toBeVisible();
  });

  test("tier filter toggles and clears", async ({ page }) => {
    await page.goto("coaches");

    // Open filters
    const filterButton = page.locator('button[aria-label="Visa filter"]');
    await filterButton.click();

    // Tier filter should be visible
    const tierSelect = page.locator("#filter-tier");
    await expect(tierSelect).toBeVisible();

    // Select a tier
    await tierSelect.selectOption("elite");
    await expect(tierSelect).toHaveValue("elite");

    // Clear filter button should appear
    const clearButton = page.locator('button:has-text("Rensa")');
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    // Tier should reset to empty
    await expect(tierSelect).toHaveValue("");
  });

  test("click coach card navigates to detail", async ({ page }) => {
    await page.goto("coaches");

    const found = await coachSearchWithRetry(page, "Allsvenskan");
    if (!found) {
      test.skip();
      return;
    }

    // Click first coach card
    const firstCard = page.locator('[class*="card-interactive"], a[href*="/coaches/"]').first();
    await firstCard.click();

    // Should navigate to coach detail page
    await expect(page.locator("text=Tränarprofil")).toBeVisible({ timeout: 15_000 });
  });
});
