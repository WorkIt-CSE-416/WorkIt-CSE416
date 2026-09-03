import Link from "next/link";

import { cn } from "@/lib/cn";

import { BoardIcon, GridIcon, ListIcon } from "./icons";
import { viewHref, type View } from "./views";

/**
 * Picks the layout the applications are drawn in.
 *
 * Links rather than buttons: each option is a real URL, so the choice can be
 * bookmarked and shared, the back button undoes it, and this stays a server
 * component. The trade is that switching is a navigation, which is acceptable
 * for a page already server-rendered from a fixture.
 *
 * The mockup pairs grid and list. Board leads here because it is the default
 * and the richest of the three, so the row reads in the order a new user meets
 * them rather than the order they were designed.
 *
 * `aria-current` is what marks the active option; the raised segment is
 * decoration on top of it. Every option is icon-only, so every option is named.
 */
const OPTIONS: { view: View; label: string; Icon: typeof BoardIcon }[] = [
  { view: "board", label: "Board", Icon: BoardIcon },
  { view: "grid", label: "Grid", Icon: GridIcon },
  { view: "list", label: "List", Icon: ListIcon },
];

export function ViewSwitcher({ current }: { current: View }) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="bg-well border-border-subtle rounded-control flex shrink-0 items-center gap-0.5 border p-0.5"
    >
      {OPTIONS.map(({ view, label, Icon }) => {
        const isActive = view === current;

        return (
          <Link
            key={view}
            href={viewHref(view)}
            aria-label={`${label} view`}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "focus-visible:ring-brand-ring flex size-7 items-center justify-center rounded-[0.375rem] focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "bg-panel text-ink shadow-panel"
                : "text-ink-meta hover:text-ink hover:bg-panel/60",
            )}
          >
            <Icon className="size-4" />
          </Link>
        );
      })}
    </div>
  );
}
