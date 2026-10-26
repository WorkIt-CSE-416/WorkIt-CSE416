// Report a problem (KAN-403): the header's ⚑ opens a preview of exactly what
// WorkIt would send (the job system, the posting's public link, the Fill
// engine's version, and per failed field its kind, label shape and error
// name), with an optional note. Only Send sends it, once per press; no answer
// and no page text is ever in it. Arc's saved Greenhouse form, with a script
// that turns the name typed into "Pat" and marks it with the site's own words.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { STUDENT } from "./extension";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ARC = "greenhouse-arc";
const ARC_LINK = "https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

// The name box turns what is typed into "Pat", and the site says why in its own words.
const REWRITES_FIRST_NAME = `window.addEventListener("input", (e) => {
  if (e.target.id !== "first_name") return;
  e.stopImmediatePropagation();
  e.target.value = "Pat";
  e.target.setAttribute("aria-invalid", "true");
  let error = document.getElementById("first_name-error");
  if (!error) {
    error = document.createElement("p");
    error.id = "first_name-error";
    e.target.after(error);
  }
  error.textContent = "Use the name on your passport.";
}, true);`;

function withScript(forms: SavedForms, script: string): Handler {
  return async (request) => {
    const reply = await forms.handler(request);
    if (!reply || request.method !== "GET" || request.url.href !== forms.url(ARC)) return reply;
    return { ...reply, body: String(reply.body).replace("<head>", `<head><script>${script}</script>`) };
  };
}

// The pinned engine as git names it: the version a report must carry.
const ENGINE = execFileSync("git", ["-C", path.join(__dirname, "..", "fill-engine"), "describe", "--tags"]).toString().trim();

test("Report a problem previews exactly what is sent, sends it only on Send, and never sends an answer or the page's text", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ARC]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  loaded = await loadExtension([api.handler, webapp, withScript(forms, REWRITES_FIRST_NAME)]);
  await signIn(loaded.context);
  const app = await loaded.context.newPage();
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ARC))!;
  const host = form.locator("#workit-autofiller-overlay-host");
  await expect(host.locator('[data-key="first_name"] .row-card')).toBeVisible();

  await host.getByRole("button", { name: "Report a problem" }).click();
  const card = host.locator('[data-slot="report"]');
  const sent = card.locator(".report-sent");
  await expect(sent.locator('[data-part="job_system"]')).toHaveText("greenhouse");
  await expect(sent.locator('[data-part="posting_url"]')).toHaveText(ARC_LINK);
  await expect(sent.locator('[data-part="engine_version"]')).toHaveText(ENGINE);
  await expect(sent.locator(".report-field")).toHaveText(["text · first name · Readback"]);
  // Opening the preview sends nothing.
  await form.waitForTimeout(500);
  expect(api.reports).toEqual([]);

  await card.getByLabel("Note (optional)").fill("The name box changed what WorkIt typed.");
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card).toContainText("Sent. Thanks for telling WorkIt.");

  expect(api.reports).toEqual([
    {
      job_system: "greenhouse",
      posting_url: ARC_LINK,
      engine_version: ENGINE,
      fields: [{ kind: "text", label_shape: "first name", error: "Readback" }],
      note: "The name box changed what WorkIt typed.",
    },
  ]);
  const body = JSON.stringify(api.reports);
  for (const value of [...STUDENT.full_name.split(" "), STUDENT.email, STUDENT.phone_number, "Pat", "passport"]) expect(body).not.toContain(value);
  // A second report needs its own press.
  await expect(card.getByRole("button", { name: "Send report" })).toHaveCount(0);
  expect(api.reports).toHaveLength(1);
  expect(forms.submissions).toEqual([]);
});
