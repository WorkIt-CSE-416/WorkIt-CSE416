import { LocalDate } from "../../local-time";

/**
 * "You sent General SWE on Oct 13" (story 98): the last resume the
 * student applied to this posting with, on the viewer's own day
 * (`LocalDate`, which the Resumes view's rows use too).
 */
export function SentNote({ name, at }: { name: string; at: string }) {
  return (
    <p className="text-note text-ink-meta mt-3">
      You sent {name} on <LocalDate at={at} />.
    </p>
  );
}
