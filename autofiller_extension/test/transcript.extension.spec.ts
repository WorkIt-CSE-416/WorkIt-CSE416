// The student's transcript (KAN-369), end to end: the unpacked extension in
// Chromium (loaded-extension.ts) fetches it from the API with the profile and
// attaches it to a form's transcript upload, as it attaches the resume. The
// form is WorkIt's first practice form (frontend/src/lib/practice-form.ts)
// with an "Unofficial Transcript" upload added, as Verkada's form asks.
import { expect, test } from "@playwright/test";
import { PRACTICE_JOBS, practiceFormUrl, practicePage } from "../../frontend/src/lib/practice-form";
import { FakeApi } from "./fake-api";
import { STUDENT } from "./extension";
import { loadExtension, sendFromWebapp, signIn, type Handler, type Loaded } from "./loaded-extension";

const WEB = "http://localhost:3000";
const [HARBOR] = PRACTICE_JOBS;
const FORM = practiceFormUrl(WEB, HARBOR);
const TRANSCRIPT = { filename: "Unofficial_Transcript.pdf", base64: Buffer.from("%PDF-1.4\n% made-up transcript\n%%EOF\n").toString("base64") };

/** The practice form with a transcript upload after the resume, as a Lever form lays one out. */
const webapp: Handler = ({ url }) => {
  if (url.host !== "localhost:3000") return undefined;
  const html = { "content-type": "text/html; charset=utf-8" };
  if (url.pathname !== new URL(FORM).pathname) return { headers: html, body: "<!doctype html><title>WorkIt</title><p>WorkIt" };
  const upload =
    '<li class="application-question"><label><div class="application-label">Unofficial Transcript<span class="required">✱</span></div>' +
    '<div class="application-field"><input type="file" name="transcript" accept=".pdf" required></div></label></li>';
  const page = practicePage(HARBOR.company, HARBOR.id, "apply")!.replace("</ul>\n<h4>Links</h4>", `${upload}\n</ul>\n<h4>Links</h4>`);
  return { headers: html, body: page };
};

let loaded: Loaded;
test.afterEach(() => loaded?.close());

test("a form's transcript upload gets the student's transcript", async () => {
  test.setTimeout(90_000);
  const api = new FakeApi();
  api.transcript = TRANSCRIPT;
  loaded = await loadExtension([api.handler, webapp]);
  await signIn(loaded.context);
  const onboarding = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await onboarding.goto(`${WEB}/onboarding/applicant`);

  expect(await sendFromWebapp(onboarding, { type: "practice/open", urls: [FORM] })).toMatchObject({ ok: true, opened: true });
  await expect.poll(() => loaded.context.pages().some((p) => p.url() === FORM), { timeout: 30_000 }).toBe(true);
  const form = loaded.context.pages().find((p) => p.url() === FORM)!;

  await expect(form.locator(".resume-upload-success")).toHaveText(`Attached: ${STUDENT.resume.filename}`, { timeout: 60_000 });
  const attached = () => form.locator("[name=transcript]").evaluate((el: HTMLInputElement) => el.files?.[0]?.name ?? null);
  await expect.poll(attached, { timeout: 30_000 }).toBe(TRANSCRIPT.filename);
  const bytes = await form.locator("[name=transcript]").evaluate(async (el: HTMLInputElement) => {
    const buffer = await el.files![0].arrayBuffer();
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  });
  expect(bytes).toBe(TRANSCRIPT.base64);
  expect(api.calls).toContain(`GET /applicants/${STUDENT.id}/documents/transcript/bytes`);
});
