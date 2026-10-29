import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { jobLogo } from "./job-logo.ts";

const UPLOAD = "https://s8-recruiting.cdn.greenhouse.io/logos/acme.png";
const before = process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID;

afterEach(() => {
  process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID = before;
});

test("Brandfetch's icon by the employer's website comes first, the scraper's logo after", () => {
  process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID = "client-id";
  assert.deepEqual(jobLogo({ logo_url: UPLOAD, company_domain: "goldmansachs.com" }), [
    "https://cdn.brandfetch.io/goldmansachs.com/fallback/404/icon?c=client-id",
    UPLOAD,
  ]);
});

test("no website, or an API from before KAN-442, leaves the scraper's logo alone", () => {
  process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID = "client-id";
  assert.deepEqual(jobLogo({ logo_url: UPLOAD, company_domain: null }), [null, UPLOAD]);
  assert.deepEqual(jobLogo({ logo_url: UPLOAD }), [null, UPLOAD]);
});

test("a clone with no client ID never asks Brandfetch", () => {
  delete process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID;
  assert.deepEqual(jobLogo({ logo_url: null, company_domain: "wsp.com" }), [null, null]);
});
