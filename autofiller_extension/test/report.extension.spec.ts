// Report a problem (KAN-403) and fix reports (KAN-369): a field that failed
// read-back offers Report this, which opens a preview of exactly what WorkIt
// would send (the page's parts, every field's structure and what the fill did
// with it, the timeline, the form's HTML with every value out) with that
// field marked wrong, and an optional note. Only Send sends it, once per
// press; no value of the student's is ever in it. A field the student edits
// after WorkIt filled it offers Report this too, and any filled row Wrong?.
// Arc's saved Greenhouse form, with a script that turns the name typed into
// "Pat" and marks it with the site's own words.
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

// The shipped engine as its own build names it (fill-engine build.mjs): the version a report must carry.
const ENGINE = execFileSync("node", ["build.mjs", "--version"], { cwd: path.join(__dirname, "..", "fill-engine") }).toString().trim();

// Every personal value the fixture profile holds, and what the page turned the name into.
const PERSONAL = [
  ...STUDENT.full_name.split(" "), STUDENT.email, STUDENT.phone_number, STUDENT.phone_number.replace(/\D/g, ""), "test-person", "Pat", "resume.pdf",
];

async function filledArc() {
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
  // Its card and Report this show on the opened row only (KAN-424).
  await host.locator('[data-key="first_name"] .label').click();
  await expect(host.locator('[data-key="first_name"] .row-card')).toBeVisible();
  return { api, forms, form, host };
}

test("Report this on a field that failed read-back previews exactly what is sent, with no personal value, and sends it only on Send", async () => {
  test.setTimeout(120_000);
  const { api, forms, form, host } = await filledArc();

  await host.locator('[data-key="first_name"] [data-report-trigger="readback"]').click();
  const card = host.locator('[data-slot="report"]');
  const sent = card.locator(".report-sent");
  await expect(sent.locator('[data-part="job_system"]')).toHaveText("greenhouse");
  await expect(sent.locator('[data-part="posting_url"]')).toHaveText(ARC_LINK);
  await expect(sent.locator('[data-part="engine_version"]')).toHaveText(ENGINE);
  await expect(sent.locator(".report-field")).toHaveText(["text · first name · Readback"]);
  // The field the row was for is marked wrong already.
  await expect(card.locator('.report-mark input[data-name="first_name"]')).toBeChecked();
  await expect(card.locator('.report-mark input[data-name="email"]')).not.toBeChecked();
  // The page's layout goes along unless the student unticks it (KAN-456).
  await expect(card.getByLabel("Include the page's layout (no answers)")).toBeChecked();
  // Opening the preview sends nothing.
  await form.waitForTimeout(500);
  expect(api.reports).toEqual([]);

  await card.getByLabel("Note (optional)").fill("The name box changed what WorkIt typed.");
  await card.locator(".report-all summary").click();
  const preview = await card.locator(".report-json").textContent();
  const shown = await card.textContent();
  for (const value of PERSONAL) expect(shown, value).not.toContain(value);
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card).toContainText("Sent. Thanks for telling WorkIt.");

  expect(api.reports).toHaveLength(1);
  const report = api.reports[0] as any;
  // What is sent is what the preview showed.
  expect(report).toEqual(JSON.parse(preview!));
  expect(report).toMatchObject({ job_system: "greenhouse", posting_url: ARC_LINK, engine_version: ENGINE, trigger: "readback", note: "The name box changed what WorkIt typed." });
  expect(report.context).toMatchObject({ recognition: { site: "greenhouse", on_form: true }, page_url: ARC_LINK, frame: "top" });
  const name = report.fields.find((f: any) => f.name === "first_name");
  expect(name).toMatchObject({
    kind: "text", label: "First Name", label_shape: "first name", required: true, selector: "#first_name", visible: true,
    planned: `text:${STUDENT.full_name.split(" ")[0].length}`, status: "failed", readback: "differs", error: "Readback", marked: true,
  });
  expect(report.fields.filter((f: any) => f.marked).map((f: any) => f.name)).toEqual(["first_name"]);
  expect(report.timeline.map((s: any) => s.kind)).toEqual(expect.arrayContaining(["plan", "fill", "field"]));
  // The form's HTML: its structure and labels, no value.
  expect(report.html).toContain('id="first_name"');
  expect(report.html).toContain("First Name");
  expect(report.html).not.toMatch(/<input[^>]*id="first_name"[^>]*value=/);
  const body = JSON.stringify(api.reports);
  for (const value of PERSONAL) expect(body, value).not.toContain(value);
  // A second report needs its own press.
  await expect(card.getByRole("button", { name: "Send report" })).toHaveCount(0);
  expect(api.reports).toHaveLength(1);
  expect(forms.submissions).toEqual([]);
});

test("Unticked, the page's layout is left out of the preview and the report; a 429 says the day's limit in plain words", async () => {
  test.setTimeout(120_000);
  const { api, host } = await filledArc();
  await host.locator('[data-key="first_name"] [data-report-trigger="readback"]').click();
  const card = host.locator('[data-slot="report"]');
  await card.getByLabel("Include the page's layout (no answers)").uncheck();
  await card.locator(".report-all summary").click();
  await expect(card.locator(".report-all summary")).not.toContainText("KB");
  const preview = JSON.parse((await card.locator(".report-json").textContent())!);
  expect(preview).not.toHaveProperty("html");
  expect(preview.fields.length).toBeGreaterThan(0);

  api.refuseReports = { status: 429, detail: "You've sent a lot of reports today. Try again tomorrow." };
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card.locator(".report-said")).toHaveText("You've sent a lot of reports today. Try again tomorrow.");
  expect(api.reports).toEqual([]);

  api.refuseReports = null;
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card).toContainText("Sent. Thanks for telling WorkIt.");
  expect(api.reports).toEqual([preview]);
});

test("A field the student edits after WorkIt filled it offers Report this, and a filled row's Wrong? marks it", async () => {
  test.setTimeout(120_000);
  const { api, host, form } = await filledArc();

  // Wrong? shows on a filled row once it is opened, and opens the card with that field marked.
  const email = host.locator('[data-key="email"]');
  await expect(email).toHaveAttribute("data-mark", "filled");
  // Filled rows fold into one line (KAN-424): opened, the row is there to press.
  await host.locator('.group[data-group="filled"] .group-head').click();
  await email.locator(".label").click();
  await email.locator('[data-report-trigger="row"]').click();
  const card = host.locator('[data-slot="report"]');
  await expect(card.locator('.report-mark input[data-name="email"]')).toBeChecked();
  await card.getByRole("button", { name: "Back" }).click();

  // The student types their own last name over WorkIt's.
  await form.locator("#last_name").fill("Quinn");
  // Report this shows on the opened row (KAN-424): the student presses the row of the field they changed.
  await host.locator('[data-key="last_name"] .label').click();
  const edited = host.locator('[data-key="last_name"] [data-report-trigger="edited"]');
  await expect(edited).toBeVisible({ timeout: 10_000 });
  await edited.click();
  await expect(card.locator('.report-mark input[data-name="last_name"]')).toBeChecked();
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card).toContainText("Sent. Thanks for telling WorkIt.");
  const report = api.reports[0] as any;
  expect(report.trigger).toBe("edited");
  expect(report.fields.find((f: any) => f.name === "last_name")).toMatchObject({ edited: true, marked: true, source: "student" });
  // What the student typed is a value too: it never leaves.
  expect(JSON.stringify(report)).not.toContain("Quinn");
});
