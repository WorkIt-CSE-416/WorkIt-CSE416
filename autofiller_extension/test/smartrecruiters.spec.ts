// SmartRecruiters' one-click form through the content script and the
// background's fill handler (extension.ts), on the Fill engine's stand-in for
// it (fill-engine/test/fixtures/forms/smartrecruiters-bosch: built from other
// autofillers' selectors, since the live form serves a captcha to a headless
// browser). Its first page is filled; when nothing on it needs the student the
// engine presses Next (never Submit) and the screening page is filled in turn.
import { type BrowserContext, expect, test } from "@playwright/test";
import { FakeSmartRecruiters } from "../fill-engine/test/fake-smartrecruiters";
import { STUDENT, bridge, inject, settled, shown } from "./extension";

async function open(context: BrowserContext, profile = STUDENT) {
  const bosch = new FakeSmartRecruiters("smartrecruiters-bosch");
  const page = await bosch.open(context);
  const api = `https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/${bosch.posting.uuid}`;
  await bridge(page, async (url) => {
    if (url === api) return JSON.stringify(bosch.posting);
    throw new Error(`${url} answered 404`);
  }, profile);
  await inject(page);
  return page;
}

const FIRST_PAGE = {
  "resume-upload": "resume.pdf",
  "first-name-input": "Test",
  "last-name-input": "Person",
  "email-input": "test.person@example.com",
  "confirm-email-input": "test.person@example.com",
};

test("a SmartRecruiters first page with a box for the student stays there, filled, and says to press Next", async ({ context }) => {
  const page = await open(context); // the student's policies leave consent boxes to them

  const { rows } = await settled(page);

  expect(shown(rows)).toMatchObject(FIRST_PAGE);
  expect(rows.find((r) => r.key === "privacy-consent")).toMatchObject({ status: "failed" });
  expect(rows.find((r) => r.key === "_step")).toMatchObject({ status: "failed", reason: expect.stringContaining("press Next") });
  expect(page.url()).not.toContain("/screening");
  expect(await page.evaluate(() => (window as any).__submitted ?? 0)).toBe(0);
});

test("fills both pages of a SmartRecruiters form when the first needs nothing from the student, and submits nothing", async ({ context }) => {
  const page = await open(context, { ...STUDENT, location: "Bethlehem, PA", fill: { policies: { tick_consent_when_true: true } } } as typeof STUDENT);

  const { rows } = await settled(page);

  expect(page.url()).toContain("/screening");
  expect(shown(rows)).toMatchObject({
    ...FIRST_PAGE,
    "privacy-consent": ["I agree to the Bosch Group privacy policy"],
    "Are you legally authorized to work in the United States?": "Yes",
  });
  expect(await page.evaluate(() => (window as any).__submitted ?? 0)).toBe(0);
});
