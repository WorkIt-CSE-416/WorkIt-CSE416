import { CheckCircleIcon, CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

import { BackLink } from "../../back-link";
import { SEEKER_GUTTER } from "../../gutter";
import { WriteWithClaude } from "../write-with-claude";
import { AnswerBox } from "./answer-box";
import { DeleteAnswer } from "./delete-answer";
import { FactBox } from "./fact-box";
import { isNew, newestSaved, SEEN_COOKIE, seenAt } from "./new-answers";
import { getAnsweredQuestions, getWrittenQuestions } from "./questions";
import { SeenNow } from "./seen-now";

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
 * ESSAY FACTS (KAN-369). A question whose answer needs a fact nothing in
 * the student's experience states shows what their Claude asked above its
 * box (./fact-box.tsx): the student's answer joins their experience, and
 * their Claude then writes the answer from it. They may still write the
 * whole answer themselves in the box.
 *
 * WRITE WITH CLAUDE (../write-with-claude.tsx), beside the heading while
 * any question waits, starts the student's own Claude on them instead.
 *
 * YOUR ANSWERS. Below, every written question already answered, newest
 * application first, with the company brief fact the answer names (its
 * Named fact, KAN-369) linked to the page that states it, so the student
 * can read up on it before an interview. Every answer has a Delete
 * (./delete-answer.tsx): the student's own, one saved here, and their
 * Claude's (not own limits reuse, not removal). A list that doesn't load is left out
 * rather than shown as an error.
 *
 * The list is read once, on the server, as the page loads; a saved answer
 * stays on the page marked Saved until the next visit, so the student sees
 * what they sent. A <div>, since SidebarInset is already the <main>.
 */
export default async function WrittenAnswersPage() {
  const [{ data: postings, error }, { data: answered }] = await Promise.all([
    getWrittenQuestions(),
    getAnsweredQuestions(),
  ]);
  // Own answers captured from a form since the last visit are marked New (./new-answers.ts).
  const seen = seenAt((await cookies()).get(SEEN_COOKIE)?.value);
  const shown = newestSaved(answered ?? []);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackLink parent={{ href: "/auto-apply", name: "Auto Apply" }} named />
      {shown != null && <SeenNow at={shown} />}
      <div className="flex flex-col gap-3 @2xl/main:flex-row @2xl/main:items-start @2xl/main:justify-between">
        <div className="min-w-0">
          <h1 className="text-heading text-ink">Written Answers</h1>
          <p className="text-body text-ink-meta mt-1 max-w-[68ch]">
            The questions your open applications ask you to write. Let your Claude write them, write
            your own answer, or paste one from any AI. WorkIt checks each answer, then fills it into
            the job&apos;s open tab.
          </p>
        </div>
        {postings && postings.length > 0 && <WriteWithClaude className="shrink-0" />}
      </div>

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
                  <div key={question.name} className="flex flex-col gap-2">
                    {question.ask && (
                      <FactBox
                        jobId={posting.job_id}
                        name={question.name}
                        ask={question.ask}
                        about={question.ask_about}
                      />
                    )}
                    <AnswerBox jobId={posting.job_id} question={question} />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {answered && answered.length > 0 && (
        <section aria-labelledby="your-answers" className="mt-10">
          <h2 id="your-answers" className="text-title text-ink">
            Your Answers
          </h2>
          <p className="text-body text-ink-meta mt-1 max-w-[68ch]">
            What your applications were given, with the company fact each answer uses. Read up on it
            before an interview.
          </p>
          <div className="mt-4 flex flex-col gap-5">
            {answered.map((posting) => (
              <Card as="article" padding="lg" key={posting.job_id}>
                <h3 className="text-subtitle text-ink">{posting.title ?? "Untitled Job"}</h3>
                {posting.company && <p className="text-body text-ink-meta">{posting.company}</p>}
                <dl className="mt-4 flex flex-col gap-5">
                  {posting.questions.map((question) => (
                    <div key={question.name} className="flex flex-col gap-1.5">
                      <dt className="text-body text-ink flex items-center gap-2 font-semibold">
                        {question.label}
                        {isNew(question, seen) && <Badge tone="brand">New</Badge>}
                      </dt>
                      <dd className="text-body text-ink whitespace-pre-wrap">{question.answer}</dd>
                      {question.named_fact && (
                        <dd className="text-note text-ink-meta">
                          Named fact:{" "}
                          <TextLink
                            href={question.named_fact.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {question.named_fact.fact}
                          </TextLink>
                        </dd>
                      )}
                      <DeleteAnswer jobId={posting.job_id} name={question.name} />
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
