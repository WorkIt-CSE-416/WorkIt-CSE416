/**
 * The side gutter every seeker page takes inside the shell's page panel.
 * 16px on a phone, where 48px each side would leave a 279px column; the full
 * 48px from lg. Its own module because a layout file may only export what
 * Next.js expects of one.
 */
export const SEEKER_GUTTER = "px-4 sm:px-8 lg:px-12";

/** The same gutter as a negative margin, for something that paints across
 *  it while its content stays in the column (pair it with SEEKER_GUTTER).
 *  The two change together. */
export const SEEKER_BLEED = "-mx-4 sm:-mx-8 lg:-mx-12";
