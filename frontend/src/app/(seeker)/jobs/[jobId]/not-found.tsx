import { BriefcaseIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";
import { BackToJobs } from "./page-actions";

/**
 * What /jobs/[jobId] shows for an id GET /jobs/{id} has no open role for: one
 * that has closed, a company's own posting, or one that never existed. Inside the seeker shell,
 * with the same way back to Jobs the page itself leads with, rather than
 * Next's stock 404 outside the app. The tab title comes from the page's
 * `generateMetadata`, since a segment's not-found file cannot set one.
 */
export default function JobNotFound() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <EmptyState
        Icon={BriefcaseIcon}
        title="This Job Isn't Available"
        action={
          // The same way back as the page's, to the feed with its filters.
          <BackToJobs className="group/back" />
        }
      >
        It may have been filled or taken down.
      </EmptyState>
    </div>
  );
}
