"use client";

import { ScissorsIcon, WarningIcon, XIcon } from "@phosphor-icons/react/ssr";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

/**
 * A resume over one page, said once as a toast and kept in the bar as one
 * group (KAN-258). Apart, the bar's amber count and outline Fit to One Page
 * read as two unrelated things, and the small count was easy to miss.
 */

/**
 * The count and its fix as one amber group: the warning glyph and count,
 * a hairline, then Fit to One Page in the same amber. The bar shows the
 * full count; the phone's top bar, short of room, a short one and "Fit".
 */
export function FitNotice({
  label,
  fitLabel = "Fit to One Page",
  onFit,
  disabled,
}: {
  label: string;
  fitLabel?: string;
  onFit: () => void;
  disabled: boolean;
}) {
  return (
    <div className="bg-warning-tint text-warning rounded-control inline-flex items-center">
      <span className="text-label flex items-center gap-1.5 pr-2 pl-3 font-medium">
        <WarningIcon aria-hidden className="size-4 shrink-0" />
        {label}
      </span>
      <span aria-hidden className="bg-warning/25 h-5 w-px" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onFit}
        disabled={disabled}
        aria-label={fitLabel === "Fit to One Page" ? undefined : "Fit to One Page"}
        className="text-warning hover:text-warning hover:bg-warning/10"
      >
        <ScissorsIcon aria-hidden /> {fitLabel}
      </Button>
    </div>
  );
}

/**
 * The toast: when the editor opens on a resume over one page, or an edit
 * pushes one over. It says by how much and offers Fit to One Page; it closes
 * on Fit, on its cross, once the resume fits, or after 10 seconds, since the
 * bar keeps the same fix. role="status": news, not an interruption.
 */
export function FitToast({
  pages,
  linesOver,
  onFit,
  onClose,
  disabled,
  className,
}: {
  pages: number;
  linesOver: number;
  onFit: () => void;
  onClose: () => void;
  disabled: boolean;
  /** Where it sits: the corner on a desktop, above the bottom bar on a phone. */
  className?: string;
}) {
  const over =
    linesOver > 0
      ? `About ${linesOver} ${linesOver === 1 ? "line runs" : "lines run"} onto page 2.`
      : `It runs to ${pages} pages.`;

  return (
    <div
      role="status"
      className={cn(
        "bg-panel ring-border-subtle shadow-lift animate-rise fixed z-50 flex items-start gap-3 rounded-2xl p-4 ring-1",
        className,
      )}
    >
      <span className="bg-warning-tint text-warning flex size-9 shrink-0 items-center justify-center rounded-full">
        <WarningIcon aria-hidden className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body text-ink font-semibold">Over One Page</p>
        <p className="text-note text-ink-meta mt-0.5">
          {over} Fit to One Page hides the least useful lines until it fits.
        </p>
        <Button size="sm" className="mt-3" onClick={onFit} disabled={disabled}>
          <ScissorsIcon aria-hidden /> Fit to One Page
        </Button>
      </div>
      <IconButton label="Dismiss" onClick={onClose}>
        <XIcon aria-hidden className="size-4" />
      </IconButton>
    </div>
  );
}
