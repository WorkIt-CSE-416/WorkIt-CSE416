// Any posting on a job system WorkIt fills (KAN-369), not only WorkIt's own
// feed: a posting the API has never heard of fills from the panel as a feed
// job does; a job system's form embedded in an employer's careers page fills
// in its frame. The fake API lists no job at all. Nothing is ever submitted.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
// How Anduril heard of the student: a guess, a row the fill always shows.
const HEARD = "question_13130335007";
// An employer's careers page that embeds the job system's form in an iframe.
const EMBEDDING = "https://careers.anduril-example.test/open-roles/apply?gh_jid=4567";
let loaded: Loaded;
test.afterEach(() => loaded?.close());

const html = (body: string) => ({ headers: { "content-type": "text/html" }, body });
const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");

async function start(handlers: Handler[], grantHosts: string[] = []): Promise<{ forms: SavedForms; api: FakeApi }> {
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi(); // no queue, no saved job: WorkIt's feed doesn't have the posting
  loaded = await loadExtension([api.handler, webapp, forms.handler, ...handlers], { grantHosts });
  await signIn(loaded.context);
  return { forms, api };
}

test("a posting not in WorkIt's feed, on its job system's own site, shows the panel and fills", async () => {
  test.setTimeout(120_000);
  const { forms, api } = await start([]);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await expect(hostOf(page).getByRole("button", { name: "Show WorkIt panel" })).toBeVisible({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click();
  await hostOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  await expect(hostOf(page).locator(`[data-key="${HEARD}"] .source`)).toHaveText("Guessed", { timeout: 60_000 });
  await expect(page.locator("#first_name")).not.toHaveValue("");
  // No application or saved job was needed, nor made.
  expect(api.stages.size).toBe(0);
  expect(forms.submissions).toEqual([]);
});

test("an employer's careers page embedding the job system's form: the panel shows in the form and fills it", async () => {
  test.setTimeout(120_000);
  let formUrl = "";
  const employer: Handler = ({ url }) =>
    url.hostname === new URL(EMBEDDING).hostname
      ? html(`<!doctype html><title>Careers</title><h1>Software Engineer</h1><iframe src="${formUrl}" style="width:100%;height:3000px;border:0"></iframe>`)
      : undefined;
  const { forms } = await start([employer]);
  formUrl = forms.url(ANDURIL);
  const page = await loaded.context.newPage();
  await page.goto(EMBEDDING);
  const form = page.frameLocator("iframe");
  const edge = form.locator("#workit-autofiller-overlay-host").getByRole("button", { name: "Show WorkIt panel" });
  await expect(edge).toBeVisible({ timeout: 20_000 });
  await edge.click();
  await form.locator("#workit-autofiller-overlay-host").getByRole("button", { name: "Autofill This Page" }).click();
  await expect(form.locator(`#workit-autofiller-overlay-host [data-key="${HEARD}"] .source`)).toHaveText("Guessed", { timeout: 60_000 });
  await expect(form.locator("#first_name")).not.toHaveValue("");
  // The employer's own page got nothing drawn: the extension can't see in there.
  await expect(hostOf(page)).toHaveCount(0);
  expect(forms.submissions).toEqual([]);
});
