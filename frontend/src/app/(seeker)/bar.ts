/**
 * The seeker top bar's round controls: the bell, and the magnifier that
 * stands in for the search field on a phone. White 40px circles with the
 * card border and a 1px halo, so on the white bar they read as buttons
 * rather than bare glyphs, at the avatar's own 40px so the cluster is one
 * height. One string so the two cannot drift. Its own module because a
 * layout file may only export what Next.js expects of one.
 */
export const BAR_CIRCLE =
  "bg-panel border-border shadow-panel hover:bg-hover size-10 rounded-full border";
