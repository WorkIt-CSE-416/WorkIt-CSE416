import { ViewTransition, type ReactNode } from "react";

/**
 * One item in a view that can be sorted or filtered: an Applications board
 * card, grid card or list row, or a Live Activity row on Auto Apply
 * (KAN-285). The caller keys it by the item, so when the
 * list changes around it, React sees the same item in a new place: it glides
 * there (`reflow` in globals.css) rather than jumping, and an item the filter
 * drops fades out where it stood (`swap-exit`). One that comes back rises in
 * on its own animate-rise, so it takes no enter here.
 *
 * Only inside a view that stays on screen. Switching views, or the board's
 * columns, swaps the whole view instead (the keyed <ViewTransition> in
 * applications/page.tsx), since a card does not become a row by sliding.
 */
export function Reflow({ children }: { children: ReactNode }) {
  return (
    <ViewTransition update="reflow" exit="swap-exit" default="none">
      {children}
    </ViewTransition>
  );
}
