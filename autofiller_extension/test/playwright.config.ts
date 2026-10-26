import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 90_000,
  use: {
    headless: true,
    serviceWorkers: "block",
    // The fill engine's fake job server uploads to a local server, which Chromium blocks a public page from reaching unless told not to.
    launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
  },
});
