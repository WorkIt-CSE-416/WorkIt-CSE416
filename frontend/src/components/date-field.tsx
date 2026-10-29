"use client";

import { format } from "date-fns";
import { useState } from "react";

import { CalendarIcon, ChevronDownIcon } from "@/components/icons";
import { Calendar, CalendarDayButton } from "@/components/shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Button } from "@/components/ui/button";
import { FIELD_LABEL, PICKER_TRIGGER, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

/**
 * A date picked on WorkIt's own calendar, never the browser's: a native
 * `<input type="date">` opens the OS's picker chrome, in none of WorkIt's
 * type or colours (the company composer's closing date first; promoted on
 * its second consumer, Create Event and Apply By, KAN-429).
 *
 * The value is "yyyy-MM-dd", or "" for none, the shape the native input
 * gave, so a field it replaces keeps its state as it was.
 *
 * CLEARING IS A BUTTON IN THE POPOVER, NOT AN ICON ON THE TRIGGER, for an
 * optional field (`clearable`): react-day-picker's single mode toggles a day
 * off on a second click, which nothing suggests, and an icon inside the
 * trigger would nest one control in another.
 *
 * `captionLayout="dropdown"` swaps the month and year caption for two
 * selects, so next spring is one pick, not a dozen clicks on the arrow. It
 * needs `startMonth` and `endMonth`: unbounded, react-day-picker's year
 * select runs 100 years back and stops at the end of this year.
 */
export function DateField({
  id,
  label,
  value,
  onValueChange,
  placeholder = "Select a date",
  required,
  clearable,
  from,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** Visual only, as <SelectField>'s: the trigger is a button. */
  required?: boolean;
  /** Shows Clear in the popover once a day is picked. */
  clearable?: boolean;
  /** The first day that can be picked (a closing date is never past); none
   *  lets the student pick a past day, as for an interview already held. */
  from?: Date;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDay(value);
  const today = new Date();

  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-label`} htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <RequiredMark />}
      </label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          render={
            <button
              type="button"
              id={id}
              aria-labelledby={`${id}-label`}
              className={PICKER_TRIGGER}
            >
              <span
                className={cn(
                  "flex min-w-0 items-center gap-2 truncate",
                  !selected && "text-ink-meta",
                )}
              >
                <CalendarIcon className="text-ink-meta size-4 shrink-0" />
                {selected ? format(selected, "MMM d, yyyy") : placeholder}
              </span>
              <ChevronDownIcon className="text-ink-meta size-4 shrink-0" />
            </button>
          }
        />

        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            selected={selected}
            defaultMonth={selected ?? today}
            startMonth={from ?? new Date(today.getFullYear() - 1, 0)}
            endMonth={new Date(today.getFullYear() + 5, 11)}
            /* `startMonth` only stops navigating back a month: the days
               before `from` in the month it opens on stay clickable
               without this. */
            disabled={from ? { before: from } : undefined}
            /* The weekday row onto --text-note, as on company/range-picker.tsx. */
            className="[&_.rdp-weekday]:text-note"
            onSelect={(date) => {
              if (date) onValueChange(dayValue(date));
              else if (clearable) onValueChange("");
              setOpen(false);
            }}
            /* WorkIt's `ghost` button reads as brand link text, not "no
               chrome, inherit colour" as shadcn's Calendar assumes: the long
               note on company/range-picker.tsx. */
            components={{
              DayButton: (dayProps) => <CalendarDayButton {...dayProps} className="text-ink" />,
            }}
          />

          {clearable && value && (
            <div className="border-border-subtle border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center"
                onClick={() => {
                  onValueChange("");
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** "yyyy-MM-dd" as a local day, or undefined for "". */
function parseDay(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** A local day back to "yyyy-MM-dd". */
function dayValue(date: Date) {
  return format(date, "yyyy-MM-dd");
}
