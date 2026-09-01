import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * The one place button styling lives — for WorkIt's screens and for the
 * shadcn components in src/components/shadcn alike.
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
 *
 * ---------------------------------------------------------------------------
 * WHY THE NAMES ARE SHADCN'S AND THE STYLING IS NOT
 *
 * This used to be a second Button, sitting beside the one shadcn generates.
 * shadcn's Dialog reaches for `variant="ghost" size="icon-sm"` on its close
 * control, so keeping two meant either overwriting this file — which would have
 * broken every screen — or hand-patching each component we pull in.
 *
 * Instead there is now one Button that answers to shadcn's vocabulary while
 * painting WorkIt's measured design. A component pasted from the shadcn docs
 * composes without edits; it simply renders in WorkIt's palette and proportions
 * rather than stock shadcn's.
 *
 *   shadcn name    was          renders as
 *   default        primary      brand fill
 *   secondary      secondary    bordered neutral
 *   outline        outline      brand outline
 *   ghost          quiet        brand text, no chrome
 *
 * `positive` and `inline` have no shadcn equivalent and are kept as WorkIt
 * roles. `destructive`, `link`, `xs` and the `icon-*` sizes are the reverse —
 * shadcn expects them, no mockup draws them, so they are marked UNMEASURED
 * below and are extrapolations rather than sampled values.
 *
 * Base UI's ButtonPrimitive rather than a bare <button>: it is what shadcn's
 * components compose against, so `render={<Button />}` works, and it already
 * defaults type="button" — the HTML default is "submit", which silently posts
 * the enclosing form.
 * ------------------------------------------------------------------------- */

export const buttonVariants = cva(
  "inline-flex items-center justify-center font-medium focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Brand fill — the primary action on a screen. */
        default:
          "bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-active focus-visible:ring-brand-ring rounded-control focus-visible:ring-[3px]",
        /** Bordered neutral — alternatives sitting beside a primary action. */
        secondary:
          "border-border-subtle bg-surface text-ink hover:bg-canvas focus-visible:ring-brand-ring rounded-control border focus-visible:ring-[3px]",
        /** Brand outline — an action inside an already-recessed area. */
        outline:
          "border-brand/50 text-brand hover:bg-brand/5 focus-visible:ring-brand-ring rounded-control border focus-visible:ring-[3px]",
        /** Positive fill — accepting an offer. The board's only green action,
         *  and the only place a control is not brand-coloured. No shadcn
         *  equivalent: its palette has no success role. */
        positive:
          "bg-positive text-on-brand hover:bg-positive-hover active:bg-positive-active focus-visible:ring-positive-ring rounded-control focus-visible:ring-[3px]",
        /** Text only — section actions in a card header, which carry no chrome.
         *  shadcn calls this `ghost` and means a neutral glyph with a hover
         *  fill; WorkIt's is brand-coloured, which is the reading kept here
         *  because four call sites were drawn that way. */
        ghost:
          "text-brand hover:text-brand-hover focus-visible:ring-brand-ring rounded-xs focus-visible:ring-2",
        /** UNMEASURED — no mockup draws a destructive action, and --destructive
         *  is still shadcn's stock red (see globals.css). Shaped like the other
         *  fills so it is at least consistent when a delete flow lands. */
        destructive:
          "bg-destructive text-on-brand hover:bg-destructive/90 focus-visible:ring-destructive/35 rounded-control focus-visible:ring-[3px]",
        /** UNMEASURED — provided because shadcn components ask for it. For a
         *  link inside running text prefer <TextLink>, which inherits the
         *  sentence's type size instead of setting its own. */
        link: "text-brand hover:text-brand-hover rounded-xs underline-offset-4 hover:underline focus-visible:ring-brand-ring focus-visible:ring-2",
      },
      size: {
        /** Padding-free. WorkIt-only: shadcn has no size without a box. */
        inline: "text-note gap-1",
        /** UNMEASURED — extrapolated between `inline` and `sm`. */
        xs: "text-note gap-1 px-2 py-1",
        sm: "text-label gap-2 px-2.5 py-1.5",
        default: "text-label gap-2 px-3 py-2",
        lg: "text-body gap-2 px-4 py-2.5",
        /** UNMEASURED — square glyph buttons, for shadcn components that ask
         *  for them. A bare glyph in WorkIt's own chrome is <IconButton>. */
        "icon-xs": "size-6",
        "icon-sm": "size-7",
        icon: "size-8",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

/**
 * Each variant's natural size, so callers only pass `size` to override it.
 *
 * cva can only express one default size for the whole component, so this is
 * resolved before the class string is built. Calling `buttonVariants` directly
 * — as a shadcn component may — skips it and gets the `default` size.
 */
const DEFAULT_SIZE: Record<ButtonVariant, ButtonSize> = {
  default: "default",
  secondary: "default",
  destructive: "default",
  positive: "sm",
  outline: "sm",
  ghost: "inline",
  link: "inline",
};

type StyleProps = { variant?: ButtonVariant; size?: ButtonSize; className?: string };

/**
 * Exported for the rare element that must be styled as a button without being
 * one — a file input's label, say. Prefer <Button> or <ButtonLink>.
 */
export function buttonClasses({ variant = "default", size, className }: StyleProps = {}) {
  return cn(buttonVariants({ variant, size: size ?? DEFAULT_SIZE[variant] }), className);
}

type ButtonProps = StyleProps & Omit<ButtonPrimitive.Props, "className">;

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonClasses({ variant, size, className })}
      {...props}
    />
  );
}

type ButtonLinkProps = StyleProps & Omit<ComponentProps<typeof Link>, "className">;

/** A link that looks like a button. Navigation, so it stays an anchor. */
export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />;
}
