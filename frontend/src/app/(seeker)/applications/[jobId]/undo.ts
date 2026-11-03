import type { StageKey } from "../../stage-colors";
import type { ApplicationEvent } from "../../tracker";
import type { NewEvent, NewEventKind, PickableStage } from "../actions";

/**
 * What the tracker's Undo toasts put back (KAN-577), apart from the
 * components so the rules can be tested.
 *
 * A stage pick's Undo is the same PUT with the old stage. The API takes any
 * stage from Applied on, any way, but never Saved (`StageChange`, a record
 * never goes back to a bookmark), so a saved job has no Undo: the menu asks
 * first instead (`asksFirst`).
 */
export function undoStage(from: StageKey): PickableStage | null {
  return from === "saved" ? null : from;
}

/** Whether a pick from `from` asks before it writes: only a saved job's,
 *  the one move Undo cannot take back. */
export const asksFirst = (from: StageKey) => undoStage(from) == null;

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A deleted event as Create Event sends it, for its Undo: the API's own kind
 * (a confirmation only comes from an email, so it never reaches here; it
 * would go back as Other), and a bare date back to `onDay`, an instant to
 * `at` (`toEvent` in ../tracked.ts folds the two into `at`). The event comes
 * back with a new id.
 */
export function readdEvent(event: ApplicationEvent): NewEvent {
  const kind: NewEventKind =
    !event.emailKind || event.emailKind === "confirmation" ? "other" : event.emailKind;
  const day = BARE_DAY.test(event.at);
  return {
    kind,
    title: event.title,
    at: day ? null : event.at,
    onDay: day ? event.at : null,
    endsAt: day ? null : (event.endsAt ?? null),
    note: event.note ?? "",
    meetingUrl: event.meetingUrl ?? "",
  };
}
