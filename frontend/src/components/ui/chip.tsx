import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { CloseIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The one chip (KAN-251): a pill for a choice made in place. Buttons are
 * rounded rectangles and act (ui/button.tsx); a pill is always a chip, so
 * the shape alone says which is which.
 *
 *   choice      a filter or a toggle; `pressed` turns it on (aria-pressed)
 *   suggestion  an answer offered: WorkIt's replies in the chat, a skill or
 *               an expertise to add
 *   primary     the one suggestion most people take ("Use This")
 *
 * ONE SIZE. 36px tall, an sm Button's height, so a chip and a button on one
 * row line up; 13px label type and a 14px glyph (an icon with no `size-*`
 * class takes it, as in Button). Before this, five screens drew their own
 * pill at 28, 30 or 32px, in two type sizes, with four pressed looks.
 *
 * It presses to 96% like a segment (docs/motion.md), and its colours ease
 * over 150ms. A caller passes `className` for layout only; a stage filter is
 * the one call site that paints its own pressed colour (a stage owns its
 * colour, docs/design.md).
 */
export const chipVariants = cva(
  "text-label focus-visible:ring-brand-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-medium whitespace-nowrap transition-[background-color,border-color,color,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-96 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        choice: "",
        suggestion: "border-brand-pale bg-panel text-brand hover:bg-brand-tint",
        primary: "bg-brand text-on-brand hover:bg-brand-hover border-transparent",
      },
      pressed: { true: "", false: "" },
    },
    compoundVariants: [
      {
        variant: "choice",
        pressed: false,
        class: "border-border-subtle bg-panel text-ink-muted hover:border-border hover:text-ink",
      },
      { variant: "choice", pressed: true, class: "border-brand bg-brand-tint text-brand" },
    ],
    defaultVariants: { variant: "choice", pressed: false },
  },
);

type ChipStyle = Omit<VariantProps<typeof chipVariants>, "pressed"> & {
  /** On, for a `choice`. Left out, the chip is not a toggle at all. */
  pressed?: boolean;
  className?: string;
};

export function chipClasses({ variant, pressed, className }: ChipStyle = {}) {
  return cn(chipVariants({ variant, pressed: pressed ?? false }), className);
}

type ChipProps = ChipStyle & Omit<ComponentProps<"button">, "className">;

export function Chip({ variant, pressed, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={chipClasses({ variant, pressed, className })}
      {...props}
    />
  );
}

type ChipLinkProps = ChipStyle & Omit<ComponentProps<typeof Link>, "className">;

/** A picked value the student can take back: a pressed choice with a cross,
 *  the Jobs page's location picks and onboarding's expertise. The chip is
 *  not a button; its cross is, and the cross names what it removes. The two
 *  were 32px and 26px pills of their own until KAN-251. */
export function RemovableChip({
  removeLabel,
  onRemove,
  children,
}: {
  /** The cross's accessible name: "Remove Boston, MA". */
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <span className={cn(chipVariants({ pressed: true }), "gap-1 pr-1.5 active:scale-100")}>
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="hover:bg-brand/10 focus-visible:ring-brand-ring flex size-6 items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-90"
      >
        <CloseIcon className="size-3.5" />
      </button>
    </span>
  );
}

/** A chip that goes somewhere: a filter kept in the URL. A link cannot be
 *  aria-pressed, so a pressed one says it is on in words of its own (the
 *  Applications stage chips add a hidden ", filter on"). */
export function ChipLink({ variant, pressed, className, ...props }: ChipLinkProps) {
  return <Link className={chipClasses({ variant, pressed, className })} {...props} />;
}
