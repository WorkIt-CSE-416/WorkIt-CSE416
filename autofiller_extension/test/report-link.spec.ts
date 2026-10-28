// The posting link a fill report carries (background/report.js): the page's
// address with only the query parts that name the posting (the backend's
// fill-report schema refuses any other), never the student's own ids.
import { expect, test } from "@playwright/test";
import { reportOf } from "../src/background/report.js";

const link = (url: string) => reportOf(url).posting_url;

test("keeps an embedded Greenhouse form's for and token, and a careers page's gh_jid", () => {
  expect(link("https://boards.greenhouse.io/embed/job_app?for=acme&token=5442881008&utm_source=x")).toBe("https://boards.greenhouse.io/embed/job_app?for=acme&token=5442881008");
  expect(link("https://careers.example.com/jobs/?gh_jid=123456&gh_src=abc")).toBe("https://careers.example.com/jobs/?gh_jid=123456");
});

test("keeps each job system's posting id and drops everything else, the fragment too", () => {
  for (const name of ["jobId", "job_id", "jobid", "jobReqId", "career_job_req_id"]) {
    expect(link(`https://jobs.example.com/apply?${name}=R-123.4_5&email=a@b.co&session=s#top`)).toBe(`https://jobs.example.com/apply?${name}=R-123.4_5`);
  }
  expect(link("https://jobs.lever.co/acme/abc-123/apply?lever-source=LinkedIn")).toBe("https://jobs.lever.co/acme/abc-123/apply");
});

test("drops a kept part whose value isn't a plain id, and never keeps a sign-in", () => {
  expect(link("https://boards.greenhouse.io/embed/job_app?for=acme&token=a%20b")).toBe("https://boards.greenhouse.io/embed/job_app?for=acme");
  expect(link(`https://jobs.example.com/apply?jobId=${"1".repeat(101)}`)).toBe("https://jobs.example.com/apply");
  expect(link("https://user:secret@jobs.example.com/apply?jobId=7")).toBe("https://jobs.example.com/apply?jobId=7");
});
