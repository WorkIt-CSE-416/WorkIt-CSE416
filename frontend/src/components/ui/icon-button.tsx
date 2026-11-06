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
  /** Bare glyph: top-bar utilities and row actions. Centred in whatever box
   *  the call site sizes it to, and the hit area reaches 8px past the box,
   *  so an unsized 16px glyph is still a 32px target with a mouse (44px on
   *  touch) without moving anything around it. */
  quiet:
    "text-ink hover:text-brand focus-visible:ring-brand-ring inline-flex items-center justify-center rounded-xs [--hit-grow:8px] focus-visible:ring-2",
  /** Bordered — an icon action that has to hold its own beside a filled
   *  button, so it needs the same visual weight a button has. Size it at the
   *  call site: the feed card's Not Interested button is size-9, the `sm`
   *  button height (36px), to line up with the actions beside it. */
  outline:
    "border-border-control bg-panel text-ink hover:bg-hover focus-visible:ring-brand-ring rounded-control inline-flex items-center justify-center border focus-visible:ring-[3px]",
  /** A bare glyph on the inverted surface: a toast's close (ui/toast.tsx,
   *  KAN-217). On-inverse at 80%, full on hover; never on a light page. */
  inverse:
    "text-on-inverse/80 hover:text-on-inverse focus-visible:ring-on-inverse inline-flex items-center justify-center rounded-xs [--hit-grow:8px] focus-visible:ring-2",
  /** Brand disc — an edit affordance overlapping the thing it edits. The border
   *  matches the panel behind it so the disc reads as cut out of the surface. */
  brand:
    "bg-brand text-on-brand border-panel hover:bg-brand-hover focus-visible:ring-brand-ring inline-flex size-6.5 items-center justify-center rounded-full border-2 focus-visible:ring-2 focus-visible:ring-offset-2",
} as const;

export type IconButtonVariant = keyof typeof VARIANTS;

type IconButtonProps = {
  label: string;
  /** Shown on hover in place of `label`, for a label too specific to read well. */
  tooltip?: string;
  variant?: IconButtonVariant;
  /** Not built yet (KAN-569): the button stays in its place, faded, does
   *  nothing, and says "Coming Soon" in its tooltip and its name. Unlike
   *  `disabled` it still takes the pointer and focus, since a disabled button
   *  shows no tooltip and so could not say why. */
  soon?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "className" | "children" | "aria-label">;

export function IconButton({
  label,
  tooltip = label,
  variant = "quiet",
  soon = false,
  className,
  type = "button",
  disabled,
  onClick,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        // `disabled` on the trigger only stops the tooltip: the button itself
        // takes it through `render`, or a disabled button still clicks.
        render={<button disabled={disabled} />}
        disabled={disabled}
        type={type}
        aria-label={soon ? `${label}, coming soon` : label}
        aria-disabled={soon || undefined}
        onClick={soon ? undefined : onClick}
        className={cn(
          // Every variant's target is 24px or more, 44px on touch (the
          // hit-area utility in globals.css, KAN-557).
          "hit-area relative",
          VARIANTS[variant],
          // Presses in further than a button (90%): a glyph is small, and a
          // smaller squeeze would not read. Colours fade on the same clock.
          "transition-[color,background-color,border-color,transform] duration-150 ease-out focus-visible:outline-none active:scale-90 disabled:pointer-events-none disabled:opacity-50",
          className,
          // After the call site's classes, so no hover or press state outlives it.
          soon && "text-ink-subtle hover:text-ink-subtle cursor-default active:scale-100",
          soon && variant === "outline" && "hover:bg-panel",
        )}
        {...props}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{soon ? `${tooltip}: Coming Soon` : tooltip}</TooltipContent>
    </Tooltip>
  );
}
