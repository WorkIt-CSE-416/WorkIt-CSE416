// Write with Claude on a batch tab's row that waits for the student's Claude: one click opens a new
// claude.ai chat with the connector prompt's title in its box (claude.ai/new?q=, not sent) and copies
// the same text, for when the prefill doesn't work. Lumen's practice form, queued as a real application,
// asks one written question. The network is faked (loaded-extension.ts), so claude.ai is never reached.
import { expect, test } from "@playwright/test";
import { PRACTICE_JOBS, practiceFormUrl, practicePage } from "../../frontend/src/lib/practice-form";
import { FakeApi } from "./fake-api";
import { loadExtension, sendFromWebapp, signIn, type Handler, type Loaded } from "./loaded-extension";

const WEB = "http://localhost:3000";
const LUMEN = practiceFormUrl(WEB, PRACTICE_JOBS[1]);
const WHY = "Why do you want to intern at Lumen Health?";
const START = "https://claude.ai/new?q=Write%20my%20WorkIt%20answers";

const webapp: Handler = ({ url }) => {
  const html = { "content-type": "text/html; charset=utf-8" };
  if (url.host === "claude.ai") return { headers: html, body: "<!doctype html><title>Claude</title>" };
  if (url.host !== "localhost:3000") return undefined;
  const [, company, job, page] = /^\/practice\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname) ?? [];
  if (company) return { headers: html, body: practicePage(company, job, page) ?? "" };
  return { headers: html, body: "<!doctype html><title>WorkIt</title><p>WorkIt" };
};

let loaded: Loaded;
test.afterEach(() => loaded?.close());

test("Write with Claude opens a new Claude chat with the trigger and copies it", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  // Focused: the clipboard takes text only from a page that has focus, as the student's clicked tab does.
  loaded = await loadExtension([api.handler, webapp], { focused: true });
  await loaded.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: WEB });
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto(`${WEB}/auto-apply`);
  await sendFromWebapp(page, { type: "run/open" });

  await expect.poll(() => loaded.context.pages().find((p) => p.url() === LUMEN), { timeout: 60_000 }).toBeTruthy();
  const form = loaded.context.pages().find((p) => p.url() === LUMEN)!;
  const row = form.locator("#workit-autofiller-overlay-host .row", { hasText: WHY });
  await expect(row).toContainText("Waiting for your Claude", { timeout: 60_000 });
  await expect(row).toContainText("Press Enter in Claude (or paste)");

  await form.bringToFront();
  const [claude] = await Promise.all([loaded.context.waitForEvent("page"), row.getByRole("link", { name: "Write with Claude" }).click()]);
  // The new tab asks claude.ai (the fake network's) for the chat with the trigger in its box.
  await expect.poll(() => loaded.asked).toContain(START);
  expect(claude.url()).toBe(START);
  expect(await form.evaluate(() => navigator.clipboard.readText())).toBe("Write my WorkIt answers");
});
