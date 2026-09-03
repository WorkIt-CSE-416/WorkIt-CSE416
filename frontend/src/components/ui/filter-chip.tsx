import { ChevronDownIcon, CloseIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * One facet in a filter bar: a dropdown until it is applied, removable after.
 *
 * The two states share a shape on purpose — a chip does not move or resize when
 * it becomes active, so applying a filter never reflows the bar. What changes is
 * the outline, the ink and the trailing glyph: a chevron says "there is a menu
 * here", a cross says "there is a choice here you can undo".
 *
 * Written first for the search results pane and promoted when the
 * Jobs filter bar became the second caller. It stays presentational and
 * inert: neither screen has a menu to open yet, and the day one exists it
 * belongs behind this button rather than inside it, so this can stay a server
 * component on screens that render entirely on the server.
 *
 * A count belongs in `label` ("Job type (+2)"), not in a prop of its own — the
 * chip has no opinion about what a facet holds, only about whether it holds
 * anything.
 */
export function FilterChip({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "text-meta focus-visible:ring-brand-ring inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-medium focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-brand text-brand bg-panel"
          : "border-border-subtle text-ink-meta bg-panel hover:text-ink",
      )}
    >
      {label}
      {active ? <CloseIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
    </button>
  );
}
