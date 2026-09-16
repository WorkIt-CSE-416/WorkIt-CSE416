import type { ComponentProps, ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/cn";

/**
 * A button whose entire content is an icon, so it must be labelled in words.
 *
 * `label` is required rather than optional: an icon-only control with no
 * accessible name is unusable with a screen reader, and making the prop
 * mandatory is what stops one from shipping. Pass the icon as children and size
 * it there — the glyph sizes differ per usage even where the button does not.
 *
 * The label is also the tooltip, unless `tooltip` says otherwise. Pass one when
 * the label names the thing the button acts on — "Save Staff Frontend
 * Engineer" — because that detail is for a screen reader, which reaches the
 * button without the card around it and would otherwise hear "Save" ten times
 * down the feed. A sighted user is hovering inside that card already, so the
 * tooltip says just "Save". The label stays on aria-label either way: Base
 * UI's tooltip is visual only and never becomes the button's accessible name.
 *
 * The trigger is the button itself — Base UI's Tooltip.Trigger renders a
 * <button> — rather than a wrapper around one, so there is no extra element in
 * the flex rows these sit in. TooltipProvider is in the root layout.
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
    "border-border-subtle bg-panel text-ink-meta hover:bg-hover hover:text-ink focus-visible:ring-brand-ring rounded-control inline-flex items-center justify-center border focus-visible:ring-[3px]",
  /** Brand disc — an edit affordance overlapping the thing it edits. The border
   *  matches the panel behind it so the disc reads as cut out of the surface. */
  brand:
    "bg-brand text-on-brand border-panel hover:bg-brand-hover focus-visible:ring-brand-ring inline-flex size-6.5 items-center justify-center rounded-full border-2 focus-visible:ring-2",
} as const;

export type IconButtonVariant = keyof typeof VARIANTS;

type IconButtonProps = {
  label: string;
  /** Shown on hover in place of `label`, for a label too specific to read well. */
  tooltip?: string;
  variant?: IconButtonVariant;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "className" | "children" | "aria-label">;

export function IconButton({
  label,
  tooltip = label,
  variant = "quiet",
  className,
  type = "button",
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        type={type}
        aria-label={label}
        className={cn(VARIANTS[variant], "focus-visible:outline-none", className)}
        {...props}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
