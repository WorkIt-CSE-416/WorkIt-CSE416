import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  // A CI runner is slower than a laptop, and a few timing-bound specs now and
  // then miss; a spec that is broken fails all three tries.
  retries: process.env.CI ? 2 : 0,
  projects: [
    {
      // The fill in a saved form's page, minus Chrome (extension.ts).
      name: "page",
      testMatch: "*.spec.ts",
      testIgnore: "*.extension.spec.ts",
      use: {
        headless: true,
        // The installed Chrome, which updates itself, with its sandbox on: Playwright's own Chromium lags its fixes (KAN-552).
        channel: "chrome",
        // The fill engine's fake job server uploads to a local server, which Chromium blocks a public page from reaching unless told not to.
        launchOptions: { chromiumSandbox: true, args: ["--disable-features=LocalNetworkAccessChecks"] },
        serviceWorkers: "block",
      },
    },
    {
      // The unpacked extension loaded into Chromium (loaded-extension.ts), which launches its own browser:
      // its service worker must run, so none of the page project's options apply.
      name: "extension",
      testMatch: "*.extension.spec.ts",
    },
  ],
});
