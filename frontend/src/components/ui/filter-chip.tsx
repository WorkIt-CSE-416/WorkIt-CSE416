import { ChevronDownIcon, CloseIcon } from "@/components/icons";

import { chipClasses } from "./chip";

/**
 * One facet in a filter bar: a dropdown until it is applied, removable after.
 *
 * The two states share a shape on purpose — a chip does not move or resize when
 * it becomes active, so applying a filter never reflows the bar. What changes is
 * the outline, the ink and the trailing glyph: a chevron says "there is a menu
 * here", a cross says "there is a choice here you can undo".
 *
 * Drawn as a choice Chip (ui/chip.tsx), pressed once applied, so it is the
 * same pill as every other chip (KAN-251). No screen uses it today: the Jobs
 * filter row's facets open menus, so they are sm secondary buttons
 * (jobs/filters.tsx), and the Applications stage chips are ChipLinks. It
 * stays presentational and inert, a server component.
 *
 * A count belongs in `label` ("Job type (+2)"), not in a prop of its own — the
 * chip has no opinion about what a facet holds, only about whether it holds
 * anything.
 */
export function FilterChip({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      // The cross is drawn, not spoken, so an applied chip names what clicking
      // it does; an unapplied one has no menu behind it yet to describe.
      aria-label={active ? `Remove ${label} filter` : undefined}
      className={chipClasses({ pressed: active })}
    >
      {label}
      {active ? <CloseIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
    </button>
  );
}
