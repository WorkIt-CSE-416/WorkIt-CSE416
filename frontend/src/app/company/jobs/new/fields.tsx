import { useState } from "react";

import { ChevronDownIcon, PlusIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Button } from "@/components/ui/button";
import {
  FIELD_CONTROL,
  FIELD_LABEL,
  PICKER_TRIGGER,
  RequiredMark,
} from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { COUNTRIES, formatLocation, type SavedLocation } from "./data";

/**
 * <LocationField>: a searchable picker over a company's saved locations,
 * with room to add one. It lives beside the route because this is its one
 * screen; it builds on FIELD_CONTROL, FIELD_LABEL and PICKER_TRIGGER from
 * ui/text-field.tsx, so it is drawn as every other field is. The composer's
 * multi-line box and date picker moved to src/components on their second
 * consumer (text-area-field.tsx, date-field.tsx, KAN-429).
 *
 * It is built on the vendored Popover rather than shadcn's Combobox/Command:
 * `npx shadcn add command` wants to overwrite ui/button.tsx, ui/input.tsx
 * and shadcn/dialog.tsx (checked with --dry-run), which is exactly the
 * collision docs/shadcn.md says to stop on. Popover is already vendored and
 * untouched by that, the same choice ../../range-picker.tsx made for its
 * calendar.
 */

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
  /** Helper copy under the box, drawn and wired like <TextAreaField>'s. */
  hint?: string;
  /** Visual only — this is a button, not an <input>, so there is no native
   *  `required` attribute to lean on. The composer's own validation is what
   *  actually blocks Continue; see its `missingFields`. */
  required?: boolean;
  /** Outlines the trigger red, the way FIELD_CONTROL draws an aria-invalid
   *  field and <SelectField>'s `invalid` does. Set as a class, because ARIA
   *  does not support aria-invalid on a plain button; the composer's alert
   *  is what names the field aloud. */
  invalid?: boolean;
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
  hint,
  required,
  invalid,
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
              aria-describedby={hint ? `${id}-hint` : undefined}
              className={cn(PICKER_TRIGGER, invalid && "border-danger")}
            >
              <span className={cn("truncate", !selected && "text-ink-meta")}>
                {selected ? formatLocation(selected.city, selected.country) : placeholder}
              </span>
              <ChevronDownIcon className="text-ink-meta size-4 shrink-0" />
            </button>
          }
        />

        <PopoverContent align="start" className="w-72 p-2">
          {adding ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-label text-ink">Add a New Location</p>

              <input
                autoFocus
                aria-label="City"
                placeholder="City"
                value={newCity}
                onChange={(event) => setNewCity(event.target.value)}
                className={cn(FIELD_CONTROL, "px-3 py-1.5")}
              />

              <select
                aria-label="Country"
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
                  Add Location
                </Button>
              </div>
            </div>
          ) : (
            <>
              <input
                autoFocus
                aria-label="Search Locations"
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
                  <li className="text-meta text-ink-meta px-2 py-1.5">No saved locations match.</li>
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
                Add {query ? `"${query}"` : "a New Location"}
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>

      {hint && (
        <p id={`${id}-hint`} className="text-meta text-ink-meta">
          {hint}
        </p>
      )}
    </div>
  );
}
