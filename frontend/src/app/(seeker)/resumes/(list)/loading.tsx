import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";
import { RESUMES_SEARCH, ResumesHeader } from "../header";

/**
 * Resumes while both resume lists load (KAN-561): the page's frame
 * (./page.tsx), the Resumes or Experiences switch live, then the search,
 * the filter row and the list's card (../built-resumes.tsx) as bars: a
 * group's heading and its cards. In this route group so it never stands
 * in for the editor or an upload's page, which have their own. A card is
 * `RESUME_ROW`'s box, written out: that module is a client one.
 */
export default function ResumesLoading() {
  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <ResumesHeader
        view="resumes"
        search={<Skeleton aria-hidden="true" className={cn(RESUMES_SEARCH, "h-10 rounded-full")} />}
      />
      <div role="status">
        <span className="sr-only">Loading your resumes</span>
        {/* The real row's grid (../built-resumes.tsx): the buttons take a
            second line below its @2xl. */}
        <div aria-hidden="true" className="@container mt-3">
          <div className="grid grid-cols-2 items-center gap-2 @2xl:flex">
            <Skeleton className="h-9 rounded-full @2xl:w-36" />
            <Skeleton className="h-9 rounded-full @2xl:w-28" />
            <div className="col-span-2 grid grid-cols-2 gap-2 @2xl:ml-auto @2xl:flex">
              <Skeleton className="h-9 @2xl:w-28" />
              <Skeleton className="h-9 @2xl:w-28" />
            </div>
          </div>
        </div>
        <Card padding="none" aria-hidden="true" className="mt-4 px-3 pb-3">
          <div className="flex h-9 items-center pt-2">
            <Skeleton className="h-3 w-20" />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="border-border-subtle bg-well rounded-control mt-2 flex items-center gap-3 border p-2"
            >
              <Skeleton className="size-5 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
                <Skeleton className="h-3.5 w-56 max-w-full" />
                <Skeleton className="h-3 w-32 max-w-full" />
              </span>
              <Skeleton className="size-8 shrink-0" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
