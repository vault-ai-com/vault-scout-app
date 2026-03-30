import { test, expect } from "@playwright/test";

test.describe("Bosse Chat", () => {
  test("shows chat landing page", async ({ page }) => {
    await page.goto("chat");

    await expect(page.locator("h2:has-text('Prata med Bosse')")).toBeVisible();
    await expect(page.locator("text=Bosse Andersson")).toBeVisible();
    await expect(
      page.locator('button:has-text("Starta konversation")'),
    ).toBeVisible();
  });

  test("create new session and send message with SSE response", async ({
    page,
  }) => {
    await page.goto("chat");

    // Start a new conversation
    await page.click('button:has-text("Starta konversation")');

    // Wait for session to be created and input to appear
    const input = page.locator("#bosse-chat-input");
    await expect(input).toBeVisible({ timeout: 15_000 });

    // Send a message
    await input.fill("Vad tycker du om svenska anfallare?");
    await page.click('button[aria-label="Skicka meddelande"]');

    // Wait for SSE streaming response — observe DOM changes
    // The bot response appears in a div with role="log"
    await expect(async () => {
      const botMessages = page.locator('[role="log"] .justify-start');
      const count = await botMessages.count();
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: 120_000 });
  });

  test("sign out works", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Dashboard");

    // Click sign out in sidebar (desktop) — use the sidebar button specifically
    await page.locator('aside button:has-text("Logga ut")').click();

    // Should return to login
    await expect(page.locator("h1")).toContainText("Vault AI Scout", {
      timeout: 15_000,
    });
    await expect(page.locator("#login-email")).toBeVisible();
  });
});
