import assert from "node:assert/strict";
import { test } from "node:test";

import { isReportId, reportsQuery, statusOf } from "./fill-reports.ts";

test("the admin list's query keeps only a known status, a job system's name and a page", () => {
  assert.equal(
    reportsQuery({ status: "triaged", job_system: "greenhouse", page: "2" }),
    "?job_system=greenhouse&status=triaged&limit=50&offset=50",
  );
  assert.equal(
    reportsQuery({ status: "done", job_system: "green house", page: "x" }),
    "?limit=50&offset=0",
  );
  assert.equal(reportsQuery({ status: ["new", "fixed"] }), "?status=new&limit=50&offset=0");
});

test("a report id is a UUID, and a status one of new, triaged and fixed", () => {
  assert.equal(isReportId("7f3c2a10-0000-4000-8000-000000000001"), true);
  assert.equal(isReportId("../auth/me"), false);
  assert.equal(statusOf("fixed"), "fixed");
  assert.equal(statusOf("closed"), null);
});
