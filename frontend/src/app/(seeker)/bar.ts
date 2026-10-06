/**
 * The seeker top bar's round controls: the bell, and the magnifier that
 * stands in for the search field on a phone. 40px circles filled a neutral
 * light grey (--color-app), the search pill's own fill, with no border: a
 * grey ring around each made the bar look like stock parts, and the fill
 * alone says "button" on the white bar. Hover deepens the fill to
 * --color-selected and the glyph to ink. 40px is the account photo's
 * size, so the cluster is one height. One string so the two cannot drift.
 * Its own module because a layout file may only export what Next.js expects
 * of one.
 */
export const BAR_CIRCLE =
  "bg-app text-ink-meta hover:bg-selected hover:text-ink size-10 rounded-full";
