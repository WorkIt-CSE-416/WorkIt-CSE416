// The manifest lets the background fetch every job system the engine covers (CLAUDE.md, the runner's
// "Opening needs no permission; filling needs the host"): without the host, its job API fetch fails.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { jobOf } from "../src/background/engine.js";

const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));

/** Whether a Chrome match pattern ("https://*.lever.co/*") covers `url`'s host. */
function allows(pattern: string, url: string): boolean {
  const [, scheme, host] = /^(\w+):\/\/([^/]+)\//.exec(pattern)!;
  const target = new URL(url);
  if (`${scheme}:` !== target.protocol) return false;
  return host.startsWith("*.") ? target.hostname === host.slice(2) || target.hostname.endsWith(host.slice(1)) : target.hostname === host;
}

for (const url of [
  "https://job-boards.greenhouse.io/cloudflare/jobs/8245197",
  "https://jobs.lever.co/hermeus/78008094-ca81-4a0c-9a18-93b30f932acd/apply",
  "https://jobs.ashbyhq.com/notion/3fba1c39-c5cb-47d7-9ad2-1cec4d7e9d0c/application",
  "https://ats.rippling.com/rippling/jobs/f64b6158-9534-4bab-9457-45556166b262",
  "https://apply.workable.com/scout-clean-energy/j/7BF0CEDF9F/apply",
  "https://lockheedmartin.eightfold.ai/careers/apply?pid=996477106402",
  // Netflix's Eightfold is on its own domain (live, 2026-10-24: the job's names and text failed to fetch).
  "https://explore.jobs.netflix.net/careers/apply?pid=790318904468",
  "https://careers.withwaymo.com/jobs/2027-summer-intern-bs-depot-automation?gh_jid=8234553",
  "https://nvidia.wd5.myworkdayjobs.com/en-US/University/job/NVIDIA-2027-Internships_JR2023495-1",
  "https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/c45a68e0-2aa1-405f-8b08-1e60b5ae778b",
]) {
  test(`the manifest lets the extension reach ${new URL(url).hostname}`, () => {
    expect(jobOf(url), url).not.toBeNull();
    expect(manifest.host_permissions.some((p: string) => allows(p, url)), url).toBe(true);
  });
}

// SmartRecruiters' names and text come from its public Posting API, on a host of its own.
test("the manifest lets the background read SmartRecruiters' Posting API", () => {
  expect(manifest.host_permissions.some((p: string) => allows(p, "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/1"))).toBe(true);
});

// A permission added in a later release disables the extension until the student accepts it, so batch
// apply's tab groups ask for theirs in the release that brings batch apply (KAN-370).
test("the manifest asks for tab groups", () => {
  expect(manifest.permissions).toContain("tabGroups");
});
