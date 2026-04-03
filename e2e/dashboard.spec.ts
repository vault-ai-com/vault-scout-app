import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("shows dashboard heading and stats", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toContainText("Dashboard");
    // Stats section labels
    await expect(page.locator(".section-tag:has-text('Scouting')")).toBeVisible();
  });

  test("quick actions navigate correctly", async ({ page }) => {
    await page.goto("/");

    // Click "Sök spelare" quick action link
    await page.locator("main a:has-text('Sök spelare')").click();
    await expect(page.locator("h1")).toContainText("Sök och analysera");
  });

  test("sidebar nav works", async ({ page, viewport }) => {
    // Only test sidebar on desktop viewport
    if (viewport && viewport.width < 768) return;

    await page.goto("/");

    // Navigate to players via sidebar
    await page.click('nav[aria-label="Huvudnavigation"] >> text=Spelare');
    await expect(page.locator("h1")).toContainText("Sök och analysera");

    // Navigate to Bosse AI
    await page.click('nav[aria-label="Huvudnavigation"] >> text=Bosse AI');
    await expect(page.locator("text=Bosse Andersson")).toBeVisible();

    // Navigate back to dashboard
    await page.click('nav[aria-label="Huvudnavigation"] >> text=Dashboard');
    await expect(page.locator("h1")).toContainText("Dashboard");
  });
});
