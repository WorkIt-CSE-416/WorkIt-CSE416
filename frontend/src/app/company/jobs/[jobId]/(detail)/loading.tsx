import { ArrowLeftIcon } from "@/components/icons";
import { Skeleton } from "@/components/shadcn/skeleton";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeadingSkeleton } from "@/components/ui/section-heading";

/**
 * A job posting while it loads (KAN-561): the page's frame (./page.tsx)
 * with Back to Jobs live, then the header's tile, title, meta and the
 * applicant panel, and About the Role, as bars. In this route group so it
 * never stands in for the composer at ../edit.
 */
export default function CompanyJobLoading() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <ButtonLink href="/company/jobs" variant="secondary" size="sm" className="mb-3">
        <ArrowLeftIcon className="size-3.5" />
        Back to Jobs
      </ButtonLink>
      <div role="status">
        <span className="sr-only">Loading the job posting</span>
        <div aria-hidden="true" className="flex flex-col gap-4 @4xl/main:flex-row">
          <Card className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="rounded-control size-12 shrink-0" />
              <div className="flex min-w-0 flex-col gap-2">
                <Skeleton className="h-6 w-64 max-w-full" />
                <Skeleton className="h-3.5 w-40" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </Card>
          <Card className="flex flex-col gap-3 @4xl/main:w-80">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
          </Card>
        </div>
        <div aria-hidden="true" className="mt-8 flex flex-col gap-2">
          <SectionHeadingSkeleton />
          <Skeleton className="mt-1 h-3.5 w-full max-w-[68ch]" />
          <Skeleton className="h-3.5 w-full max-w-[68ch]" />
          <Skeleton className="h-3.5 w-2/3 max-w-[68ch]" />
        </div>
      </div>
    </div>
  );
}
