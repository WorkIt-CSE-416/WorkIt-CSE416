// Onboarding's practice batch (KAN-378), end to end: the unpacked extension in
// Chromium (loaded-extension.ts) fills WorkIt's two practice forms, served
// from the webapp's own module (frontend/src/lib/practice-form.ts), into the
// Ready and Needs you tab groups; the student's Submit on each opens its
// /thanks page, which the extension counts as submitted, and nothing is sent
// anywhere.
import { expect, test, type Page, type Worker } from "@playwright/test";
import { PRACTICE_JOBS, practiceFormUrl, practicePage } from "../../frontend/src/lib/practice-form";
import { FakeApi } from "./fake-api";
import { STUDENT } from "./extension";
import { loadExtension, sendFromWebapp, signIn, type Handler, type Loaded } from "./loaded-extension";

const WEB = "http://localhost:3000";
const [HARBOR, LUMEN] = PRACTICE_JOBS.map((job) => practiceFormUrl(WEB, job));

/** The webapp: its practice pages as the route handler serves them, and a page for any other path. */
const webapp: Handler = ({ url, method }) => {
  if (url.host !== "localhost:3000") return undefined;
  const html = { "content-type": "text/html; charset=utf-8" };
  const [, company, job, page] = /^\/practice\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname) ?? [];
  if (company) {
    const body = method === "GET" ? practicePage(company, job, page) : null;
    return body ? { headers: html, body } : { status: 404, body: "" };
  }
  return { headers: html, body: "<!doctype html><title>WorkIt</title><p>WorkIt" };
};

type Tab = { id: number; url?: string; group: string | null };

function tabs(worker: Worker): Promise<Tab[]> {
  return worker.evaluate(async () => {
    const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title!]));
    return (await chrome.tabs.query({})).map((t) => ({ id: t.id!, url: t.url, group: groups.get(t.groupId) ?? null }));
  });
}

let loaded: Loaded;
test.afterEach(() => loaded?.close());

async function start(): Promise<{ api: FakeApi; onboarding: Page }> {
  // An empty queue: the practice batch never reads it.
  const api = new FakeApi();
  loaded = await loadExtension([api.handler, webapp]);
  await signIn(loaded.context);
  const onboarding = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await onboarding.goto(`${WEB}/onboarding/applicant`);
  return { api, onboarding };
}

const status = async (onboarding: Page) => (await sendFromWebapp(onboarding, { type: "practice/status" })).jobs;

test("a practice batch fills WorkIt's practice forms, and the student's Submit sends nothing", async () => {
  test.setTimeout(120_000);
  const { api, onboarding } = await start();

  // Onboarding's install step sees the extension.
  expect(await sendFromWebapp(onboarding, { type: "ping" })).toMatchObject({ ok: true, installed: true, signedIn: true });

  expect(await sendFromWebapp(onboarding, { type: "practice/open", urls: [HARBOR, LUMEN] })).toMatchObject({
    ok: true, opened: true, fill: "started",
  });
  const groupOf = async (url: string) => (await tabs(loaded.worker)).find((t) => t.url === url)?.group;
  // Harbor asks only what the profile answers; Lumen asks for a written answer, which a batch leaves to the student.
  await expect.poll(() => groupOf(HARBOR), { timeout: 60_000 }).toBe("Ready");
  await expect.poll(() => groupOf(LUMEN), { timeout: 60_000 }).toBe("Needs you");
  expect(await status(onboarding)).toEqual([
    { jobId: PRACTICE_JOBS[0].id, state: "ready" },
    { jobId: PRACTICE_JOBS[1].id, state: "needs_you" },
  ]);

  const harbor = loaded.context.pages().find((p) => p.url() === HARBOR)!;
  await expect(harbor.locator("[name=name]")).toHaveValue(STUDENT.full_name);
  await expect(harbor.locator("[name=email]")).toHaveValue(STUDENT.email);
  await expect(harbor.locator("[name='urls[LinkedIn]']")).toHaveValue(STUDENT.linkedin_url);
  await expect(harbor.locator(".resume-upload-success")).toHaveText(`Attached: ${STUDENT.resume.filename}`);
  const harborCard = `cards[${PRACTICE_JOBS[0].card.id}]`;
  await expect(harbor.locator(`[name='${harborCard}[field0]'][value=Yes]`)).toBeChecked();
  await expect(harbor.locator(`[name='${harborCard}[field1]'][value=No]`)).toBeChecked();

  // The student writes Lumen's answer: the tab moves to Ready.
  const lumen = loaded.context.pages().find((p) => p.url() === LUMEN)!;
  await lumen.locator(`[name='cards[${PRACTICE_JOBS[1].card.id}][field1]']`).fill("I want to build data pipelines that help clinics call the right patients.");
  await expect.poll(() => groupOf(LUMEN), { timeout: 15_000 }).toBe("Ready");

  // The student presses each form's own Submit.
  const asked = loaded.asked.length;
  await harbor.getByRole("button", { name: "Submit Application" }).click();
  await harbor.waitForURL(HARBOR.replace(/apply$/, "thanks"));
  await lumen.getByRole("button", { name: "Submit Application" }).click();
  await lumen.waitForURL(LUMEN.replace(/apply$/, "thanks"));
  await expect.poll(() => status(onboarding)).toEqual([
    { jobId: PRACTICE_JOBS[0].id, state: "submitted" },
    { jobId: PRACTICE_JOBS[1].id, state: "submitted" },
  ]);
  // A submitted tab leaves its group.
  expect(await groupOf(HARBOR.replace(/apply$/, "thanks"))).toBeNull();

  // Submit sent nothing: the browser asked only for the two /thanks pages, with no data.
  const sent = loaded.asked.slice(asked).filter((url) => !url.startsWith("http://localhost:8000/") && !url.endsWith("/favicon.ico"));
  expect(sent).toEqual([HARBOR.replace(/apply$/, "thanks"), LUMEN.replace(/apply$/, "thanks")]);
  // Nothing ever left WorkIt's own site and API (but Chromium's own calls to Google), and no application stage changed.
  const hosts = new Set(loaded.asked.map((url) => new URL(url).host).filter((host) => !/(^|\.)(google\.com|googleapis\.com)$/.test(host)));
  expect([...hosts].sort()).toEqual(["localhost:3000", "localhost:8000"]);
  expect(api.calls.filter((call) => !call.startsWith("GET "))).toEqual([]);
});

test("a practice batch opens only WorkIt's practice forms on the asking page's own site", async () => {
  const { onboarding } = await start();
  const answer = await sendFromWebapp(onboarding, {
    type: "practice/open",
    urls: ["https://boards.greenhouse.io/acme/jobs/1", `https://workitjobs.ai/practice/harbor-robotics/${PRACTICE_JOBS[0].id}/apply`],
  });
  expect(answer).toEqual({ ok: false, error: "No practice form to open" });
  expect((await tabs(loaded.worker)).map((t) => t.url)).toEqual([`${WEB}/onboarding/applicant`]);
});
