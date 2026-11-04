import Link from "next/link";
import type { ElementType, HTMLAttributes, Ref } from "react";

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
 * deliberately off the 4px grid — see the note it replaced in My Profile's page.
 *
 * `elevated` exists for the one card that sits on a panel rather than the page
 * (the search detail header): the mockup draws no shadow there, and a shadow
 * against an identical background would only muddy the edge.
 *
 * THE EDGE IS --color-border-control (2026-11-03), the same edge as a button
 * and a field, so a card and the controls on it read as one set; the user
 * found light-edged cards beside dark-edged buttons a mismatch. Rules inside
 * a card stay --color-border-subtle, or every card reads as a heavy box.
 *
 * ACCENT AND BORDER COLOUR: with an accent the top edge is 3px and the other
 * three are 1px, so the three plain sides get their colour individually. A
 * shorthand `border-<colour>` beside a `border-t-<colour>` would resolve by
 * stylesheet order rather than source order, and cn() cannot fix that — the two
 * are different utility groups, so both survive the merge. Setting each side
 * explicitly is what keeps the accent visible.
 *
 * ONE CARD FOR SEEKER PAGES (KAN-558): Home, My Profile and Settings drew
 * three kinds of card until then, each with its own corner, edge, shadow and
 * title. Every white block on a seeker page is this card now, 16px from the
 * next, titled with ui/section-heading.tsx. `tone` is the one way a card
 * may look different: `tile` is Home's tile, which keeps KAN-173's look (no
 * outline, set apart by --shadow-tile, the 20px corner), and a tinted
 * headline tile passes its tint as a `bg-*` token over the white. `href`
 * makes the whole card a link: an outline that darkens under the pointer,
 * a focus ring, and `group/card` for an arrow that slides
 * (`group-hover/card:translate-x-0.5`).
 */
const BASE = "bg-panel";

const TONE = {
  default: "rounded-card",
  tile: "rounded-shell shadow-tile relative",
} as const;

const LINK =
  "group/card hover:border-ink-meta focus-visible:ring-brand-ring block transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";

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
export type CardTone = keyof typeof TONE;

/** Every element a card is rendered as today. */
type CardElement = "div" | "section" | "article" | "header" | "li" | "ul";

type CardProps = {
  as?: CardElement;
  /** Renders the card as a link to this address, the whole card the target. */
  href?: string;
  /** `tile` is Home's tile: no outline, --shadow-tile, the 20px corner. */
  tone?: CardTone;
  padding?: CardPadding;
  /** Paints the top edge with a status colour and thickens it to 3px. */
  accent?: CardAccent;
  /** Draws the outline in brand — the board's focused card, the chosen result. */
  selected?: boolean;
  /** Drop the shadow for a card sitting on a panel rather than on the page. */
  elevated?: boolean;
  className?: string;
  ref?: Ref<HTMLElement>;
  /** Attributes are typed against the generic HTMLElement rather than any one
   *  tag: `as` decides the element, so nothing narrower is true for all of
   *  them. That covers everything a card actually passes — aria-labelledby,
   *  aria-current, id — and leaves out the per-element extras (an <li> value,
   *  a <div> ref) that no card here needs. */
} & Omit<HTMLAttributes<HTMLElement>, "className">;

function edge(accent: CardAccent | undefined, selected: boolean) {
  if (!accent) {
    return ["border", selected ? "border-brand" : "border-border-control"];
  }

  return [
    "border-x border-b border-t-[3px]",
    selected ? "border-x-brand border-b-brand" : "border-x-border-control border-b-border-control",
    ACCENT[accent],
  ];
}

export function Card({
  as = "div",
  href,
  tone = "default",
  padding = "md",
  accent,
  selected = false,
  elevated = true,
  className,
  ...props
}: CardProps) {
  const Tag = (href ? Link : as) as ElementType;

  return (
    <Tag
      href={href}
      className={cn(
        BASE,
        TONE[tone],
        tone === "default" && [elevated && "shadow-panel", edge(accent, selected)],
        href && LINK,
        PADDING[padding],
        className,
      )}
      {...props}
    />
  );
}
