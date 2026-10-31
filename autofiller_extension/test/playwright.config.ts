import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  projects: [
    {
      // The fill in a saved form's page, minus Chrome (extension.ts).
      name: "page",
      testMatch: "*.spec.ts",
      testIgnore: "*.extension.spec.ts",
      use: {
        headless: true,
        serviceWorkers: "block",
        // The fill engine's fake job server uploads to a local server, which Chromium blocks a public page from reaching unless told not to.
        launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
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
