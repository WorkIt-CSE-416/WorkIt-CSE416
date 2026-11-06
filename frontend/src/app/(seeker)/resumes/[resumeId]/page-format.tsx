"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react/ssr";
import { useState, type ReactNode } from "react";

import { ChevronDownIcon, CloseIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Switch } from "@/components/shadcn/switch";
import { Button } from "@/components/ui/button";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import type { FontFamily, PageSettings } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { FoldButton } from "./bar-fold";

/**
 * How the resume looks (KAN-435). **The toolbar holds what acts on the line
 * clicked, this panel what acts on the whole resume.** The toolbar names the
 * kind of text it changes (`SizeStepper` under "Body Text"), since a size acts on
 * every line of that kind: an unnamed size beside bold and italic looked as if
 * it acted on the selection, and changed the page. The panel runs in the order
 * a student decides: the Font, then Text Sizes (every kind of text, section
 * headings among them, which have no line to click), then Layout to fit one
 * page, then Style. Each pick shows on the page, saves on its own, and Undo
 * takes it back. On a phone the same panel is a sheet.
 *
 * It fell to five controls on 2026-11-01, which left out the two a resume
 * builder is expected to have: the font, and a size per kind of text. Alignment,
 * the bullet's shape and the header's alignment stayed out, with Spacing one
 * choice over line, section and entry spacing and Margins one over top and side.
 * The API still takes every setting, so a resume already set that way prints as
 * it did, and Reset Formatting clears it.
 *
 * The lists are the API's (`resume_render`), so every value is one the warm
 * font cache and the LaTeX can print. Each is a choice or a stepper and not
 * Jobright's slider: each change compiles the PDF, so a slider would queue a
 * compile for every step it crossed.
 */
export const DEFAULT_PAGE: PageSettings = {
  font_size: 11,
  line_spacing: 1,
  side_margin: 0.5,
  top_margin: 0.5,
  alignment: "left",
  section_spacing: 0,
  entry_spacing: 0,
  accent: "#000000",
  bullet: "dot",
  show_divider: true,
  header_alignment: "center",
  section_order: [
    "education",
    "experience",
    "projects",
    "leadership",
    "awards",
    "certifications",
    "skills",
  ],
  font_family: "latin_modern",
  name_size: null,
  heading_size: null,
  title_size: null,
  body_size: null,
};

/** The fonts a student can pick, serif then sans, each with the look it stands
 *  for. `css` draws it in the open line and in this list: the bundle's file by
 *  its own name, then the system font it matches letter for letter, so a line
 *  being typed sits close to the PDF's. Latin Modern is the page's own webfont
 *  (`latinModern` in the editor), so it has none. */
export const FONTS: { value: FontFamily; label: string; note: string; css?: string }[] = [
  { value: "latin_modern", label: "Latin Modern", note: "Classic" },
  {
    value: "tinos",
    label: "Tinos",
    note: "Like Times New Roman",
    css: 'Tinos, "Times New Roman", Times, serif',
  },
  {
    value: "caladea",
    label: "Caladea",
    note: "Like Cambria",
    css: "Caladea, Cambria, Georgia, serif",
  },
  {
    value: "eb_garamond",
    label: "EB Garamond",
    note: "Like Garamond",
    css: '"EB Garamond", Garamond, Georgia, serif',
  },
  { value: "charter", label: "XCharter", note: "Like Charter", css: "Charter, Georgia, serif" },
  {
    value: "arimo",
    label: "Arimo",
    note: "Like Arial",
    css: "Arimo, Arial, Helvetica, sans-serif",
  },
  { value: "carlito", label: "Carlito", note: "Like Calibri", css: "Carlito, Calibri, sans-serif" },
  { value: "open_sans", label: "Open Sans", note: "Clean", css: '"Open Sans", Arial, sans-serif' },
  { value: "lato", label: "Lato", note: "Modern", css: "Lato, Arial, sans-serif" },
];

// \small and \large in each of article's sizes, as jakes.tex prints them
const SMALL: Record<number, number> = { 10: 9, 11: 10, 12: 10.95 };
const LARGE: Record<number, number> = { 10: 12, 11: 12, 12: 14.4 };

export type TextRole = {
  key: "name_size" | "heading_size" | "title_size" | "body_size";
  label: string;
  /** The API's limits, in points. */
  min: number;
  max: number;
  /** What a press of - or + moves it. */
  step: number;
  /** What it prints at with no size of its own. */
  follows: (page: PageSettings) => number;
};

/** Each kind of text with a size of its own, top to bottom as the page prints
 *  them. */
export const TEXT_ROLES: Record<"name" | "heading" | "title" | "body", TextRole> = {
  name: { key: "name_size", label: "Your Name", min: 14, max: 36, step: 1, follows: () => 24.88 },
  heading: {
    key: "heading_size",
    label: "Section Headings",
    min: 9,
    max: 18,
    step: 1,
    follows: (page) => LARGE[page.font_size] ?? 12,
  },
  title: {
    key: "title_size",
    label: "Job & School Titles",
    min: 8,
    max: 16,
    step: 0.5,
    follows: (page) => page.font_size,
  },
  body: {
    key: "body_size",
    label: "Body Text",
    min: 8,
    max: 14,
    step: 0.5,
    follows: (page) => SMALL[page.font_size] ?? 10,
  },
};

/** The points a kind of text prints at on this page. */
export const sizeOf = (role: TextRole, page: PageSettings) => page[role.key] ?? role.follows(page);

/** Which kind of text a line is. A one-row entry (a project) sets its title in
 *  body type, and Education's location sits on its title's row. */
export function textRoleOf(kind: string, section: string | null) {
  const twoRow = section === "education" || section === "experience" || section === "leadership";
  if (kind === "full_name") return TEXT_ROLES.name;
  if (kind === "title" && twoRow) return TEXT_ROLES.title;
  if (kind === "location" && section === "education") return TEXT_ROLES.title;
  return TEXT_ROLES.body;
}

/** A choice, and the settings it sets. */
type Preset = { label: string; set: Partial<PageSettings> };

const SPACINGS: Preset[] = [
  { label: "Compact", set: { line_spacing: 1, section_spacing: 0, entry_spacing: 0 } },
  { label: "Regular", set: { line_spacing: 1.15, section_spacing: 4, entry_spacing: 2 } },
  { label: "Relaxed", set: { line_spacing: 1.3, section_spacing: 8, entry_spacing: 4 } },
];
const MARGINS: Preset[] = [
  { label: "Narrow", set: { side_margin: 0.5, top_margin: 0.5 } },
  { label: "Normal", set: { side_margin: 0.75, top_margin: 0.75 } },
  { label: "Wide", set: { side_margin: 1, top_margin: 1 } },
];
const ACCENTS = [
  { value: "#000000", label: "Black" },
  { value: "#1E3A5F", label: "Navy" },
  { value: "#14532D", label: "Forest" },
  { value: "#7F1D1D", label: "Burgundy" },
  { value: "#4C1D95", label: "Plum" },
] as const;

/** A toolbar control that is on. */
export const ON = "bg-brand/10 text-brand hover:bg-brand/10 hover:text-brand";

/** A kind of text's size, typed or a step at a time, on the toolbar and in the
 *  panel alike. A typed size applies on Enter or on leaving the field, never on
 *  each key, since each change compiles the PDF. It goes to the nearest half
 *  point inside the role's limits; what is not a number, or Escape, puts the
 *  size back. A size that follows `font_size` (10.95) shows rounded and steps to
 *  the next whole step either way. */
export function SizeStepper({
  role,
  page,
  disabled,
  onChange,
}: {
  role: TextRole;
  page: PageSettings;
  disabled: boolean;
  onChange: (next: PageSettings) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const now = sizeOf(role, page);
  const shown = String(now % 0.5 ? Math.round(now) : now);
  const smaller = (Math.ceil(now / role.step) - 1) * role.step;
  const larger = (Math.floor(now / role.step) + 1) * role.step;
  const set = (size: number) => {
    setTyped(null);
    const inside = Math.min(role.max, Math.max(role.min, size));
    if (Number.isFinite(inside) && String(inside) !== shown) {
      onChange({ ...page, [role.key]: inside });
    }
  };
  const finish = () => set(Math.round(parseFloat(typed ?? "") * 2) / 2);
  return (
    <div role="group" aria-label={role.label} className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={`Smaller ${role.label}`}
        title={`Smaller ${role.label}`}
        disabled={disabled || smaller < role.min}
        onClick={() => set(smaller)}
      >
        <MinusIcon aria-hidden />
      </Button>
      <input
        aria-label={`${role.label} size in points`}
        title={`${role.min} to ${role.max} points`}
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        value={typed ?? shown}
        onChange={(event) => setTyped(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish();
          // With nothing typed, Escape leaves the open line, as anywhere else
          if (event.key === "Escape" && typed !== null) {
            event.stopPropagation();
            setTyped(null);
          }
        }}
        className={cn(FIELD_CONTROL, "sm:text-note h-9 w-11 px-1 text-center font-medium")}
      />
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={`Larger ${role.label}`}
        title={`Larger ${role.label}`}
        disabled={disabled || larger > role.max}
        onClick={() => set(larger)}
      >
        <PlusIcon aria-hidden />
      </Button>
    </div>
  );
}

/** A toolbar button that opens a panel beside the page, tinted while it
 *  is open: Sections, Format Options. `sm`, as every text button on the bar
 *  is (KAN-576): at `xs` it stood 26px with 12px type beside 36px ones. Its
 *  word folds away as the bar narrows (`fold`, ./bar-fold.tsx), leaving the
 *  glyph named by a tooltip; the button's own `hit-area` keeps it 44px on
 *  touch. */
export function PanelButton({
  label,
  Icon,
  fold,
  open,
  disabled,
  onToggle,
}: {
  label: string;
  Icon: PhosphorIcon;
  /** The `FOLD` step that hides the word. */
  fold: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <FoldButton
      label={label}
      icon={<Icon aria-hidden />}
      fold={fold}
      disabled={disabled}
      render={
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={open}
          disabled={disabled}
          className={cn("shrink-0", open && ON)}
          onClick={onToggle}
        />
      }
    />
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-panel max-sm:bg-app flex shrink-0 flex-col gap-3 rounded-xl p-3">
      <h3 className="text-label text-ink font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-note text-ink-muted font-medium">{label}</span>
      {children}
    </div>
  );
}

/** A setting's choices as a switch across the panel. A page set some other
 *  way (an older resume's own spacing) shows none of them picked. */
function Choice({
  label,
  presets,
  page,
  onChange,
}: {
  label: string;
  presets: Preset[];
  page: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  const picked = presets.find(({ set }) =>
    Object.entries(set).every(([name, value]) => page[name as keyof PageSettings] === value),
  );
  return (
    <Setting label={label}>
      <SegmentedToggle
        label={label}
        className="w-full"
        value={picked?.label ?? null}
        options={presets.map((preset) => ({ value: preset.label, label: preset.label }))}
        onValueChange={(to) => {
          const next = presets.find((preset) => preset.label === to);
          if (next) onChange({ ...page, ...next.set });
        }}
      />
    </Setting>
  );
}

/** The font, each drawn in itself, with the look it stands for. */
function FontPicker({
  page,
  onChange,
}: {
  page: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  const current = FONTS.find((font) => font.value === page.font_family) ?? FONTS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Font, ${current.label}`}
        render={<Button variant="secondary" className="w-full justify-between" />}
      >
        <span style={{ fontFamily: current.css }}>{current.label}</span>
        <ChevronDownIcon className="text-ink-meta size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent data-keeps-selection align="start" className="w-(--anchor-width)">
        <DropdownMenuRadioGroup
          value={current.value}
          onValueChange={(to) => onChange({ ...page, font_family: to as FontFamily })}
        >
          {FONTS.map((font) => (
            <DropdownMenuRadioItem key={font.value} value={font.value}>
              <span style={{ fontFamily: font.css }}>{font.label}</span>
              <span className="text-note text-ink-meta ml-auto pr-5">{font.note}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The whole resume's look, in the order a student decides it. */
export function FormatOptions({
  page,
  onChange,
}: {
  page: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  // The order is the Sections panel's: formatting's reset leaves it
  const reset = { ...DEFAULT_PAGE, section_order: page.section_order };
  const changed = JSON.stringify({ ...reset, ...page }) !== JSON.stringify(reset);
  return (
    <>
      <Group title="Font">
        <FontPicker page={page} onChange={onChange} />
      </Group>
      <Group title="Text Sizes">
        {Object.values(TEXT_ROLES).map((role) => (
          <div key={role.key} className="flex items-center justify-between gap-3">
            <span className="text-note text-ink-muted font-medium">{role.label}</span>
            <SizeStepper role={role} page={page} disabled={false} onChange={onChange} />
          </div>
        ))}
      </Group>
      <Group title="Layout">
        <Choice label="Spacing" presets={SPACINGS} page={page} onChange={onChange} />
        <Choice label="Margins" presets={MARGINS} page={page} onChange={onChange} />
      </Group>
      <Group title="Style">
        <Setting label="Accent Color">
          <div role="radiogroup" aria-label="Accent Color" className="flex items-center gap-2">
            {ACCENTS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={page.accent === value}
                aria-label={label}
                title={label}
                style={{ backgroundColor: value }}
                className={cn(
                  "focus-visible:ring-brand-ring ring-offset-panel size-7 rounded-full ring-offset-2 transition-shadow focus-visible:ring-2 focus-visible:outline-none",
                  page.accent === value && "ring-brand ring-2",
                )}
                onClick={() => onChange({ ...page, accent: value })}
              />
            ))}
          </div>
        </Setting>
        <label className="flex items-center justify-between gap-3">
          <span className="text-note text-ink-muted font-medium">Section Lines</span>
          <Switch
            checked={page.show_divider}
            onCheckedChange={(checked) => onChange({ ...page, show_divider: checked })}
          />
        </label>
      </Group>
      {changed && (
        <Button variant="ghost" className="shrink-0" onClick={() => onChange(reset)}>
          Reset Formatting
        </Button>
      )}
    </>
  );
}

/** A panel beside the page, in the Suggestions panel's frame and with its
 *  X, in the same column. One shows at a time. */
export function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="sm:bg-brand-tint sm:ring-brand-pale flex min-h-0 flex-col gap-2 sm:rounded-2xl sm:p-3 sm:ring-1"
    >
      <div className="flex min-h-9 shrink-0 items-center justify-between gap-2">
        <h2 className="text-subtitle text-ink font-semibold">{title}</h2>
        <IconButton label={`Close ${title}`} tooltip="Close" className="size-9" onClick={onClose}>
          <CloseIcon className="size-4.5" />
        </IconButton>
      </div>
      <div className="relative -mr-1.5 flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-none pr-1.5">
        {children}
      </div>
    </section>
  );
}
