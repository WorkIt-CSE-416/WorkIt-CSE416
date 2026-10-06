import { ArrowLeftIcon, BriefcaseIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";

/**
 * What /jobs/[jobId] shows for an id with no Open posting behind it: one that
 * never existed, or a company's Draft or Closed role. Inside the seeker shell,
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
          <ButtonLink href="/jobs" variant="secondary" size="sm">
            <ArrowLeftIcon className="size-3.5" />
            Back to Jobs
          </ButtonLink>
        }
      >
        It may have been filled or taken down.
      </EmptyState>
    </div>
  );
}
