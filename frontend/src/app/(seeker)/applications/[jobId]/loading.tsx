import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { BackLink } from "../../back-link";
import { SEEKER_GUTTER } from "../../gutter";
import { JobActionBar } from "../../jobs/[jobId]/action-bar";
import { JOB_PAGE_WIDTH, JobViewHeaderSkeleton } from "../../jobs/[jobId]/job-view";

/**
 * One application while the tracker and the job's reads land (KAN-368):
 * the page (./page.tsx) waits on the scored tracker read and on the job
 * page's loader, so a click on a tracker row or card drew nothing new until
 * both answered. Now the prefetched state below is drawn in the click's
 * next frame (../../home/loading.tsx says why only the slow pages have
 * one).
 *
 * PREFETCHING THIS ROUTE IS CHEAP ONLY BECAUSE ITS TITLE IS. A loading
 * boundary makes every visible link to it prefetch, and a prefetch renders
 * the route's head, so generateMetadata reads the job posting alone, never
 * the scored tracker (./page.tsx).
 *
 * The page's own frame: the job page's width, the action bar with Back to
 * the tracker (live) and the tabs' pill as a bar, the job's header card
 * (JobViewHeaderSkeleton, the job page's), then Your Application's card,
 * the tab that opens first, with its rail, and What You Sent.
 */
export default function ApplicationLoading() {
  return (
    <div className={cn(JOB_PAGE_WIDTH, SEEKER_GUTTER)}>
      <JobActionBar
        back={
          <BackLink
            parent={{ href: "/applications", name: "Applications Tracker" }}
            named
            className="group/back"
          />
        }
      >
        <Skeleton aria-hidden="true" className="h-9 w-64 rounded-full" />
      </JobActionBar>

      <div role="status">
        <span className="sr-only">Loading the application</span>
        <JobViewHeaderSkeleton />

        <Card aria-hidden="true" className="@container mt-6">
          <div className="flex flex-col gap-4 @xl:flex-row">
            <div className="flex min-w-0 flex-1 flex-col">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="mt-3 h-6 w-2/3" />
              <Skeleton className="mt-1 h-4 w-1/3" />
              <Skeleton className="mt-5 h-12 w-full" />
              <div className="mt-5 grid grid-cols-1 gap-3 @md:grid-cols-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </div>
            <div className="bg-well rounded-card flex shrink-0 flex-col items-center gap-2 p-4 @xl:w-52">
              <Skeleton className="bg-panel size-16 rounded-full" />
              <Skeleton className="bg-panel h-3 w-24" />
            </div>
          </div>
        </Card>

        <section className="mt-5">
          <SectionHeading>What You Sent</SectionHeading>
          <Skeleton aria-hidden="true" className="mt-3 h-12 w-full" />
        </section>
      </div>
    </div>
  );
}
