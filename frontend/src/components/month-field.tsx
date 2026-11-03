"use client";

import { useState } from "react";

import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { FIELD_LABEL, PICKER_TRIGGER, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A month picked from WorkIt's own grid, never the browser's: the
 * <DateField> pattern (its trigger, its popover, Clear for an optional one)
 * with a year and its twelve months in place of a calendar (KAN-559). A
 * native `<input type="month">` opened Chrome's own picker, the OS chrome
 * KAN-429 banned for dates, and drew an empty one as "--------- ----".
 * The Experiences entry editor's Start, End and Award months.
 *
 * The value is "yyyy-MM", or "" for none, the shape the native input gave.
 *
 * `required` marks the label, and a hidden input carries it to the form's
 * own check, so a Save with no month stops at the field as the native one
 * did: the trigger is a button, which a form cannot require.
 */
export function MonthField({
  id,
  label,
  value,
  onValueChange,
  placeholder = "Select a month",
  required,
  clearable,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  /** Shows Clear in the popover once a month is picked. */
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const picked = parseMonth(value);
  const [year, setYear] = useState(() => picked?.year ?? new Date().getFullYear());

  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-label`} htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <RequiredMark />}
      </label>

      <Popover
        open={open}
        onOpenChange={(next) => {
          // Each opening starts on the picked month's year, or this one.
          if (next) setYear(picked?.year ?? new Date().getFullYear());
          setOpen(next);
        }}
      >
        <div className="relative">
          <PopoverTrigger
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
                    !picked && "text-ink-meta",
                  )}
                >
                  <CalendarIcon className="text-ink-meta size-4 shrink-0" />
                  {picked ? `${MONTHS[picked.month - 1]} ${picked.year}` : placeholder}
                </span>
                <ChevronDownIcon className="text-ink-meta size-4 shrink-0" />
              </button>
            }
          />
          {required && (
            <input
              aria-hidden
              tabIndex={-1}
              required
              value={value}
              onChange={() => {}}
              className="pointer-events-none absolute inset-0 opacity-0"
            />
          )}
        </div>

        <PopoverContent align="start" className="w-64 p-3">
          <div className="flex items-center justify-between">
            <IconButton
              label="Previous Year"
              className="size-8"
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeftIcon className="size-4" />
            </IconButton>
            <span className="text-label text-ink tabular-nums" aria-live="polite">
              {year}
            </span>
            <IconButton label="Next Year" className="size-8" onClick={() => setYear((y) => y + 1)}>
              <ChevronRightIcon className="size-4" />
            </IconButton>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1">
            {MONTHS.map((name, i) => {
              const on = picked?.year === year && picked.month === i + 1;
              return (
                <Button
                  key={name}
                  variant={on ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={on}
                  // WorkIt's `ghost` is brand link text; a month is a pick.
                  className={on ? undefined : "text-ink"}
                  onClick={() => {
                    onValueChange(monthValue(year, i + 1));
                    setOpen(false);
                  }}
                >
                  {name}
                </Button>
              );
            })}
          </div>

          {clearable && value && (
            <div className="border-border-subtle mt-2 border-t pt-2">
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

/** "yyyy-MM" as a year and a 1-based month, or undefined for "". */
function parseMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function monthValue(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}
