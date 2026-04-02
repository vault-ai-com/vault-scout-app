import { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Search with retry — pg_trgm fuzzy search can be intermittent on cold starts */
export async function searchWithRetry(page: Page, query: string, maxRetries = 2): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const searchInput = page.locator('input[aria-label="Sök spelare"]');
    await searchInput.fill(query);
    await page.click('button:has-text("Sök")');

    const results = page.locator("text=spelare hittade");
    const noResults = page.locator("text=Inga spelare matchade din sökning");
    await expect(results.or(noResults)).toBeVisible({ timeout: 30_000 });

    if (await results.isVisible()) return true;

    if (attempt < maxRetries) {
      console.warn(`[searchWithRetry] "${query}" returned 0 results, retrying (${attempt + 1}/${maxRetries})`);
      await searchInput.clear();
      await page.waitForTimeout(1000);
    }
  }
  console.warn(`[searchWithRetry] "${query}" failed after ${maxRetries + 1} attempts`);
  return false;
}
