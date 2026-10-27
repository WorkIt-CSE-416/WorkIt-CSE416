import { Skeleton } from "@/components/shadcn/skeleton";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";
import { JobActionBar } from "./action-bar";
import { JOB_PAGE_WIDTH, JobViewHeaderSkeleton } from "./job-view";

/**
 * A job posting's page while its reads land (KAN-368): the page waits on
 * the posting, the resumes, the sent resumes, the stage and the
 * requirements (./job-view.tsx, loadJobView). Opened from a card on the
 * Jobs page, a rail row, Top Matches or Auto Apply, it drew nothing new
 * until all of them answered; now the prefetched state below is drawn in
 * the click's next frame, beside the rail, which the jobs layout keeps
 * mounted (../jobs-rail.tsx). ../../dashboard/loading.tsx says why only
 * the slow pages have one.
 *
 * The page's own frame, so the page replaces it in place: the job page's
 * width, its action bar (live: Back works while it waits) with the actions
 * as bars, the header card as JobDetailHeader draws it (the company line,
 * the title, the facts under their rule), the Key Requirements box and
 * About the Role. Tailor, under this route, has its own (./tailor/
 * loading.tsx), or a job page's skeleton would stand in for it.
 *
 * On a hard load or for an id that is no posting, the page's notFound()
 * now lands inside a streamed response, so the 404 page shows with an HTTP
 * 200; the page still reads the same.
 */
export default function JobLoading() {
  return (
    <div className={cn(JOB_PAGE_WIDTH, SEEKER_GUTTER)}>
      <JobActionBar>
        <ActionsSkeleton />
      </JobActionBar>
      <JobPageSkeleton />
    </div>
  );
}

/** The bar's actions while they load: Save, the menu, Ask Scout, Tailor My
 *  Resume and Apply Now, each its sm button's 36px. */
function ActionsSkeleton() {
  return (
    <span aria-hidden="true" className="flex flex-wrap items-center justify-end gap-2">
      <Skeleton className="size-9" />
      <Skeleton className="size-9" />
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-9 w-28" />
    </span>
  );
}

/** Under the bar: the header card, Key Requirements and About the Role. */
function JobPageSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading the job posting</span>
      <JobViewHeaderSkeleton />

      {/* Key Requirements' box (./key-requirements-visibility.tsx): its
          28px heading row, then three of its label-and-line groups, each
          two 20px lines. */}
      <div aria-hidden="true" className="border-border mt-6 rounded-xl border p-4">
        <div className="flex h-7 items-center">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex h-5 items-center">
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="flex h-5 items-center">
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <section className="mt-5">
        <SectionHeading>About the Role</SectionHeading>
        <div aria-hidden="true" className="mt-3 flex max-w-[68ch] flex-col gap-2">
          {["w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"].map((width, i) => (
            <Skeleton key={i} className={cn("h-4", width)} />
          ))}
        </div>
      </section>
    </div>
  );
}
