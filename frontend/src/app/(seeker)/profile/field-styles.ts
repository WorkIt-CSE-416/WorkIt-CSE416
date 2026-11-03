/**
 * The look My Profile's and Application Info's cards share (Contact & Links,
 * the question cards, Application Answers), in one place so they cannot drift.
 *
 * Each card is a white `Card` on the grey ground (KAN-550), drawn with
 * `padding="none"` and SECTION_CARD: 20px of padding, 24px where the page is
 * wide, and room above it for a jump to its `section-<id>` address. They were
 * open sections split by hairlines until then, which on the grey ground read
 * as a long form with nothing to hold it.
 *
 * Each field is drawn as a job posting's section heading is
 * (jobs/[jobId]/description.tsx, Heading): 16px bold ink beside a 20px brand
 * glyph, its value or control hanging under the heading's text (VALUE_INDENT).
 * Two columns where the card is wide, one on a phone.
 */
export const SECTION_CARD = "scroll-mt-6 p-5 @xl/main:p-6";
export const FIELD_HEADING = "text-subtitle text-ink flex items-center gap-2 font-bold";
export const FIELD_GRID = "mt-5 grid gap-x-10 gap-y-6 @xl/main:grid-cols-2";
/** Lines a value up under its heading's text, past the 20px glyph and gap. */
export const VALUE_INDENT = "pl-7";
