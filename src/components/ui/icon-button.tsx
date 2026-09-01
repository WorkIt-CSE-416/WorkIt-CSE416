import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A button whose entire content is an icon, so it must be labelled in words.
 *
 * `label` is required rather than optional: an icon-only control with no
 * accessible name is unusable with a screen reader, and making the prop
 * mandatory is what stops one from shipping. Pass the icon as children and size
 * it there — the glyph sizes differ per usage even where the button does not.
 */
const VARIANTS = {
  /** Bare glyph — top-bar utilities and row actions. */
  quiet:
    "text-ink-meta hover:text-ink focus-visible:ring-brand-ring rounded-xs focus-visible:ring-2",
  /** Bordered — an icon action that has to hold its own beside a filled
   *  button, so it needs the same visual weight a button has. Size it at the
   *  call site: the search detail pane's bookmark is deliberately narrower
   *  than it is tall, to sit under the Apply button's height. */
  outline:
    "border-border-subtle bg-panel text-ink-meta hover:bg-canvas hover:text-ink focus-visible:ring-brand-ring rounded-control inline-flex items-center justify-center border focus-visible:ring-[3px]",
  /** Brand disc — an edit affordance overlapping the thing it edits. The border
   *  matches the panel behind it so the disc reads as cut out of the surface. */
  brand:
    "bg-brand text-on-brand border-panel hover:bg-brand-hover focus-visible:ring-brand-ring inline-flex size-6.5 items-center justify-center rounded-full border-2 focus-visible:ring-2",
} as const;

export type IconButtonVariant = keyof typeof VARIANTS;

type IconButtonProps = {
  label: string;
  variant?: IconButtonVariant;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "className" | "children" | "aria-label">;

export function IconButton({
  label,
  variant = "quiet",
  className,
  type = "button",
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(VARIANTS[variant], "focus-visible:outline-none", className)}
      {...props}
    >
      {children}
    </button>
  );
}
