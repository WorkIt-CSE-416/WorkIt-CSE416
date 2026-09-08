import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts by last-wins.
 *
 * Plain string concatenation does not do the second part. Two utilities from
 * the same group — `p-2` from a component's base and a `p-4` passed through
 * `className` — both survive into the class attribute, and which one paints is
 * decided by the order Tailwind emitted them into the stylesheet, not by the
 * order they were written. That is the trap documented in ui/button.tsx and on
 * the applications board; merging closes it by dropping the earlier utility
 * outright, so a caller's override always wins.
 *
 * WHY THE CONFIGURATION BELOW IS NOT OPTIONAL: tailwind-merge ships knowing
 * stock Tailwind, and Tailwind v4 keeps this project's scales in CSS, which
 * tailwind-merge never reads. Left at its defaults it sorts every unrecognised
 * `text-*` into the text-colour group — so `text-title text-ink` looks like two
 * colours fighting, and the *font size* is the one silently dropped. Every type
 * token in the app is `text-`-prefixed, so that single misreading would flatten
 * the whole type scale. Registering the sizes below is what keeps a size and a
 * colour from colliding.
 *
 * Keep these lists in step with the @theme block in app/globals.css. A token
 * that is missing here is not a crash, just a merge that quietly does nothing —
 * which is the same silence the lists exist to prevent.
 *
 * Merging only reaches groups that share a CSS property. `border` (width) and
 * `border-t-[3px]` (top width) are different groups and both survive, which is
 * why a card's accent edge still has to set its three plain sides explicitly
 * rather than leaning on a shorthand colour — see ui/card.tsx.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "caption",
            "label",
            "body",
            "title",
            "meta",
            "note",
            "subtitle",
            "heading",
            "display",
          ],
        },
      ],
      rounded: [{ rounded: ["control", "card"] }],
      shadow: [{ shadow: ["card", "panel"] }],
      "max-w": [{ "max-w": ["auth", "app"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
