import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "https://vault-scout-app.vercel.app/scout/",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        storageState: ".auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
