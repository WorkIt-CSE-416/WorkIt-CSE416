import { CircleHelp } from "lucide-react";
import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";

export const metadata: Metadata = {
  title: "Help",
  description: "Guides for finding roles, applying and tracking your search.",
};

/**
 * /help, a row in the panel's General group beside Settings. There are no
 * guides yet, so like /settings it says so inside the shell, under the same
 * heading block as every other seeker screen, rather than leaving a row that
 * opens a 404. It offers the one useful next step meanwhile: the feed. A
 * <div>, since SidebarInset is already the <main>.
 */
export default function HelpPage() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">Help</h1>
      <p className="text-body text-ink-meta mt-1">
        Guides for finding roles, applying and tracking your search.
      </p>

      <EmptyState
        Icon={CircleHelp}
        title="Help Is on the Way"
        className="mt-4"
        action={
          <ButtonLink href="/jobs" variant="secondary">
            Browse Jobs
          </ButtonLink>
        }
      >
        Guides and answers to common questions will live here.
      </EmptyState>
    </div>
  );
}
