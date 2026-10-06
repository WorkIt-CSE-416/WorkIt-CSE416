import Link from "next/link";

import { cn } from "@/lib/cn";

import { RANGES, type RangeKey } from "./data";

/**
 * The window the Dashboard reports on: This Week, 30 Days, or the whole
 * recruiting season. Links on ?range= rather than client state, the way the
 * applications board's view switcher works, so a window is shareable, survives
 * a reload, and costs no JavaScript — the page re-renders on the server with
 * the new figures.
 */
export function RangeSwitch({ current }: { current: RangeKey }) {
  return (
    <nav
      aria-label="Time Range"
      className="bg-well border-border-subtle rounded-control flex shrink-0 items-center gap-0.5 border p-0.5"
    >
      {RANGES.map(({ key, label }) => {
        const isActive = key === current;

        return (
          <Link
            key={key}
            href={key === "week" ? "/dashboard" : `/dashboard?range=${key}`}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "text-note focus-visible:ring-brand-ring flex h-6.5 items-center rounded-[0.375rem] px-2.5 font-medium focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "bg-panel text-ink ring-border shadow-panel ring-1"
                : "text-ink-meta hover:text-ink hover:bg-panel/60",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
