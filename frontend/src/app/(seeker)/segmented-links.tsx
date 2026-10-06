import Link from "next/link";

import { cn } from "@/lib/cn";

/**
 * A row of mutually exclusive choices, each a link: the Dashboard's time
 * range and the Calendar's Month, Week and Agenda. Links on the query string
 * rather than client state, so a choice is shareable, survives a reload and
 * costs no JavaScript: the page re-renders on the server.
 *
 * The same well as the Applications view switcher, with words instead of
 * icons. `aria-current` marks the choice in force; the raised segment is
 * decoration on top of it, with a 1px ring because white on the well's grey
 * is 1.07:1.
 */
export type SegmentedOption = { key: string; label: string; href: string };

export function SegmentedLinks({
  label,
  options,
  current,
}: {
  /** Names the group for a screen reader: "Time Range", "Calendar View". */
  label: string;
  options: SegmentedOption[];
  current: string;
}) {
  return (
    <nav
      aria-label={label}
      className="bg-well border-border-subtle rounded-control flex shrink-0 items-center gap-0.5 border p-0.5"
    >
      {options.map(({ key, label: text, href }) => {
        const isActive = key === current;

        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "text-note focus-visible:ring-brand-ring flex h-6.5 items-center rounded-[0.375rem] px-2.5 font-medium focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "bg-panel text-ink ring-border shadow-panel ring-1"
                : "text-ink-meta hover:text-ink hover:bg-panel/60",
            )}
          >
            {text}
          </Link>
        );
      })}
    </nav>
  );
}
