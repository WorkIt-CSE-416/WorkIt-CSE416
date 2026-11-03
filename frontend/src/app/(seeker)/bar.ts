/**
 * The seeker top bar's icon buttons: the bell, and Scout's button when it is
 * live. A bare ink glyph on the white bar, with no fill until hover
 * (2026-11-02): a grey circle round each stood out beside the title. 40px,
 * the account photo's size, so the cluster is one height. One string so the
 * two cannot drift. Its own module because a layout file may only export what
 * Next.js expects of one.
 */
export const BAR_ICON = "text-ink hover:bg-well hover:text-ink size-10 rounded-full";

/** The page's title in the top bar (./bar-title.tsx): the old page heading's
 *  size, a step smaller on a phone, where the toggle, the bell and the photo
 *  share the bar. One line, cut short rather than taller than the bar. */
export const BAR_TITLE = "text-title md:text-heading text-ink truncate";
