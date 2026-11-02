"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowsVerticalIcon,
  FrameCornersIcon,
  MinusIcon,
  PlusIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
} from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";

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
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import type { PageSettings } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

/**
 * How the page is set (KAN-435), as Google Docs keeps it: the common settings
 * on the toolbar while a line is open (`PageTools`), and the rest in Format
 * Options, a panel beside the page, opened from the toolbar's end. On a phone
 * everything is in one sheet (`FormatOptions` with `quick`). Each pick shows on
 * the page, saves on its own, and Undo takes it back.
 *
 * The lists are the API's (`resume_render`), so every value is one the warm
 * font cache and the LaTeX can print. A spacing is a segmented switch and not
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
};

const FONT_SIZES = [10, 11, 12];
const LINE_SPACINGS = [1, 1.15, 1.3];
const MARGINS = [
  { value: 0.5, label: "Narrow" },
  { value: 0.75, label: "Normal" },
  { value: 1, label: "Wide" },
];
const ACCENTS = [
  { value: "#000000", label: "Black" },
  { value: "#1E3A5F", label: "Navy" },
  { value: "#14532D", label: "Forest" },
  { value: "#7F1D1D", label: "Burgundy" },
  { value: "#4C1D95", label: "Plum" },
] as const;

const ON = "bg-brand/10 text-brand hover:bg-brand/10 hover:text-brand";

function Divider() {
  return <span aria-hidden className="bg-border-subtle mx-1 h-5 w-px shrink-0" />;
}

/** A setting's short list as a small menu on the toolbar. */
function ToolMenu({
  label,
  icon,
  value,
  options,
  disabled,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  /** The chosen option, or "" when none is (top and side margins differ). */
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={label}
        title={label}
        render={<Button variant="ghost" size="xs" className="shrink-0" />}
      >
        {icon}
        <ChevronDownIcon className="text-ink-meta size-3" />
      </DropdownMenuTrigger>
      {/* The bar shows these while a line is open, and a press outside the
          bar closes the line, so the menu, in a portal, counts as the bar */}
      <DropdownMenuContent data-keeps-selection align="start" className="w-36">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onPick(next as string)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The toolbar's page settings, as Docs sets them on its bar, while a line
 *  is open. */
export function PageTools({
  page,
  disabled,
  onChange,
}: {
  page: PageSettings;
  disabled: boolean;
  onChange: (next: PageSettings) => void;
}) {
  const at = FONT_SIZES.indexOf(page.font_size);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Smaller font"
        title="Smaller font"
        disabled={disabled || at <= 0}
        onClick={() => onChange({ ...page, font_size: FONT_SIZES[at - 1] })}
      >
        <MinusIcon aria-hidden />
      </Button>
      <span
        aria-label={`Font size, ${page.font_size} points`}
        className="text-note text-ink-muted w-6 text-center font-medium tabular-nums"
      >
        {page.font_size}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Larger font"
        title="Larger font"
        disabled={disabled || at >= FONT_SIZES.length - 1}
        onClick={() => onChange({ ...page, font_size: FONT_SIZES[at + 1] })}
      >
        <PlusIcon aria-hidden />
      </Button>
      <Divider />
      <ToolMenu
        label="Line Spacing"
        icon={<ArrowsVerticalIcon aria-hidden />}
        value={String(page.line_spacing)}
        options={LINE_SPACINGS.map((value) => ({
          value: String(value),
          label: value === 1 ? "1.0" : String(value),
        }))}
        disabled={disabled}
        onPick={(value) => onChange({ ...page, line_spacing: Number(value) })}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Align left"
        title="Align left"
        aria-pressed={page.alignment === "left"}
        disabled={disabled}
        className={cn(page.alignment === "left" && ON)}
        onClick={() => onChange({ ...page, alignment: "left" })}
      >
        <TextAlignLeftIcon aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Justify"
        title="Justify"
        aria-pressed={page.alignment === "justified"}
        disabled={disabled}
        className={cn(page.alignment === "justified" && ON)}
        onClick={() => onChange({ ...page, alignment: "justified" })}
      >
        <TextAlignJustifyIcon aria-hidden />
      </Button>
      <ToolMenu
        label="Margins"
        icon={<FrameCornersIcon aria-hidden />}
        value={page.side_margin === page.top_margin ? String(page.side_margin) : ""}
        options={MARGINS.map((margin) => ({ ...margin, value: String(margin.value) }))}
        disabled={disabled}
        onPick={(value) =>
          onChange({ ...page, side_margin: Number(value), top_margin: Number(value) })
        }
      />
    </div>
  );
}

/** A toolbar button that opens a panel beside the page, tinted while it
 *  is open: Sections, Format Options. */
export function PanelButton({
  label,
  Icon,
  open,
  disabled,
  onToggle,
}: {
  label: string;
  Icon: PhosphorIcon;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-pressed={open}
      title={label}
      disabled={disabled}
      className={cn("shrink-0", open && ON)}
      onClick={onToggle}
    >
      <Icon aria-hidden /> <span className="@max-5xl/main:sr-only">{label}</span>
    </Button>
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

/** A setting's list as a switch across the panel. */
function Choice<K extends keyof PageSettings>({
  label,
  name,
  page,
  options,
  onChange,
}: {
  label: string;
  name: K;
  page: PageSettings;
  options: { value: PageSettings[K]; label: string }[];
  onChange: (next: PageSettings) => void;
}) {
  return (
    <Setting label={label}>
      <SegmentedToggle
        label={label}
        className="w-full"
        value={String(page[name])}
        options={options.map((option) => ({ value: String(option.value), label: option.label }))}
        onValueChange={(to) => {
          const picked = options.find((option) => String(option.value) === to);
          if (picked) onChange({ ...page, [name]: picked.value });
        }}
      />
    </Setting>
  );
}

const points = (values: number[]) =>
  values.map((value) => ({ value, label: value === 0 ? "None" : `${value} pt` }));
const marginOptions = MARGINS.map(({ value }) => ({ value, label: `${value}"` }));

/** Every setting beyond the toolbar's. `quick` adds the toolbar's own too,
 *  for a phone, which has no toolbar for them. */
export function FormatOptions({
  page,
  quick = false,
  onChange,
}: {
  page: PageSettings;
  quick?: boolean;
  onChange: (next: PageSettings) => void;
}) {
  // The order is the Sections panel's: formatting's reset leaves it
  const reset = { ...DEFAULT_PAGE, section_order: page.section_order };
  const changed = JSON.stringify({ ...reset, ...page }) !== JSON.stringify(reset);
  return (
    <>
      {quick && (
        <Group title="Text">
          <Choice
            label="Font Size"
            name="font_size"
            page={page}
            options={FONT_SIZES.map((value) => ({ value, label: `${value} pt` }))}
            onChange={onChange}
          />
          <Choice
            label="Line Spacing"
            name="line_spacing"
            page={page}
            options={LINE_SPACINGS.map((value) => ({
              value,
              label: value === 1 ? "1.0" : String(value),
            }))}
            onChange={onChange}
          />
          <Choice
            label="Alignment"
            name="alignment"
            page={page}
            options={[
              { value: "left", label: "Left" },
              { value: "justified", label: "Justified" },
            ]}
            onChange={onChange}
          />
        </Group>
      )}
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
        <Choice
          label="Bullets"
          name="bullet"
          page={page}
          options={[
            { value: "dot", label: "• Dot" },
            { value: "dash", label: "– Dash" },
          ]}
          onChange={onChange}
        />
        <label className="flex items-center justify-between gap-3">
          <span className="text-note text-ink-muted font-medium">Line Under Section Titles</span>
          <Switch
            checked={page.show_divider}
            onCheckedChange={(checked) => onChange({ ...page, show_divider: checked })}
          />
        </label>
      </Group>
      <Group title="Layout">
        <Choice
          label="Header Alignment"
          name="header_alignment"
          page={page}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" },
          ]}
          onChange={onChange}
        />
      </Group>
      <Group title="Spacing & Margins">
        <Choice
          label="Section Spacing"
          name="section_spacing"
          page={page}
          options={points([0, 4, 8, 12])}
          onChange={onChange}
        />
        <Choice
          label="Entry Spacing"
          name="entry_spacing"
          page={page}
          options={points([0, 2, 4, 6])}
          onChange={onChange}
        />
        <Choice
          label="Top & Bottom Margin"
          name="top_margin"
          page={page}
          options={marginOptions}
          onChange={onChange}
        />
        <Choice
          label="Side Margins"
          name="side_margin"
          page={page}
          options={marginOptions}
          onChange={onChange}
        />
      </Group>
      <Button
        variant="secondary"
        className="shrink-0"
        disabled={!changed}
        onClick={() => onChange(reset)}
      >
        Reset Formatting
      </Button>
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
