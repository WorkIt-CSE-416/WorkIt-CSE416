import type { OpenApplicationResult } from "@/lib/autofill-extension";

/**
 * What the extension's runner did with run/open, as one sentence for the
 * seeker: the second half of Start Auto Apply's note, and a job card's
 * error line (./auto-apply-button.tsx shows only the failures).
 */
export function openedNote(result: OpenApplicationResult): string {
  if (result.opened) return "Your queued jobs are filling in background tabs, five at a time.";
  switch (result.reason) {
    case "not_installed":
      return "Install the WorkIt extension to open the applications.";
    case "queue_empty":
      return "Nothing is queued to open.";
    case "signed_out":
      return "The extension can't see your sign-in. Refresh this page, then try again.";
    case "error":
      return `The extension couldn't open the application: ${result.error}`;
  }
}
