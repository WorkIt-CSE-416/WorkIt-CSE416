import type { ElementType, HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * The raised panel every screen builds on.
 *
 * Before this existed the same shell was spelled four ways across three pages —
 * three padding values, two naming conventions, and one copy that forgot its
 * border colour. The shape is the constant; what actually varies is padding,
 * whether the card is selected, and whether it carries a status edge.
 *
 * `padding` is a scale rather than a free class because the four values below
 * are the four the mockups measure. `md` is the profile card's 18px, which is
 * deliberately off the 4px grid — see the note it replaced in profile/page.tsx.
 *
 * `elevated` exists for the one card that sits on a panel rather than the page
 * (the search detail header): the mockup draws no shadow there, and a shadow
 * against an identical background would only muddy the edge.
 *
 * ACCENT AND BORDER COLOUR: with an accent the top edge is 3px and the other
 * three are 1px, so the three plain sides get their colour individually. A
 * shorthand `border-<colour>` beside a `border-t-<colour>` would resolve by
 * stylesheet order rather than source order, and cn() cannot fix that — the two
 * are different utility groups, so both survive the merge. Setting each side
 * explicitly is what keeps the accent visible.
 */
const BASE = "rounded-card bg-panel";

const PADDING = {
  none: "",
  xs: "p-2", // applications board card
  sm: "p-3", // search result card
  md: "p-4.5", // profile card — 18px as measured
  lg: "p-5", // search detail header
} as const;

const ACCENT = {
  pale: "border-t-brand-pale",
  brand: "border-t-brand",
  positive: "border-t-positive",
} as const;

export type CardPadding = keyof typeof PADDING;
export type CardAccent = keyof typeof ACCENT;

/** Every element a card is rendered as today. */
type CardElement = "div" | "section" | "article" | "header" | "li";

type CardProps = {
  as?: CardElement;
  padding?: CardPadding;
  /** Paints the top edge with a status colour and thickens it to 3px. */
  accent?: CardAccent;
  /** Draws the outline in brand — the board's focused card, the chosen result. */
  selected?: boolean;
  /** Drop the shadow for a card sitting on a panel rather than on the page. */
  elevated?: boolean;
  className?: string;
  /** Attributes are typed against the generic HTMLElement rather than any one
   *  tag: `as` decides the element, so nothing narrower is true for all of
   *  them. That covers everything a card actually passes — aria-labelledby,
   *  aria-current, id — and leaves out the per-element extras (an <li> value,
   *  a <div> ref) that no card here needs. */
} & Omit<HTMLAttributes<HTMLElement>, "className">;

function edge(accent: CardAccent | undefined, selected: boolean) {
  if (!accent) {
    return ["border", selected ? "border-brand" : "border-border-subtle"];
  }

  return [
    "border-x border-b border-t-[3px]",
    selected ? "border-x-brand border-b-brand" : "border-x-border-subtle border-b-border-subtle",
    ACCENT[accent],
  ];
}

export function Card({
  as = "div",
  padding = "md",
  accent,
  selected = false,
  elevated = true,
  className,
  ...props
}: CardProps) {
  const Tag = as as ElementType;

  return (
    <Tag
      className={cn(
        BASE,
        elevated && "shadow-panel",
        edge(accent, selected),
        PADDING[padding],
        className,
      )}
      {...props}
    />
  );
}
