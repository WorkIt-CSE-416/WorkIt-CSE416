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
 * Each field's label is 16px semibold ink (600 names a block; 700 is for a
 * page's name), its value or control hanging under the label's text
 * (VALUE_INDENT). My Profile's 20px glyph beside it is grey (`ink-meta`),
 * since it only informs (design.md, the icon colour rule; KAN-571): it was
 * a brand glyph, drawn as a job posting's section heading is.
 * Two columns where the card is wide, one on a phone.
 */
export const SECTION_CARD = "scroll-mt-6 p-5 @xl/main:p-6";
export const FIELD_HEADING = "text-subtitle text-ink flex items-center gap-2 font-semibold";
export const FIELD_GRID = "mt-5 grid gap-x-10 gap-y-6 @xl/main:grid-cols-2";
/** Lines a value up under its heading's text, past the 20px glyph and gap. */
export const VALUE_INDENT = "pl-7";
