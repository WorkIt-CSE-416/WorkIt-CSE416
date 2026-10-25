import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { ViewSwitcher } from "./view-switcher";

/**
 * The Applications Tracker while the tracker loads (KAN-368). The page
 * awaits the scored tracker read before it draws anything, so without this
 * a click on the sidebar's row changed nothing until that read was done;
 * now the prefetched state below is drawn in the click's next frame
 * (../dashboard/loading.tsx says why only the slow pages have one).
 *
 * It is the page's own frame (./page.tsx): the same width, which takes back
 * half the panel's gain on each side, the title and its line, the layout
 * switch (live: it moves the query in place, as on the page), then the
 * filter bar's search and dropdowns as bars at the widths the real row
 * shows them, and the list's card with rows in a row's shape: the logo,
 * the role and company, then the cells.
 */
export default function ApplicationsLoading() {
  return (
    <div className={cn("-mx-[calc(var(--panel-gain)/2)] flex-1 py-6", SEEKER_GUTTER)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-heading text-ink">Applications Tracker</h1>
          <p className="text-body text-ink-meta mt-1">Track and manage your career progress.</p>
        </div>
        <ViewSwitcher />
      </div>

      <div role="status" className="mt-6 flex flex-col gap-3">
        <span className="sr-only">Loading your applications</span>
        <Skeleton aria-hidden="true" className="h-10 w-full rounded-full @lg/main:w-64" />
        {/* The dropdowns step out at the real row's own container widths
            (./filter-bar.tsx), so the bar holds the same ones. */}
        <div aria-hidden="true" className="@container flex items-center gap-2">
          <Skeleton className="hidden h-9 w-36 @min-[27.5rem]:block" />
          <Skeleton className="hidden h-9 w-36 @min-[37rem]:block" />
          <Skeleton className="hidden h-9 w-36 @min-[46.5rem]:block" />
          <Skeleton className="hidden h-9 w-36 @min-[56rem]:block" />
          <Skeleton className="hidden h-9 w-36 @min-[65.5rem]:block" />
          <Skeleton className="ml-auto h-9 w-28 shrink-0" />
          <Skeleton className="h-9 w-28 shrink-0" />
        </div>
      </div>

      <ListSkeleton />
    </div>
  );
}

/** The list's card: its header row, then rows in a row's shape. */
function ListSkeleton() {
  return (
    <Card padding="none" aria-hidden="true" className="mt-4 overflow-hidden">
      <div className="border-border-subtle flex h-10 items-center gap-6 border-b px-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="ml-auto h-3 w-16" />
        <Skeleton className="hidden h-3 w-16 @2xl/main:block" />
        <Skeleton className="hidden h-3 w-16 @4xl/main:block" />
      </div>
      <ul>
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="border-border-subtle flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
          >
            <Skeleton className="rounded-control size-9 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-48 max-w-full" />
              <Skeleton className="h-3 w-28 max-w-full" />
            </span>
            <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
            <Skeleton className="hidden h-3 w-16 shrink-0 @2xl/main:block" />
            <Skeleton className="hidden h-3 w-16 shrink-0 @4xl/main:block" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
