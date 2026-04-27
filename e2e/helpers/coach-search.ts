import { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Search coaches with retry — pg_trgm fuzzy search can be intermittent on cold starts */
export async function coachSearchWithRetry(page: Page, query: string, maxRetries = 2): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const searchInput = page.locator('input[aria-label="Sök tränare"]');
    await searchInput.fill(query);
    await page.click('button:has-text("Sök")');

    const results = page.locator("text=tränare hittade");
    const noResults = page.locator("text=Inga tränare matchade din sökning");
    await expect(results.or(noResults)).toBeVisible({ timeout: 30_000 });

    if (await results.isVisible()) return true;

    if (attempt < maxRetries) {
      console.warn(`[coachSearchWithRetry] "${query}" returned 0 results, retrying (${attempt + 1}/${maxRetries})`);
      await page.goto("coaches");
      await page.waitForTimeout(1500);
    }
  }
  console.warn(`[coachSearchWithRetry] "${query}" failed after ${maxRetries + 1} attempts`);
  return false;
}
