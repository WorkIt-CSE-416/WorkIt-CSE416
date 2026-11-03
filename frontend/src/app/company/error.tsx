"use client";

import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * What a company screen shows when it throws (KAN-561), as
 * (seeker)/error.tsx does for a student: the bar and the panel stay up, and
 * the page area shows the failed-load EmptyState of ./jobs/load-error.tsx,
 * which until now only the jobs list and the composer drew. It cannot use
 * LoadError itself: that module reads a server-only constant, and an error
 * boundary is a client component. Try Again is `retry`, which fetches the
 * segment from the server again (the seeker one says why).
 */
export default function CompanyError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <EmptyState
        Icon={CloudSlashIcon}
        title="Something Went Wrong"
        action={
          <Button variant="secondary" size="sm" onClick={() => retry()}>
            Try Again
          </Button>
        }
        detail={process.env.NODE_ENV === "development" ? error.message : undefined}
      >
        This page didn&apos;t load. Try again in a few minutes.
      </EmptyState>
    </div>
  );
}
