"use client";

import { CloudOff } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "./gutter";

/**
 * What a seeker screen shows when it throws. The boundary sits inside the
 * shell's layout, so the bar and the panel stay up and only the page area is
 * replaced, with the same calm EmptyState the not-found page uses rather than
 * a blank screen. CloudOff is the glyph /jobs already shows when its feed
 * fails to load, the likeliest cause here too.
 *
 * `retry` rather than `reset`: Next 16's retry re-fetches the segment from the
 * server before re-rendering it, which is what a failed API call needs; reset
 * only re-renders what the browser already has.
 *
 * A client component, as every error boundary must be.
 */
export default function SeekerError({
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
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <EmptyState
        Icon={CloudOff}
        title="Something went wrong"
        action={
          <Button variant="secondary" size="sm" onClick={() => retry()}>
            Try Again
          </Button>
        }
      >
        This page didn&apos;t load. Try again, or come back in a moment.
      </EmptyState>
    </div>
  );
}
