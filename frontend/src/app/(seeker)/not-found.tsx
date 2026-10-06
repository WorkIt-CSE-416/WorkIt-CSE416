import { ArrowLeftIcon, SearchIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "./gutter";

/**
 * What a seeker screen shows when it calls notFound() and its own segment has
 * no not-found file of its own (/jobs/[jobId] does). It renders inside the
 * shell, with the bar and the panel still there and a way back to the
 * Dashboard, rather than Next's stock 404 outside the app. A URL that matches
 * no route at all is the root not-found's, src/app/not-found.tsx. The body
 * line is that page's and the back link is drawn like /jobs/[jobId]'s, so
 * every 404 a seeker can hit reads alike.
 */
export default function SeekerNotFound() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <EmptyState
        Icon={SearchIcon}
        title="We couldn't find that page"
        action={
          <ButtonLink href="/dashboard" variant="secondary" size="sm">
            <ArrowLeftIcon className="size-3.5" />
            Back to Dashboard
          </ButtonLink>
        }
      >
        The link may be broken, or the page may have moved.
      </EmptyState>
    </div>
  );
}
