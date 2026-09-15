/**
 * Formats a date-only ISO string (`2026-08-04`) for display.
 *
 * BOTH OPTIONS BELOW ARE DOING REAL WORK. Drop either and it breaks.
 *
 * `timeZone: "UTC"` is why the date shown is the date written. `new Date()`
 * parses a date-only string as UTC midnight, and a viewer east of Greenwich —
 * or in this case west, at UTC-4 — renders that instant on the previous
 * evening, so every date came out a day early. Formatting in UTC keeps a value
 * that has no time component from being pushed across a boundary by one.
 *
 * The explicit `en-US` is why the server and the client agree. An unqualified
 * toLocaleDateString picks up whatever locale the runtime has, which is not the
 * same in Node and in a browser, and React reports the difference as a
 * hydration mismatch.
 *
 * Lives here rather than in company/table.tsx, which it originally shipped
 * with: that module is "use client" for its TanStack table state, and a plain
 * function exported from a client module cannot be called from a Server
 * Component — only rendered as a component or passed down as a prop. A date
 * formatter has no client dependency of its own, so it moved to this
 * framework-free helper instead; company/table.tsx re-exports it so its
 * existing callers are unaffected.
 */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * "3h ago" / "2d ago" / "6w ago" from an ISO timestamp — the same shape the
 * job feed's "Posted 3h ago" flags read, computed here instead of hand-authored
 * per posting. Those flags have no date behind them to compute from, so a
 * literal string is the only option there; a `JobPosting` already carries
 * `postedAt`, and storing the same fact twice, in two formats that drift
 * apart the moment "now" moves on, is the thing to avoid once a real date
 * exists.
 */
export function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();

  if (diff < HOUR) return "just now";
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w ago`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo ago`;
  return `${Math.floor(diff / YEAR)}y ago`;
}
