import { CloudOff } from "lucide-react";

import { LockIcon } from "@/components/icons";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SIGNED_OUT } from "@/lib/job-queries";

/**
 * A failed load of the company's jobs, in the same <EmptyState> the seeker's
 * /jobs shows when its feed fails. Shared by the jobs list and the composer's
 * edit route, which is why it is a module of its own: a page file cannot
 * export a component.
 *
 * Signed out gets a way back in, since a retry would fail the same way;
 * anything else gets Try Again, with the API's own message underneath in
 * development. A plain <a>, not <Link>, as on /jobs: a full reload is what
 * re-runs the fetch.
 */
export function LoadError({
  error,
  title,
  subject,
  retryHref,
}: {
  error: string;
  /** The heading when the load fails, e.g. "Job postings aren't loading right now". */
  title: string;
  /** What could not be reached, e.g. "your job postings". */
  subject: string;
  /** The page itself, reloaded by Try Again. */
  retryHref: string;
}) {
  if (error === SIGNED_OUT) {
    return (
      <EmptyState
        Icon={LockIcon}
        title="You're signed out"
        action={
          <ButtonLink href="/login" variant="secondary" size="sm">
            Sign In Again
          </ButtonLink>
        }
      >
        Sign in again to see {subject}.
      </EmptyState>
    );
  }

  return (
    <EmptyState
      Icon={CloudOff}
      title={title}
      action={
        <a href={retryHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          Try Again
        </a>
      }
      /* The raw message ("Could not reach the server. Is the backend
         running?", or the API's own) is for whoever runs this locally, not
         for a recruiter, who can't act on it. */
      detail={process.env.NODE_ENV === "development" ? error : undefined}
    >
      We couldn&apos;t reach {subject}. Try again in a few minutes.
    </EmptyState>
  );
}
