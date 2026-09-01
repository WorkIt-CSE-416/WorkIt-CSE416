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
  status: "text-meta rounded-full px-2 py-px",
  tag: "text-note rounded-md px-2 py-0.5",
} as const;

const TONES = {
  brand: "bg-brand-tint text-brand",
  neutral: "bg-brand-tint text-ink-muted",
  positive: "bg-positive-tint text-positive",
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
