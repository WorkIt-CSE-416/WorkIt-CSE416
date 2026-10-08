import { ViewTransition, type ReactNode } from "react";

/**
 * One application in a view that can be sorted or filtered: a board card, a
 * grid card, a list row. The caller keys it by the application, so when the
 * list changes around it, React sees the same item in a new place: it glides
 * there (`reflow` in globals.css) rather than jumping, and an item the filter
 * drops fades out where it stood (`swap-exit`). One that comes back rises in
 * on its own animate-rise, so it takes no enter here.
 *
 * Only inside a view that stays on screen. Switching views, or the board's
 * columns, swaps the whole view instead (the keyed <ViewTransition> in
 * ./page.tsx), since a card does not become a row by sliding.
 */
export function Reflow({ children }: { children: ReactNode }) {
  return (
    <ViewTransition update="reflow" exit="swap-exit" default="none">
      {children}
    </ViewTransition>
  );
}
