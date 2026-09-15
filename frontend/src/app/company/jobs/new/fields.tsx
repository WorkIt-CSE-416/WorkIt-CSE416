import { format } from "date-fns";
import type { ComponentProps } from "react";
import { useState } from "react";

import { CalendarIcon, ChevronDownIcon } from "@/components/icons";
import { Calendar, CalendarDayButton } from "@/components/shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FIELD_CONTROL, FIELD_LABEL, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import {
  COUNTRIES,
  formatCloseDateValue,
  formatLocation,
  parseCloseDate,
  type SavedLocation,
} from "./data";
import { PlusIcon } from "./icons";

/**
 * The controls this form needs that <TextField> is not: a multi-line box, a
 * single picker, a date picker, and a searchable picker over a company's
 * saved locations with room to add one.
 *
 * They live beside the route rather than in src/components/ui because this is
 * the only screen that has one of each — the repo promotes on the second
 * consumer, not in anticipation of one. What they do not do is restate the
 * styling: all four build on FIELD_CONTROL and FIELD_LABEL from
 * ui/text-field.tsx, so the controls on this form are one box drawn several
 * times rather than several boxes that currently agree. Move the file, not the
 * classes, when a second form wants them.
 *
 * <LocationField> is built on the vendored Popover rather than shadcn's
 * Combobox/Command: `npx shadcn add command` wants to overwrite ui/button.tsx,
 * ui/input.tsx and shadcn/dialog.tsx (checked with --dry-run), which is
 * exactly the collision docs/shadcn.md says to stop on. Popover is already
 * vendored and untouched by that, so the picker is built from it — the same
 * choice ../../range-picker.tsx already made for its calendar. <DateField>
 * reuses that same Popover-plus-<Calendar> pairing (and the same
 * `text-ink`-on-`CalendarDayButton` fix — see the long note on
 * ../../range-picker.tsx for why the override is needed) rather than the
 * native `<input type="date">` this field used before: a native date input
 * renders the OS's own picker chrome, which does not draw in WorkIt's own
 * type or colours the way every other control on this screen does.
 */

type TextAreaFieldProps = {
  id: string;
  label: string;
  /** Helper copy under the box — "Use Markdown for formatting." */
  hint?: string;
} & Omit<ComponentProps<"textarea">, "id" | "className">;

export function TextAreaField({
  id,
  label,
  hint,
  rows = 6,
  required,
  ...textarea
}: TextAreaFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <RequiredMark />}
      </label>

      {/* resize-y, not the browser default of both: horizontal resize would
          drag the textarea out past the card it sits in. */}
      <textarea
        id={id}
        rows={rows}
        required={required}
        className={cn(FIELD_CONTROL, "resize-y px-3.5 py-2")}
        {...textarea}
      />

      {hint && (
        <p id={`${id}-hint`} className="text-meta text-ink-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  /** Shown when nothing is selected. Omit for a field that opens on a value. */
  placeholder?: string;
  /** Keep the label for assistive tech but take it off the screen — for a
   *  picker whose column or neighbours already say what it sets. It is never
   *  dropped outright: an unnamed combobox is announced as its current value
   *  and nothing else. */
  hideLabel?: boolean;
  /** Visual only, same as <LocationField>'s — the trigger is a button, not a
   *  native <select>, so there is no `required` attribute to lean on. */
  required?: boolean;
  className?: string;
};

/**
 * A labelled picker, styled to sit in a row beside <TextField> without looking
 * like it came from somewhere else.
 *
 * WHY THE LABEL IS WIRED WITH aria-labelledby AND NOT JUST htmlFor: the trigger
 * is not a <select>. Base UI renders it as a <button role="combobox">, and a
 * button takes its accessible name from its own contents — a <label for> is
 * ignored on it, which would leave this field announced as "Engineering" with
 * no hint that Engineering is a department. Pointing aria-labelledby at the
 * label is what names it; the htmlFor stays because it is what makes clicking
 * the word focus the control. `${id}-label` is Base UI's own convention for the
 * id, so the two agree if a Field wrapper is ever added around this.
 *
 * The vendored trigger's own classes are stock shadcn — 32px tall, text-sm,
 * rounded-lg — which is a different control from WorkIt's input. They are
 * overridden here rather than in src/components/shadcn/select.tsx, which
 * `shadcn add` regenerates.
 */
export function SelectField({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  hideLabel = false,
  required,
  className,
}: SelectFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label id={`${id}-label`} htmlFor={id} className={cn(FIELD_LABEL, hideLabel && "sr-only")}>
        {label}
        {required && <RequiredMark />}
      </label>

      {/* No `items` prop: it exists so <SelectValue> can render a label for a
          value that is not itself display text, and here the two are the same
          string. onValueChange is adapted because Base UI's own signature
          widens to `string | null` — clearing is not reachable from this
          field, but the type says it is. */}
      <Select value={value} onValueChange={(next) => onValueChange(next ?? "")}>
        {/* THE HEIGHT OVERRIDE IS WRITTEN TWICE, and the duplicate is the
            whole point. FIELD_CONTROL has no height — it is sized by its
            padding, the way the input beside it is — but the stock trigger
            pins one, and it pins it as `data-[size=default]:h-8`. A bare
            `h-auto` does not touch that: tailwind-merge groups by variant as
            well as by property, so a plain utility and a data-variant one are
            different groups and both survive. The variant then wins on
            specificity — `.h-8[data-size="default"]` outranks `.h-auto` — and
            the picker renders 32px tall next to a 38px input. Repeating the
            override under the same variant is what puts the two in one group
            so cn() can drop the loser. This is the failure cn() cannot close
            on its own, described in lib/cn.ts and in CLAUDE.md.

            The paddings are separate groups from anything the trigger sets,
            so those are simply added. */}
        <SelectTrigger
          id={id}
          aria-labelledby={`${id}-label`}
          className={cn(FIELD_CONTROL, "h-auto data-[size=default]:h-auto", "py-2 pr-3 pl-3.5")}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>

        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Shared by <LocationField> and <DateField> below: a button styled like the
 *  other fields' boxes, opening on click rather than a native <select>. */
const PICKER_TRIGGER = cn(
  FIELD_CONTROL,
  "flex items-center justify-between gap-2 px-3.5 py-2 text-left",
);

type LocationFieldProps = {
  id: string;
  label: string;
  value: string | null;
  onValueChange: (locationId: string) => void;
  options: SavedLocation[];
  onAddLocation: (location: Omit<SavedLocation, "id">) => string;
  /** Shown on the trigger when nothing is picked. Defaults to "Select a
   *  location"; the composer overrides it for Remote, where nothing picked
   *  means open to anywhere rather than an unanswered required field. */
  placeholder?: string;
  /** Visual only — this is a button, not an <input>, so there is no native
   *  `required` attribute to lean on. The composer's own validation is what
   *  actually blocks Continue; see its `missingFields`. */
  required?: boolean;
};

/**
 * A searchable picker over the company's saved locations, with room to add
 * one that isn't there yet.
 *
 * Neither a flat list of every city on Earth nor an unconstrained free-text
 * box: the first is unusable, the second can't be filtered or validated
 * against `location_city`/`location_country`. A company's own list is small
 * enough to pick from and grows exactly when it needs to.
 */
export function LocationField({
  id,
  label,
  value,
  onValueChange,
  options,
  onAddLocation,
  placeholder = "Select a location",
  required,
}: LocationFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCity, setNewCity] = useState("");
  const [newCountry, setNewCountry] = useState<string>(COUNTRIES[0].code);

  const selected = options.find((location) => location.id === value);
  const filtered = options.filter((location) =>
    formatLocation(location.city, location.country).toLowerCase().includes(query.toLowerCase()),
  );

  function reset() {
    setQuery("");
    setAdding(false);
    setNewCity("");
    setNewCountry(COUNTRIES[0].code);
  }

  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-label`} htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <RequiredMark />}
      </label>

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              id={id}
              aria-labelledby={`${id}-label`}
              className={PICKER_TRIGGER}
            >
              <span className={cn("truncate", !selected && "text-ink-faint")}>
                {selected ? formatLocation(selected.city, selected.country) : placeholder}
              </span>
              <ChevronDownIcon className="text-ink-faint size-4 shrink-0" />
            </button>
          }
        />

        <PopoverContent align="start" className="w-72 p-2">
          {adding ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-label text-ink">Add a new location</p>

              <input
                autoFocus
                placeholder="City"
                value={newCity}
                onChange={(event) => setNewCity(event.target.value)}
                className={cn(FIELD_CONTROL, "px-3 py-1.5")}
              />

              <select
                value={newCountry}
                onChange={(event) => setNewCountry(event.target.value)}
                className={cn(FIELD_CONTROL, "px-3 py-1.5")}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>

              <div className="mt-1 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!newCity.trim()}
                  onClick={() => {
                    const locationId = onAddLocation({
                      city: newCity.trim(),
                      country: newCountry,
                    });
                    onValueChange(locationId);
                    setOpen(false);
                    reset();
                  }}
                >
                  Add location
                </Button>
              </div>
            </div>
          ) : (
            <>
              <input
                autoFocus
                placeholder="Search locations…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={cn(FIELD_CONTROL, "px-3 py-1.5")}
              />

              <ul className="mt-1.5 flex max-h-48 flex-col overflow-y-auto">
                {filtered.map((location) => (
                  <li key={location.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onValueChange(location.id);
                        setOpen(false);
                        reset();
                      }}
                      className="hover:bg-hover text-body text-ink w-full rounded-md px-2 py-1.5 text-left"
                    >
                      {formatLocation(location.city, location.country)}
                    </button>
                  </li>
                ))}

                {filtered.length === 0 && (
                  <li className="text-meta text-ink-faint px-2 py-1.5">
                    No saved locations match.
                  </li>
                )}
              </ul>

              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setNewCity(query);
                }}
                className="text-label text-brand mt-1.5 flex items-center gap-1 rounded-md px-2 py-1 hover:underline"
              >
                <PlusIcon className="size-3.5" />
                Add {query ? `"${query}"` : "a new location"}
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

type DateFieldProps = {
  id: string;
  label: string;
  /** "yyyy-mm-dd", or "" for unset — the same shape `<input type="date">`
   *  produced, so the field this replaced needed no change to `JobDraft`. */
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
};

/**
 * A single-date picker built on <Calendar>, styled to sit in this form rather
 * than announce itself as a vendored component — see the file-level note for
 * why this exists instead of `<input type="date">`.
 *
 * CLEARING IS A BUTTON IN THE POPOVER, NOT AN ICON ON THE TRIGGER. This field
 * is optional ("Applications Close (optional)"), so it needs a way back to
 * empty. react-day-picker's single mode already toggles a date off when it is
 * clicked again, but that is not discoverable — nothing about a filled day
 * cell suggests clicking it a second time undoes it. Sitting the trigger
 * button inside a <button> for an icon that also clears would additionally
 * mean nesting one interactive control inside another, which the trigger's
 * own onClick would swallow. A plain "Clear" button under the calendar, shown
 * once there is something to clear, avoids both problems.
 *
 * `captionLayout="dropdown"` swaps the month/year caption for two selects, so
 * jumping to, say, next spring is one pick rather than a dozen clicks on the
 * next-month arrow. It needs `startMonth`/`endMonth` set explicitly —
 * react-day-picker's own note on the prop says an unbounded dropdown defaults
 * to 100 years back and only the end of the current year forward, which for a
 * closing date (always today or later) would make the year select mostly
 * unusable history and not even reach next year.
 */
export function DateField({ id, label, value, onValueChange, placeholder }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = parseCloseDate(value);
  const today = new Date();

  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-label`} htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>

      <Popover open={open} onOpenChange={setOpen}>
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
                  !selected && "text-ink-faint",
                )}
              >
                <CalendarIcon className="text-ink-faint size-4 shrink-0" />
                {selected ? format(selected, "MMM d, yyyy") : (placeholder ?? "Select a date")}
              </span>
              <ChevronDownIcon className="text-ink-faint size-4 shrink-0" />
            </button>
          }
        />

        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            selected={selected}
            defaultMonth={selected ?? today}
            startMonth={today}
            endMonth={new Date(today.getFullYear() + 5, 11)}
            /* `startMonth` only stops navigating to an earlier month — days
               before today within the month it opens on are still visible
               and, without this, still clickable. A closing date earlier
               than today is never valid. */
            disabled={{ before: today }}
            onSelect={(date) => {
              onValueChange(date ? formatCloseDateValue(date) : "");
              setOpen(false);
            }}
            /* WorkIt's `ghost` button reads as brand-coloured link text, not
               "no chrome, inherit colour" the way shadcn's Calendar assumes —
               see the long note on ../../range-picker.tsx. Same fix here. */
            components={{
              DayButton: (dayProps) => <CalendarDayButton {...dayProps} className="text-ink" />,
            }}
          />

          {value && (
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
