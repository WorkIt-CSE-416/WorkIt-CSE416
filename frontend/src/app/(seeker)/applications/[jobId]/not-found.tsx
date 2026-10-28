import { ArrowLeftIcon, BookmarkIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";

/**
 * What /applications/[jobId] shows for a job the seeker has not saved or
 * applied to (KAN-256): inside the seeker shell, with the way back to the
 * Applications list, rather than Next's stock 404.
 */
export default function ApplicationNotFound() {
  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <EmptyState
        Icon={BookmarkIcon}
        title="This Application Isn't Here"
        action={
          <ButtonLink href="/applications" variant="secondary" size="sm">
            <ArrowLeftIcon className="size-3.5" />
            Back to Applications Tracker
          </ButtonLink>
        }
      >
        You haven&apos;t saved or applied to this job.
      </EmptyState>
    </div>
  );
}
