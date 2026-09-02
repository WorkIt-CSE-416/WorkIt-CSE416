"use client";

import { useState } from "react";
import type { DateRange as DayPickerRange } from "react-day-picker";

import { CalendarIcon, ChevronDownIcon } from "@/components/icons";
import { Calendar, CalendarDayButton } from "@/components/shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import {
  formatRange,
  matchPreset,
  PRESETS,
  SERIES_END,
  SERIES_START,
  toDate,
  toISO,
  useRange,
} from "./range";

/**
 * The window control in the page header.
 *
 * It replaced a <Badge> that only stated the range. A label was the honest
 * rendering while nothing could change the window; now that something can, the
 * control has to look pressable — so this is the canonical Button, in
 * `secondary`, which is the bordered neutral the header's Export button already
 * wears. The two sit side by side and should read as the same kind of control.
 *
 * NAMED WINDOWS ON THE LEFT, A CALENDAR ON THE RIGHT. The list is the fast path
 * and sits first in reading order, so the common case never involves aiming at
 * a day cell; the calendar is for the span that is not on the list. Both write
 * the same state — see the note in ./range.tsx about why the chart's toggle
 * writes there too rather than keeping a window of its own.
 *
 * ONE MONTH, NOT TWO. Two months is the right default for a booking flow, where
 * a range routinely straddles a boundary and you are choosing dates you have
 * not seen. Here the ranges are recent and short — six of the eight presets sit
 * inside a single month — so the second grid mostly showed a month with no data
 * in it while doubling the width of a popover anchored to the page's top-right
 * corner. The month arrows still reach the whole span.
 *
 * IT DOES NOT CLOSE WHEN THE RANGE CHANGES. Picking a window is exploratory:
 * you try a month, look at the shape, try the month before. Closing on every
 * selection turned that into eight round trips through the trigger. It closes
 * on Escape, or on a click outside — Base UI's Popover handles both, which is
 * most of why this is a vendored component and not a div.
 *
 * WHY THE DAY CELLS NEED A COLOUR PASSED IN. shadcn's Calendar styles every day
 * with the `ghost` Button variant, meaning "no chrome, inherit the text
 * colour". WorkIt's `ghost` does not mean that: it is brand-coloured text, on
 * purpose, because four measured call sites draw a section action that way —
 * see the variant table in ./../../../docs/shadcn.md. The two readings collide
 * here and every unselected day rendered brand blue, which made a calendar of
 * ordinary dates look like a calendar of links.
 *
 * The fix is one prop, not a fork. `CalendarDayButton` is exported and puts its
 * `className` last into cn(), so `text-ink` meets `text-brand` in the same
 * utility group and tailwind-merge drops the loser — the mechanism cn.ts exists
 * for. The selected and range days keep their white and their ink because those
 * come from `data-[range-*]:` variants, which are a different group that merging
 * leaves alone and which outrank a bare utility on specificity anyway. The nav
 * chevrons stay brand: they are controls, and brand on a control is the rule
 * this app already follows.
 *
 * BOUNDED TO THE SERIES. The fixture is ninety days, so anything outside it is
 * disabled rather than selectable-and-empty: a chart that draws nothing because
 * you picked March reads as a fault, not as an absence of data. `startMonth`
 * and `endMonth` stop the month arrows at the same edges, so the calendar
 * cannot even navigate somewhere it has nothing to offer.
 */
export function RangePicker() {
  const { range, setRange } = useRange();
  const [open, setOpen] = useState(false);

  /**
   * The half-made range, while a second click is outstanding.
   *
   * A range is two clicks, and after the first one react-day-picker reports
   * `from` with no `to`. That must not reach the page — committing it would
   * scope every flow number to a one-day window nobody asked for — but it does
   * have to reach the CALENDAR, or the first click appears to do nothing at all
   * and the anchor day never highlights. So a draft is held here and the
   * committed range is what the rest of the app sees.
   *
   * Cleared the moment a range completes, so `selected` falls back to the
   * shared range and there is only ever one answer to what is selected.
   */
  const [draft, setDraft] = useState<DayPickerRange | null>(null);

  const active = matchPreset(range, PRESETS);

  /* react-day-picker wants local Dates; the range is ISO. Converted here and
   * nowhere else — see the ISO-versus-Date note in ./range.tsx. */
  const selected: DayPickerRange = draft ?? { from: toDate(range.from), to: toDate(range.to) };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        /* A draft that never got its second click dies with the popover rather
         * than waiting to confuse the next person who opens it. */
        if (!next) setDraft(null);
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="secondary" size="sm">
            <CalendarIcon className="size-3.5" />
            {formatRange(range)}
            <ChevronDownIcon className="text-ink-subtle size-3.5" />
          </Button>
        }
      />

      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <ul className="border-border-subtle flex shrink-0 flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
            {PRESETS.map((preset) => {
              const isActive = active?.label === preset.label;

              return (
                <li key={preset.label}>
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-pressed={isActive}
                    className={cn(
                      "text-note w-full justify-start rounded-[6px] px-2.5 py-1.5",
                      isActive
                        ? "bg-selected text-brand-ink"
                        : "text-ink-meta hover:bg-hover hover:text-ink",
                    )}
                    onClick={() => {
                      setDraft(null);
                      setRange(preset.range);
                    }}
                  >
                    {preset.label}
                  </Button>
                </li>
              );
            })}
          </ul>

          <Calendar
            mode="range"
            selected={selected}
            /* Follows the committed range, so reopening the picker lands on the
             * month you are looking at rather than back on the series end. */
            defaultMonth={toDate(range.from)}
            startMonth={toDate(SERIES_START)}
            endMonth={toDate(SERIES_END)}
            disabled={{ before: toDate(SERIES_START), after: toDate(SERIES_END) }}
            numberOfMonths={1}
            className="p-3"
            components={{
              DayButton: (dayProps) => <CalendarDayButton {...dayProps} className="text-ink" />,
            }}
            onSelect={(next) => {
              if (next?.from && next.to) {
                setDraft(null);
                setRange({ from: toISO(next.from), to: toISO(next.to) });
                return;
              }

              setDraft(next ?? null);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
