import { CheckCircleIcon, CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { BackLink } from "../../back-link";
import { SEEKER_GUTTER } from "../../gutter";
import { AnswerBox } from "./answer-box";
import { getWrittenQuestions } from "./questions";

export const metadata: Metadata = {
  title: "Written Answers",
  description: "Answer the written questions your applications ask, in your own words or pasted.",
};

/**
 * /auto-apply/answers — Written Answers (KAN-385): batch apply without
 * Claude. The extension fills every factual field itself; the written
 * questions (why this company, a project you're proud of) wait for the
 * student's own Claude through the connector. A student without Claude
 * answers them here instead: every question the batch's open tabs need
 * written and have no answer for, grouped by job posting, oldest
 * application first, each with a box for their own draft or text pasted
 * from any AI (./answer-box.tsx).
 *
 * ONE SAVE FOR BOTH. An answer saved here goes through the API's own save
 * for the connector (backend/app/routers/pasted_answers.py, which calls
 * `pipeline.save_answers`), so WorkIt's checks run on it exactly as on
 * Claude's, and the open tab fills it on its next poll. Nothing here talks
 * to the extension.
 *
 * The list is read once, on the server, as the page loads; a saved answer
 * stays on the page marked Saved until the next visit, so the student sees
 * what they sent. A <div>, since SidebarInset is already the <main>.
 */
export default async function WrittenAnswersPage() {
  const { data: postings, error } = await getWrittenQuestions();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackLink parent={{ href: "/auto-apply", name: "Auto Apply" }} named />
      <h1 className="text-heading text-ink">Written Answers</h1>
      <p className="text-body text-ink-meta mt-1 max-w-[68ch]">
        The questions your open applications ask you to write. Write your own answer, or paste one
        from any AI. WorkIt checks each answer, then fills it into the job&apos;s open tab.
      </p>

      {error != null ? (
        <EmptyState
          Icon={CloudSlashIcon}
          title="Your Questions Aren't Loading"
          className="mt-8"
          detail={process.env.NODE_ENV === "development" ? error : undefined}
        >
          We couldn&apos;t reach your applications. Refresh the page in a few minutes.
        </EmptyState>
      ) : !postings || postings.length === 0 ? (
        <EmptyState Icon={CheckCircleIcon} title="Nothing Left to Write" className="mt-8">
          When an open application asks a written question, it shows up here.
        </EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {postings.map((posting) => (
            <Card as="section" padding="lg" key={posting.job_id} aria-labelledby={posting.job_id}>
              <h2 id={posting.job_id} className="text-subtitle text-ink">
                {posting.title ?? "Untitled Job"}
              </h2>
              {posting.company && <p className="text-body text-ink-meta">{posting.company}</p>}
              <div className="mt-4 flex flex-col gap-6">
                {posting.questions.map((question) => (
                  <AnswerBox key={question.name} jobId={posting.job_id} question={question} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
