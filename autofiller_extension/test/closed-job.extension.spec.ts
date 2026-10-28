// A batch tab that finds its job closed (KAN-369): the job leaves the queue
// marked closed (POST .../finish "closed"), not applied and not failed, its
// tab closes, and the next queued job opens. Both ways a closed job shows:
// Greenhouse sends it to the company's board with ?error=true (a page with a
// search box, so the fill runs there), and Workable's page says it in words
// with no form at all (so the fill never starts).
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const html = (body: string) => ({ headers: { "content-type": "text/html" }, body: `<!doctype html><title>Jobs</title>${body}` });
const GREENHOUSE_CLOSED = "https://job-boards.greenhouse.io/acme/jobs/1";
const WORKABLE_CLOSED = "https://apply.workable.com/acme/j/ABC123/apply/";
const closedJobs: Handler = ({ url }) => {
  if (url.href === GREENHOUSE_CLOSED) return html("<script>location.replace('/acme?error=true')</script>");
  if (url.host === "job-boards.greenhouse.io" && url.pathname === "/acme") {
    return html("<h1>Acme</h1><p>The job you are looking for is no longer open.</p><form><input name=q placeholder='Search jobs'></form>");
  }
  if (url.host === "apply.workable.com") return html("<h1>Acme</h1><p>This job is no longer available.</p>");
  return undefined;
};

test("a closed job leaves the batch marked closed, its tab closes, and the next job opens", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue(
    { id: "job-0", apply_url: GREENHOUSE_CLOSED },
    { id: "job-1", apply_url: WORKABLE_CLOSED },
    { id: "job-2", apply_url: forms.url("greenhouse-arc") },
  );
  loaded = await loadExtension([api.handler, webapp, forms.handler, closedJobs]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });

  await expect.poll(() => Object.fromEntries(api.outcomes), { timeout: 60_000 }).toEqual({ "job-0": "closed", "job-1": "closed" });
  expect(api.stages.get("job-0")).toBe("skipped");
  expect(api.stages.get("job-1")).toBe("skipped");
  // Their tabs are gone; the batch went on to Arc's form, which fills as any other.
  const urls = async () => (await loaded.worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url ?? "")));
  await expect.poll(async () => (await urls()).filter((u) => /acme|workable/.test(u)), { timeout: 15_000 }).toEqual([]);
  await expect.poll(async () => (await urls()).includes(forms.url("greenhouse-arc"))).toBe(true);
  await expect.poll(() => api.stages.get("job-2"), { timeout: 60_000 }).toBe("queued");
  expect(forms.submissions).toEqual([]);
});
