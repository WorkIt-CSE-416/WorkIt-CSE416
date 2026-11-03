/**
 * Whether a click on a clickable row (components/clickable-row.tsx) belongs
 * to something else, so the row must not open its page.
 *
 * Two cases. A click on a link, a button or a menu item inside the row is
 * left to it. A click from outside the row is never the row's: a menu,
 * dialog or popover drawn in a portal sits elsewhere in the page, but React
 * still passes its clicks up to the row it was opened from. Up Next's ⋯
 * menu (KAN-566) opened the job page on Change Resume, I Already Applied and
 * Remove From Queue, since its items are `role="menuitem"` divs in a portal
 * and the old check knew only links and buttons.
 *
 * Typed by shape, not by DOM types, so a test can call it without a DOM.
 */
export function clickIsNotRows(
  row: { contains(node: never): boolean },
  target: { closest(selectors: string): unknown } | null,
): boolean {
  if (!target || !row.contains(target as never)) return true;
  return target.closest('a, button, [role="menuitem"]') != null;
}
