// KAN-324's live rehearsals (rehearse.live.ts), run by hand only. The main
// config's projects match *.spec.ts, so CI never runs these.
import { defineConfig } from "@playwright/test";

export default defineConfig({ testDir: ".", testMatch: "*.live.ts", timeout: 0, workers: 1, reporter: "line" });
