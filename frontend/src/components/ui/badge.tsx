import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A small pill of metadata attached to a card or heading.
 *
 * `variant` is the shape, and it says what kind of thing the pill is: `status`
 * names where something stands ("Applied", "Round 2", "Actively Hiring") and is
 * fully rounded; `tag` states a fact about the job itself ("Remote", a salary
 * band, a result count) and takes the softer rectangle radius. The board mockup
 * measures 6px there against a fully rounded status chip, which is the one
 * thing keeping the two apart at a glance.
 *
 * `tone` is the colour, and it defaults from the variant — a status reads brand
 * and a tag reads neutral, which is what every pill on the board wants. The
 * search screen is the reason it can be overridden: its "New" and "Actively
 * Hiring" pills are green, and its result count is a neutral tag that has to be
 * fully rounded, so shape and colour stopped moving together.
 */
const VARIANTS = {
  /* py-px gave the chip a 17px box, which read as a label squeezed onto its
   * text rather than a pill sitting around it. py-1 takes it to 23px — still
   * shorter than anything else in a row, which is the point of a chip, but
   * with enough room that the fill reads as a shape. */
  status: "text-meta rounded-full px-2.5 py-1",
  tag: "text-note rounded-md px-2 py-0.5",
} as const;

/**
 * Tones name a state's KIND, not one label each.
 *
 * Two statuses share a tone when they are the same kind of thing. What is not
 * useful is two different kinds sharing one, which is what happened while
 * everything that was not positive fell through to `neutral`: a paused posting
 * and a closed one painted identically, though one is waiting on a decision
 * and the other is over.
 *
 * `brand` and `advanced` are the two halves of "in flight", split because
 * being in a screen and being in an interview cost a hiring team completely
 * different amounts of its week.
 *
 * `neutral` stays exactly as it was. It is the default for every `tag` — skill
 * pills, salary bands, the search screen's result count — and the mockups draw
 * all of those blue-tinted. `inert` is the grey that statuses wanted from it.
 *
 * `positive` wears --color-positive-ink rather than --color-positive, which is
 * the one tone whose text colour is not simply its fill colour darkened by
 * convention. --color-positive on --color-positive-tint measures 2.51:1: at
 * 11px that is a green chip with a slightly greener chip printed on it. The ink
 * role clears AA at 4.79:1 on the same fill, so the tint is unchanged and only
 * the glyph moved. See the token's note in globals.css.
 */
const TONES = {
  /** In flight, early — someone is looking, cheaply. */
  brand: "bg-brand-tint text-brand",
  /** In flight, late — the expensive half, where a team's time is committed. */
  advanced: "bg-advanced-tint text-advanced",
  /** A tag's fill. Blue-tinted, and the default for `tag` rather than a state. */
  neutral: "bg-brand-tint text-ink-muted",
  /** Finished well — an offer, a live posting. */
  positive: "bg-positive-tint text-positive-ink",
  /** Halted, and waiting on someone here to decide. */
  warning: "bg-warning-tint text-warning",
  /** Finished badly — a rejection. */
  danger: "bg-danger-tint text-danger",
  /** Over or not yet begun; nothing is happening and nothing is owed. */
  inert: "bg-inert-tint text-ink-meta",
  /** Not live at all. No fill, because there is nothing to fill in yet — a
   *  draft is the one state that has never been published. */
  outline: "border-border-strong text-ink-meta border bg-transparent",
} as const;

export type BadgeVariant = keyof typeof VARIANTS;
export type BadgeTone = keyof typeof TONES;

const DEFAULT_TONE: Record<BadgeVariant, BadgeTone> = { status: "brand", tag: "neutral" };

export function Badge({
  variant = "status",
  tone,
  pill = false,
  children,
}: {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  /** Force the rounded shape onto a `tag` — the search screen's result count. */
  pill?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        VARIANTS[variant],
        TONES[tone ?? DEFAULT_TONE[variant]],
        pill && "rounded-full",
      )}
    >
      {children}
    </span>
  );
}
