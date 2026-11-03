import { Skeleton } from "@/components/shadcn/skeleton";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Job Postings while the company's jobs load (KAN-561): the page's frame
 * (./page.tsx) with Post a Job live, the title and its line as bars, then
 * the table's search and filters and rows in a row's shape. In this route
 * group so it never stands in for the composer or a posting's page.
 */
export default function CompanyJobsLoading() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div aria-hidden="true" className="flex min-w-0 flex-col">
          <div className="flex h-8 items-center">
            <Skeleton className="h-6 w-44" />
          </div>
          <div className="mt-1 flex h-5 items-center">
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
        </div>
        <ButtonLink href="/company/jobs/new" size="sm" className="shrink-0">
          Post a Job
        </ButtonLink>
      </div>
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Loading your job postings</span>
        <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 w-64 max-w-full rounded-full" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Card padding="none" aria-hidden="true" className="overflow-hidden">
          <div className="border-border-subtle flex h-10 items-center gap-6 border-b px-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-3 w-16" />
            <Skeleton className="hidden h-3 w-16 @2xl/main:block" />
            <Skeleton className="hidden h-3 w-16 @4xl/main:block" />
          </div>
          <ul>
            {Array.from({ length: 5 }, (_, i) => (
              <li
                key={i}
                className="border-border-subtle flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-48 max-w-full" />
                  <Skeleton className="h-3 w-28 max-w-full" />
                </span>
                <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
                <Skeleton className="hidden h-3 w-10 shrink-0 @2xl/main:block" />
                <Skeleton className="hidden h-3 w-16 shrink-0 @4xl/main:block" />
                <Skeleton className="size-7 shrink-0" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
