/**
 * The side gutter every seeker page takes inside the shell, and the bar's
 * content side takes above it, so the search field and the avatar line up
 * with the page's own edges. 16px on a phone, where 48px each side would
 * leave a 279px column; the full 48px from lg. Its own module because a
 * layout file may only export what Next.js expects of one.
 */
export const SEEKER_GUTTER = "px-4 sm:px-8 lg:px-12";
