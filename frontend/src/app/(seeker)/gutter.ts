/**
 * The side gutter shared by the seeker bar and every seeker page, so their
 * edges agree at every width. 16px on a phone, where 48px each side would
 * leave a 279px column; the full 48px from lg. Its own module because a
 * layout file may only export what Next.js expects of one.
 */
export const SEEKER_GUTTER = "px-4 sm:px-8 lg:px-12";
