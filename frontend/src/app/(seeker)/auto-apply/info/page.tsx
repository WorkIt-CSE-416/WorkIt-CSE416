import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { getAutofillAnswers } from "@/lib/autofill-answers-actions";
import { getBank } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { BackLink } from "../../back-link";
import { SEEKER_GUTTER } from "../../gutter";
import { InfoScreen } from "./info-screen";

export const metadata: Metadata = {
  title: "Application Info",
  description: "The answers and files WorkIt fills into your applications.",
};

/**
 * /auto-apply/info — Application Info (KAN-550): everything the extension
 * and the student's Claude fill into a form that is not on a resume. It all
 * sat on My Profile until KAN-550, which made that page a long form the
 * student scrolled past to find their own name and links: what an employer
 * sees stays there, and what only the autofiller reads moved here, under
 * the feature that uses it.
 *
 * One white card each (./info-screen.tsx), under a nav of links to them
 * from @4xl/main up: Work Authorization and Voluntary Self-Identification
 * (./application-questions.tsx, the second closed while reading),
 * Application Answers (./application-answers.tsx), Transcript
 * (./transcript.tsx), Writing Samples (./writing-samples.tsx, at
 * `#writing-samples`, the address the extension's ask opens) and Workday
 * Sign-Up (./workday-signup.tsx, which opens the extension's own page).
 *
 * The answer bank is read here, on the server, with the experience bank,
 * whose education entries give Application Answers' School Year; a failed
 * bank read leaves School Year unknown, not the page. A failed answers read
 * shows a notice, never cards of "Not answered" that would pass for the
 * student's real answers. Transcript and Writing Samples read their own.
 * A <div>, since SidebarInset is already the <main>.
 */
export default async function ApplicationInfoPage() {
  const [answers, bank] = await Promise.all([getAutofillAnswers(), getBank()]);

  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackLink parent={{ href: "/auto-apply", name: "Auto Apply" }} named className="group/back" />
      {answers.error != null ? (
        <EmptyState
          Icon={CloudSlashIcon}
          title="Your Answers Aren't Loading"
          className="mt-8"
          detail={process.env.NODE_ENV === "development" ? answers.error : undefined}
        >
          We couldn&apos;t reach your application answers. Refresh the page in a few minutes.
        </EmptyState>
      ) : (
        <InfoScreen initial={answers.answers} education={bank.data?.entries ?? []} />
      )}
    </div>
  );
}
