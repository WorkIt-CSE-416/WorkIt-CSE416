import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * The one place button styling lives.
 *
 * Variants and sizes are separate because the codebase already needed every
 * combination of the two: a compact brand fill in the top bar, a compact brand
 * outline in the dropzone, full-width bordered buttons on the login card. Each
 * value below reproduces a class string that was previously inline, so adopting
 * this component is not meant to move any pixels.
 *
 * `font-medium` sits in the base because every button in both mockups resolves
 * to weight 500 — either from --text-label/--text-note's baked-in weight or from
 * an explicit font-medium. Gap lives in the sizes, not the base, so that the
 * padding-free `inline` size can tighten it without two gap utilities colliding.
 *
 * ONE DELIBERATE NORMALISATION: the profile mockup's "Browse Files" measured
 * px-3 where the login and top-bar buttons of the same height measured px-2.5.
 * `sm` uses px-2.5, so that button is now 2px narrower overall. The two mockups
 * already disagree elsewhere (see the surfaces note in globals.css), so this is
 * read as mockup noise rather than intent — if it turns out to be deliberate,
 * add a size here rather than reaching for `className`. Overrides do work now
 * that classes go through cn(), but a one-off padding at a call site is a size
 * nobody else can find or reuse.
 */
const BASE = "inline-flex items-center justify-center font-medium focus-visible:outline-none";

const VARIANTS = {
  /** Brand fill — the primary action on a screen. */
  primary:
    "bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-active focus-visible:ring-brand-ring rounded-control focus-visible:ring-[3px]",
  /** Bordered neutral — alternatives sitting beside a primary action. */
  secondary:
    "border-border-subtle bg-surface text-ink hover:bg-canvas focus-visible:ring-brand-ring rounded-control border focus-visible:ring-[3px]",
  /** Brand outline — an action inside an already-recessed area. */
  outline:
    "border-brand/50 text-brand hover:bg-brand/5 focus-visible:ring-brand-ring rounded-control border focus-visible:ring-[3px]",
  /** Positive fill — accepting an offer. The board's only green action, and
   *  the only place a control is not brand-coloured. */
  positive:
    "bg-positive text-on-brand hover:bg-positive-hover active:bg-positive-active focus-visible:ring-positive-ring rounded-control focus-visible:ring-[3px]",
  /** Text only — section actions in a card header, which carry no chrome. */
  quiet:
    "text-brand hover:text-brand-hover focus-visible:ring-brand-ring rounded-xs focus-visible:ring-2",
} as const;

const SIZES = {
  inline: "text-note gap-1",
  sm: "text-label gap-2 px-2.5 py-1.5",
  md: "text-label gap-2 px-3 py-2",
  lg: "text-body gap-2 px-4 py-2.5",
} as const;

/** Each variant's natural size, so callers only pass `size` to override it. */
const DEFAULT_SIZE: Record<ButtonVariant, ButtonSize> = {
  primary: "md",
  secondary: "md",
  positive: "sm",
  outline: "sm",
  quiet: "inline",
};

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

type StyleProps = { variant?: ButtonVariant; size?: ButtonSize; className?: string };

/**
 * Exported for the rare element that must be styled as a button without being
 * one — a file input's label, say. Prefer <Button> or <ButtonLink>.
 */
export function buttonClasses({ variant = "primary", size, className }: StyleProps = {}) {
  return cn(BASE, VARIANTS[variant], SIZES[size ?? DEFAULT_SIZE[variant]], className);
}

type ButtonProps = StyleProps & Omit<ComponentProps<"button">, "className">;

/**
 * Defaults to type="button". The HTML default is "submit", which silently posts
 * the enclosing form — every button here that is not a submit wants "button".
 */
export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}

type ButtonLinkProps = StyleProps & Omit<ComponentProps<typeof Link>, "className">;

/** A link that looks like a button. Navigation, so it stays an anchor. */
export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />;
}
