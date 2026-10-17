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
 *   suggestion  an answer offered: WorkIt's replies in the chat, a section
 *               to start
 *   primary     the one suggestion most people take ("Use This")
 *
 * TWO SIZES. `default` is 36px tall, an sm Button's height, so a chip and a
 * button on one row line up; 13px label type and a 14px glyph (an icon with
 * no `size-*` class takes it, as in Button). `lg` is 42px, a default
 * Button's and a text field's height, with 16px type, for a screen where the
 * chips are the question itself (onboarding, KAN-231). Before this, five
 * screens drew their own pill at 28, 30 or 32px, in two type sizes, with four
 * pressed looks, and onboarding's large pills were 40px.
 *
 * It presses to 96% like a segment (docs/motion.md), and its colours ease
 * over 150ms. A caller passes `className` for layout only; a stage filter is
 * the one call site that paints its own pressed colour (a stage owns its
 * colour, docs/design.md).
 */
export const chipVariants = cva(
  "focus-visible:ring-brand-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap transition-[background-color,border-color,color,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-96 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        choice: "",
        suggestion: "border-brand-pale bg-panel text-brand hover:bg-brand-tint",
        primary: "bg-brand text-on-brand hover:bg-brand-hover border-transparent",
      },
      pressed: { true: "", false: "" },
      size: {
        default: "text-label h-9 px-3.5",
        lg: "text-subtitle h-10.5 px-4",
      },
    },
    compoundVariants: [
      {
        variant: "choice",
        pressed: false,
        class: "border-border-subtle bg-panel text-ink-muted hover:border-border hover:text-ink",
      },
      { variant: "choice", pressed: true, class: "border-brand bg-brand-tint text-brand" },
    ],
    defaultVariants: { variant: "choice", pressed: false, size: "default" },
  },
);

type ChipStyle = Omit<VariantProps<typeof chipVariants>, "pressed"> & {
  /** On, for a `choice`. Left out, the chip is not a toggle at all. */
  pressed?: boolean;
  className?: string;
};

export function chipClasses({ variant, pressed, size, className }: ChipStyle = {}) {
  return cn(chipVariants({ variant, pressed: pressed ?? false, size }), className);
}

type ChipProps = ChipStyle & Omit<ComponentProps<"button">, "className">;

export function Chip({ variant, pressed, size, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={chipClasses({ variant, pressed, size, className })}
      {...props}
    />
  );
}

type ChipLinkProps = ChipStyle & Omit<ComponentProps<typeof Link>, "className">;

/** A picked value the student can take back: a pressed choice with a cross,
 *  the place, role and season picks of All Filters and onboarding
 *  (components/filter-controls.tsx). The chip is
 *  not a button; its cross is, and the cross names what it removes. The two
 *  were 32px and 26px pills of their own until KAN-251. */
export function RemovableChip({
  removeLabel,
  onRemove,
  size,
  children,
}: {
  /** The cross's accessible name: "Remove Boston, MA". */
  removeLabel: string;
  onRemove: () => void;
  size?: ChipStyle["size"];
  children: ReactNode;
}) {
  return (
    <span className={cn(chipVariants({ pressed: true, size }), "gap-1 pr-1.5 active:scale-100")}>
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
export function ChipLink({ variant, pressed, size, className, ...props }: ChipLinkProps) {
  return <Link className={chipClasses({ variant, pressed, size, className })} {...props} />;
}
