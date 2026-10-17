"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from "@/components/icons";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";

/**
 * The Jobs page's filter controls, shared with onboarding, which asks a new
 * seeker the same questions the filters do (KAN-231). Written for All Filters
 * ((seeker)/jobs/all-filters.tsx) and promoted when onboarding became the
 * second consumer.
 */

/** As the API takes ?pay_per=; the same values filter-query's PayPer holds. */
export type PayPer = "hour" | "year";

type Glyph = ComponentType<{ className?: string }>;

/** `lg` is for a screen where the control is the main question (onboarding):
 *  taller targets, every answer in 16px (text-subtitle, its weight set
 *  explicitly since the token's own is 600) and every note beside one in
 *  14px. `default` fits All Filters' panel. */
export type ControlSize = "default" | "lg";

/** One option: a pill that is pressed or not. Pressed is the brand's tint, as
 *  a picked facet button is in the row. */
export function OptionChip({
  pressed,
  Icon,
  onClick,
  size = "default",
  children,
}: {
  pressed: boolean;
  Icon?: Glyph;
  onClick: () => void;
  size?: ControlSize;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "text-note focus-visible:ring-brand-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-medium transition-[background-color,border-color,color,scale] duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-96",
        size === "lg" && "text-subtitle h-10 px-4",
        pressed
          ? "border-brand bg-brand-tint text-brand"
          : "border-border bg-panel text-ink hover:bg-well",
      )}
    >
      {Icon && <Icon className={cn("size-3.5 shrink-0", !pressed && "text-ink-meta")} />}
      {children}
    </button>
  );
}

/** The dropdown's tallest (15rem), its shortest before it would rather flip,
 *  and its gap from the field. */
const LIST_MAX = 240;
const LIST_MIN = 120;
const LIST_GAP = 8;

export type PickOption = {
  value: string;
  label: string;
  /** Drawn indented under the option before it (a state under its country, a
   *  specialty under its category) while nothing is typed. */
  nested?: boolean;
};

/** A search field that opens a dropdown checklist, and what is ticked as
 *  pills under it, each with a cross to take it off: Location (every place,
 *  each country followed by its states), Role (the twelve categories, each
 *  followed by its specialties) and Start Date (the seasons). The list opens
 *  only from the field (a click, typing or ArrowDown) and floats over the
 *  panel like any dropdown, so the sections below don't move; it stays open
 *  while options are ticked, and
 *  closes on Escape (which stops there, short of closing the panel), on a
 *  press outside, or when focus leaves it. Nothing is suggested before the
 *  seeker looks.
 *
 *  A combobox in the ARIA sense: focus stays in the field, Up and Down move
 *  the active option (aria-activedescendant), Enter ticks it, and the options
 *  are out of the Tab order, so a keyboard user leaves the list with one Tab
 *  rather than one per option. A press on any part of the field or list keeps
 *  focus in the field (preventDefault), so it never blurs the list shut.
 *
 *  Not portaled: it stays inside the panel's scroll area, which has room for
 *  it below the field. */
export function SearchPicker({
  label,
  placeholder,
  empty,
  options,
  values,
  onChange,
  size = "default",
}: {
  /** The list's accessible name, and the picks' ("Picked Places"). */
  label: string;
  placeholder: string;
  /** What the list says when the search matches nothing. */
  empty: string;
  options: PickOption[];
  values: string[];
  onChange: (values: string[]) => void;
  size?: ControlSize;
}) {
  const lg = size === "lg";
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ above: boolean; height: number }>({
    above: false,
    height: LIST_MAX,
  });

  // Where the list fits: below the field, as a dropdown opens, unless the
  // panel's scroll area has less room there than above it (Start Date sits
  // near the panel's foot), and never taller than the room it has. Measured
  // each time it opens; the list used to run past the panel's edge, cut off.
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const area = root.current.closest("[data-panel-scroll]") ?? document.documentElement;
    const box = area.getBoundingClientRect();
    const field = root.current.getBoundingClientRect();
    const below = box.bottom - field.bottom - LIST_GAP;
    const above = field.top - box.top - LIST_GAP;
    const flip = below < LIST_MAX && above > below;
    setPlace({ above: flip, height: Math.max(LIST_MIN, Math.min(LIST_MAX, flip ? above : below)) });
  }, [open]);
  const input = useRef<HTMLInputElement>(null);
  const needle = search.trim().toLowerCase();
  const byValue = new Map(options.map((o) => [o.value, o]));
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const current = Math.min(active, Math.max(shown.length - 1, 0));
  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

  function openList() {
    setOpen(true);
    input.current?.focus();
  }

  // A press anywhere outside the field and its list closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  // Keep the active option in view as the arrows move it; only when it moves,
  // so a wheel scroll through the list isn't pulled back by a re-render.
  const activeId = optionId(current);
  useEffect(() => {
    if (open) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div
        ref={root}
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(event) => {
          // Closes the list, not the panel around it, wherever focus is.
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <label htmlFor={id} className="sr-only">
          {placeholder}
        </label>
        {/* A press on the field's padding or chevron opens the list and
            keeps focus in the input rather than blurring it shut. */}
        <div
          onPointerDown={(event) => {
            if (event.target !== input.current) {
              event.preventDefault();
              openList();
            }
          }}
          className={cn(
            "border-border focus-within:ring-brand-ring flex h-9 cursor-text items-center gap-2 rounded-md border px-2.5 focus-within:ring-2",
            lg && "h-12 gap-3 px-4",
          )}
        >
          <SearchIcon className={cn("text-ink-meta size-4 shrink-0", lg && "size-5")} />
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && shown.length > 0 ? optionId(current) : undefined}
            autoComplete="off"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) return setOpen(true);
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(Math.min(Math.max(current + step, 0), shown.length - 1));
              } else if (event.key === "Enter" && open && shown[current]) {
                event.preventDefault();
                toggle(shown[current].value);
              }
            }}
            placeholder={placeholder}
            className={cn(
              "text-body text-ink placeholder:text-ink-meta min-w-0 flex-1 bg-transparent outline-none",
              lg && "text-subtitle font-normal",
            )}
          />
          <ChevronDownIcon
            className={cn(
              "text-ink-meta size-4 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </div>

        {open && (
          // overscroll-contain: the list's own scroll stops at its ends
          // instead of moving the panel behind it.
          <div
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            // Presses anywhere in the list keep focus in the field.
            onPointerDown={(event) => event.preventDefault()}
            style={{ maxHeight: place.height }}
            className={cn(
              "bg-popover ring-foreground/10 absolute inset-x-0 z-20 flex flex-col overflow-y-auto overscroll-contain rounded-md p-1 shadow-md ring-1",
              place.above ? "bottom-full mb-1" : "top-full mt-1",
            )}
          >
            {shown.length === 0 ? (
              <p className={cn("text-note text-ink-meta px-2 py-1.5", lg && "text-body")}>
                {empty}
              </p>
            ) : (
              shown.map((o, i) => {
                // Indented under its parent, unless a search has pulled it
                // out of that order.
                const nested = o.nested && !needle;
                const checked = values.includes(o.value);
                return (
                  <div
                    key={o.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(o.value)}
                    onPointerMove={() => i !== current && setActive(i)}
                    className={cn(
                      "text-body flex w-full cursor-pointer items-center gap-2.5 rounded-md py-1.5 pr-2 text-left",
                      lg && "text-subtitle py-2.5 font-normal",
                      i === current && "bg-accent",
                      nested ? "pl-7" : "pl-2",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "border-ink-meta text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                        checked && "border-primary bg-primary",
                      )}
                    >
                      <CheckIcon className={cn("size-3.5", !checked && "opacity-0")} />
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate", !nested && "font-medium")}>
                      {o.label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {values.length > 0 && (
        <ul aria-label={`Picked ${label}`} className="flex flex-wrap gap-2">
          {values.map((value) => {
            const name = byValue.get(value)?.label ?? value;
            return (
              <li
                key={value}
                className={cn(
                  "border-brand bg-brand-tint text-brand text-note inline-flex h-8 items-center gap-1 rounded-full border pr-1 pl-3 font-medium",
                  lg && "text-subtitle h-10 pl-4",
                )}
              >
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => toggle(value)}
                  className="hover:bg-brand/10 focus-visible:ring-brand-ring flex size-6 items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-90"
                >
                  <CloseIcon className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Pay as a range, in US dollars, by the hour or the year. A row of presets
 *  per unit in `units` (the caller's, from payUnits in jobs/filter-query:
 *  hourly for internships, yearly for the rest, both for a mix or none) fills
 *  the minimum and leaves the maximum open;
 *  the fields take any figures, either end left empty. A posting matches when
 *  its own pay range overlaps this one, whatever unit it was posted in
 *  (backend queries/jobs/filters.py). */
export function SalaryPicker({
  units,
  presets,
  minPay,
  maxPay,
  payPer,
  onChange,
  size = "default",
}: {
  units: PayPer[];
  presets: Record<PayPer, { value: number; label: string }[]>;
  minPay: number | null;
  maxPay: number | null;
  payPer: PayPer;
  onChange: (minPay: number | null, maxPay: number | null, payPer: PayPer) => void;
  size?: ControlSize;
}) {
  const id = useId();
  const [minText, setMinText] = useState(minPay != null ? String(minPay) : "");
  const [maxText, setMaxText] = useState(maxPay != null ? String(maxPay) : "");
  const parse = (text: string) => {
    const n = Number(text);
    return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
  };
  const per = payPer === "hour" ? "/hr" : "/yr";

  return (
    <div className="flex w-full flex-col gap-3">
      {units.map((unit) => (
        <div key={unit} className="flex flex-wrap items-center gap-2">
          {units.length > 1 && (
            <span className={cn("text-note text-ink-meta w-14", size === "lg" && "text-body w-16")}>
              {unit === "hour" ? "Hourly" : "Yearly"}
            </span>
          )}
          {presets[unit].map((o) => {
            const checked = minPay === o.value && maxPay == null && payPer === unit;
            return (
              <OptionChip
                size={size}
                key={o.value}
                pressed={checked}
                onClick={() => {
                  setMinText(checked ? "" : String(o.value));
                  setMaxText("");
                  onChange(checked ? null : o.value, null, unit);
                }}
              >
                {o.label}
              </OptionChip>
            );
          })}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <MoneyField
          size={size}
          id={`${id}-min`}
          label="Minimum Pay"
          placeholder={payPer === "hour" ? "30" : "80000"}
          unit={per}
          value={minText}
          onChange={(text) => {
            setMinText(text);
            onChange(parse(text), parse(maxText), payPer);
          }}
        />
        <span aria-hidden className="text-ink-meta">
          –
        </span>
        <MoneyField
          size={size}
          id={`${id}-max`}
          label="Maximum Pay"
          placeholder={payPer === "hour" ? "50" : "120000"}
          unit={per}
          value={maxText}
          onChange={(text) => {
            setMaxText(text);
            onChange(parse(minText), parse(text), payPer);
          }}
        />
        <SegmentedToggle
          size={size === "lg" ? "lg" : "sm"}
          label="Pay Unit"
          options={[
            { value: "hour", label: "/hr", ariaLabel: "Per hour" },
            { value: "year", label: "/yr", ariaLabel: "Per year" },
          ]}
          value={payPer}
          // The figures stay; only what they are per changes.
          onValueChange={(value) => onChange(parse(minText), parse(maxText), value as PayPer)}
        />
      </div>
    </div>
  );
}

/** A dollar amount: "$" before the figure and its unit after, inside one
 *  field, so it reads as "$ 30 /hr" without a label to decode. */
function MoneyField({
  id,
  label,
  placeholder,
  unit,
  value,
  onChange,
  size,
}: {
  id: string;
  label: string;
  placeholder: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  size: ControlSize;
}) {
  return (
    <div
      className={cn(
        "border-border focus-within:ring-brand-ring text-body flex h-8 w-36 items-center gap-1 rounded-md border px-2.5 focus-within:ring-2",
        size === "lg" && "text-subtitle h-11 w-44 px-3.5 font-normal",
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span aria-hidden className="text-ink-meta">
        $
      </span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={1}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="text-ink placeholder:text-ink-meta min-w-0 flex-1 [appearance:textfield] bg-transparent tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span aria-hidden className={cn("text-note text-ink-meta", size === "lg" && "text-body")}>
        {unit}
      </span>
    </div>
  );
}
