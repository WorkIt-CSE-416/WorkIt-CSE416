// The extension's fill as Chrome runs it, minus Chrome: the engine and the
// content scripts loaded into a page in the order injectFill loads them, the
// content script's messages answered by the background's own handler
// (engine.js's handleFill) through Playwright, and a WorkIt-shaped profile.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { CONTENT_SCRIPT_FILES, ENGINE_FILES } from "../src/shared/content-scripts.js";
import { engineCaller, handleFill, runEngine } from "../src/background/engine.js";
import { CLOSED_ROOT_FILES, openPanel } from "./loaded-extension";

const EXTENSION = join(__dirname, "..");

/** A WorkIt applicant as background/api.js's fetchAutofillProfile returns one. Dummy data only. */
export const STUDENT = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "test.person@example.com",
  full_name: "Test Person",
  phone_number: "+1 555 010 0199",
  headline: null,
  linkedin_url: "https://www.linkedin.com/in/test-person",
  portfolio_url: null,
  github_url: "https://github.com/test-person",
  other_url: null,
  bank: {
    entries: [
      {
        id: "e1", section: "education", title: "Example State University", organization: null, location: null,
        start_month: "2024-08", end_month: "2028-05", end_kind: "expected", degree: "B.S.", field_of_study: "Computer Science",
        gpa: 3.7, gpa_scale: 4, coursework: [], honors: null, link: null, issuer: null, award_date: null, bullets: [],
      },
    ],
    skills: [],
  },
  answers: {
    work_authorized_us: "yes", needs_sponsorship: "no", work_authorization_status: "us_citizen", security_clearance: "none",
    gender: "declined", hispanic_latino: "no", race: "asian", veteran_status: "not_protected_veteran", disability_status: "declined",
  },
  resume: { filename: "resume.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64") },
  fetched_at: 0,
};

export type Row = { key: string; label: string; required: boolean; status: string; reason?: string; shows?: string | string[]; source?: string };
type Fetch = (url: string, init?: { method: string; body: string }) => Promise<string>;

/** Answers the page's chrome.runtime.sendMessage with the background's fill handler, for every page `page` shows. */
export async function bridge(page: Page, fetchText: Fetch, profile = STUDENT): Promise<void> {
  const trees: Record<string, unknown> = {};
  await page.exposeFunction("__workitSend", async (message: any) => {
    try {
      const call = engineCaller((request) => page.evaluate(runEngine, request));
      const answer = await handleFill(message, {
        url: page.url(), profile, today: "2026-10-22", call, fetchText,
        trees: { load: async () => trees, save: async (saved: Record<string, unknown>) => void Object.assign(trees, saved) },
      });
      return { ok: true, ...answer };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
}

/** Loads the engine and the content scripts into the page, as injectFill does: the fill starts. */
export async function inject(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    // No background sends this page a message (a batch tab listens for some).
    w.chrome = { ...(w.chrome ?? {}), runtime: { sendMessage: (message: unknown) => w.__workitSend(message), onMessage: { addListener() {} } } };
  });
  // Evaluated, not added as script tags, so a page's CSP can't block them (Chrome's injection isn't blocked either).
  // The panel's and marks' roots open, so the tests' locators reach them (loaded-extension.ts's openPanel).
  for (const file of [...ENGINE_FILES, ...CONTENT_SCRIPT_FILES]) {
    const source = readFileSync(join(EXTENSION, file), "utf8");
    await page.evaluate(`${CLOSED_ROOT_FILES.includes(file) ? openPanel(source, file) : source}\n;undefined`);
  }
}

/** Waits for the fill to reach a phase other than "filling" (see content-script.js), and returns it with the overlay's rows. */
export async function settled(page: Page, timeout = 120_000): Promise<{ phase: string; rows: Row[] }> {
  await page.waitForFunction(() => (window as any).WIA?.phase && (window as any).WIA.phase !== "filling", null, { timeout, polling: 200 });
  return page.evaluate(() => ({ phase: (window as any).WIA.phase, rows: (window as any).WIA.status.summary().fields }));
}

/** Each filled row's shown value, by key. */
export function shown(rows: Row[]): Record<string, unknown> {
  return Object.fromEntries(rows.filter((r) => r.status === "filled").map((r) => [r.key, r.shows]));
}

const MISSING = "WorkIt has no answer for this. Answer it yourself.";

/** The planned answers the engine failed to fill, with its reasons, by label (not the questions WorkIt has no answer for). */
export function failed(rows: Row[]): Record<string, string | undefined> {
  return Object.fromEntries(rows.filter((r) => r.status === "failed" && r.reason !== MISSING).map((r) => [r.label, r.reason]));
}

/** The labels of the questions left to the student because WorkIt has no answer for them. */
export function missing(rows: Row[]): string[] {
  return rows.filter((r) => r.reason === MISSING).map((r) => r.label);
}
