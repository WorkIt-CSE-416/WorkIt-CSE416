/**
 * The look My Profile's open sections share (Contact & Links, Application
 * Questions), in one place so the two cannot drift.
 *
 * Each field is drawn as a job posting's section heading is
 * (jobs/[jobId]/description.tsx, Heading): 16px bold ink beside a 20px brand
 * glyph, its value or control hanging under the heading's text (VALUE_INDENT).
 * Two columns where the page is wide, one on a phone.
 */
export const FIELD_HEADING = "text-subtitle text-ink flex items-center gap-2 font-bold";
export const FIELD_GRID = "mt-5 grid gap-x-10 gap-y-6 @xl/main:grid-cols-2";
/** Lines a value up under its heading's text, past the 20px glyph and gap. */
export const VALUE_INDENT = "pl-7";
