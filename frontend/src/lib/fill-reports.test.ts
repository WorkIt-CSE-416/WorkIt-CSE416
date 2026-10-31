import assert from "node:assert/strict";
import { test } from "node:test";

import { groupsQuery, isReportId, reportsQuery, statusOf } from "./fill-reports.ts";

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

test("the list and the groups filter by engine version, and the list by a group's signature (KAN-478)", () => {
  assert.equal(
    reportsQuery({ engine_version: "0.3.2+fcaaf20", signature: "greenhouse:text:Readback" }),
    "?engine_version=0.3.2%2Bfcaaf20&signature=greenhouse%3Atext%3AReadback&limit=50&offset=0",
  );
  assert.equal(
    reportsQuery({ engine_version: "0.3.2 OR 1=1", signature: "../x" }),
    "?limit=50&offset=0",
  );
  assert.equal(reportsQuery({ signature: "lever::" }), "?signature=lever%3A%3A&limit=50&offset=0");
  assert.equal(
    groupsQuery({
      status: "new",
      job_system: "workday",
      engine_version: "0.3.2",
      page: "3",
      signature: "x:y:z",
    }),
    "?job_system=workday&status=new&engine_version=0.3.2",
  );
  assert.equal(groupsQuery({}), "");
});
