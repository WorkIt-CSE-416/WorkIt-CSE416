import { QuestionIcon } from "@phosphor-icons/react/ssr";
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
 * /help, a row in the account menu the bar's photo opens, beside Settings. There are no
 * guides yet, so like /settings it says so inside the shell, rather than leaving a row that
 * opens a 404. Its title is in the top bar. It offers the one useful next step meanwhile: the feed. A
 * <div>, since SidebarInset is already the <main>.
 */
export default function HelpPage() {
  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <EmptyState
        Icon={QuestionIcon}
        title="Help Is on the Way"
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
