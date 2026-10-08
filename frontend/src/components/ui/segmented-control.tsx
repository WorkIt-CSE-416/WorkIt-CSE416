"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import Link from "next/link";
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/cn";

/**
 * A row of mutually exclusive options on a pill-shaped track, with a white
 * thumb that slides to the chosen one: the Calendar's Month, Week and Agenda,
 * the Dashboard's range, the Applications layouts, the sign-in card's
 * Applicant or Company, and the company chart's range.
 *
 * WHY THE THUMB SLIDES. The options used to be squared-off segments that
 * swapped a white fill on and off, which read as sharp and abrupt. Now the
 * track and the thumb are both fully round, and the thumb travels to the new
 * option on an ease-out curve (300ms), so a choice reads as one thing moving
 * rather than two things blinking. Under prefers-reduced-motion it jumps.
 *
 * THE OPTIONS ARE EQUAL WIDTH, each as wide as the widest, which is what lets
 * the thumb be positioned with CSS alone: its width is the track's inner
 * width over the option count, and translateX(index * 100%) moves it by
 * whole options. Nothing is measured, so the server renders it in place and
 * there is no jump on hydration.
 *
 * THE TRACK IS A WASH OF INK, not a grey: 5% ink over whatever it sits on, so
 * it reads on the white page and on the sign-in card's off-white alike. No
 * outline: the bar's controls dropped theirs, and so does this.
 *
 * Two forms, for the two ways a choice is kept:
 *
 *   SegmentedLinks   each option is a URL (?view=, ?range=), so the choice is
 *                    shareable and the page re-renders on the server. The
 *                    thumb moves on the click, before the new page arrives,
 *                    so the motion never waits on the network; the page's
 *                    answer then confirms it.
 *   SegmentedToggle  the choice is component state (Applicant or Company, a
 *                    chart's range). Built on Base UI's ToggleGroup, which
 *                    gives it one tab stop and arrow keys. `value` may be
 *                    null, for a chart window that matches no preset: the
 *                    thumb fades out rather than pointing at nothing.
 */

type Size = "sm" | "lg";

const SIZES: Record<
  Size,
  { track: string; thumb: string; inset: string; item: string; iconItem: string }
> = {
  // 32px tall: the height of the buttons these sit beside.
  sm: {
    track: "p-0.5",
    thumb: "inset-y-0.5 left-0.5",
    inset: "4px",
    item: "text-note h-7 px-3",
    iconItem: "h-7 px-2",
  },
  // 44px, for a choice that leads a form.
  lg: {
    track: "p-1",
    thumb: "inset-y-1 left-1",
    inset: "8px",
    item: "text-body h-9 px-4",
    iconItem: "h-9 px-3",
  },
};

const TRACK = "bg-ink/5 relative isolate grid w-fit auto-cols-fr grid-flow-col rounded-full";

const ITEM =
  "focus-visible:ring-brand-ring relative z-10 flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-200 select-none focus-visible:ring-2 focus-visible:outline-none";

function itemClass(size: Size, active: boolean, iconOnly = false) {
  return cn(
    ITEM,
    iconOnly ? SIZES[size].iconItem : SIZES[size].item,
    active ? "text-ink" : "text-ink-meta hover:text-ink",
  );
}

/** The white pill that marks the choice, sliding between equal-width
 *  options. `index` -1 hides it. */
function Thumb({ index, count, size }: { index: number; count: number; size: Size }) {
  const style: CSSProperties = {
    width: `calc((100% - ${SIZES[size].inset}) / ${count})`,
    transform: `translateX(${Math.max(index, 0) * 100}%)`,
    opacity: index < 0 ? 0 : 1,
  };

  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "bg-panel pointer-events-none absolute rounded-full shadow-[0_1px_2px_rgb(18_26_40/0.08),0_2px_8px_rgb(18_26_40/0.08)]",
        "transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        SIZES[size].thumb,
      )}
    />
  );
}

export type SegmentedLinkOption = {
  value: string;
  /** Shown, or for an icon option the accessible name and tooltip. */
  label: string;
  href: string;
  /** Draws the option as this glyph alone, named by `label`. A rendered
   *  element, sized by the caller (`size-4`), not a component: a server
   *  page passes these options, and a component is a function, which cannot
   *  cross into a client one. */
  icon?: ReactNode;
};

/** A plain left click; a modified one opens a tab and leaves this page. */
function isPlainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function SegmentedLinks({
  label,
  options,
  value,
  size = "sm",
  className,
}: {
  /** Names the group for a screen reader: "Calendar View", "Time Range". */
  label: string;
  options: SegmentedLinkOption[];
  value: string;
  size?: Size;
  className?: string;
}) {
  // The option clicked, ahead of the URL catching up. Dropped as soon as the
  // page's own `value` changes, which is the navigation confirming it.
  const [pending, setPending] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(value);
  if (confirmed !== value) {
    setConfirmed(value);
    setPending(null);
  }
  const shown = pending ?? value;

  return (
    <nav aria-label={label} className={cn(TRACK, SIZES[size].track, className)}>
      <Thumb
        index={options.findIndex((option) => option.value === shown)}
        count={options.length}
        size={size}
      />
      {options.map(({ value: optionValue, label: optionLabel, href, icon }) => {
        const link = (
          <Link
            key={optionValue}
            href={href}
            aria-current={optionValue === value ? "true" : undefined}
            aria-label={icon ? optionLabel : undefined}
            onClick={(event) => {
              if (isPlainClick(event)) setPending(optionValue);
            }}
            className={itemClass(size, optionValue === shown, Boolean(icon))}
          >
            {icon ?? optionLabel}
          </Link>
        );

        // An icon says nothing to a sighted reader until it is named, so
        // its name is its tooltip, as IconButton pairs them.
        return icon ? (
          <Tooltip key={optionValue}>
            <TooltipTrigger render={link} />
            <TooltipContent>{optionLabel}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
    </nav>
  );
}

export type SegmentedToggleOption = {
  value: string;
  /** What the option shows. */
  label: string;
  /** Its accessible name, when `label` is abbreviated ("7D"). */
  ariaLabel?: string;
};

export function SegmentedToggle({
  label,
  options,
  value,
  onValueChange,
  size = "sm",
  className,
}: {
  label: string;
  options: SegmentedToggleOption[];
  /** The chosen option, or null when none is (the thumb hides). */
  value: string | null;
  onValueChange: (value: string) => void;
  size?: Size;
  className?: string;
}) {
  return (
    <ToggleGroup
      value={value ? [value] : []}
      // Pressing the pressed option empties the group, which a choice of
      // exactly one cannot be; that change is dropped.
      onValueChange={([next]) => {
        if (next) onValueChange(next as string);
      }}
      aria-label={label}
      className={cn(TRACK, SIZES[size].track, className)}
    >
      <Thumb
        index={options.findIndex((option) => option.value === value)}
        count={options.length}
        size={size}
      />
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          className={itemClass(size, option.value === value)}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
