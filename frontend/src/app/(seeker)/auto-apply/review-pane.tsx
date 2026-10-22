"use client";

import { AppWindow, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { MatchBadge } from "@/components/match-badge";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { showRunTab } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";

import { ViewResumeButton } from "../applications/view-resume";
import { STATUS, type ActivityItem, type ActivityStatus } from "./activity-list";
import {
  approveApplication,
  getReview,
  skipApplication,
  type AnswerSource,
  type Review,
  type ReviewAnswer,
} from "./desktop-actions";

/** Each answer's source, as a tag: where to look before trusting it. What
 *  was written for this job and what had nothing to go on stand out. */
const SOURCE: Record<AnswerSource, { label: string; tone: BadgeTone }> = {
  profile: { label: "Profile", tone: "inert" },
  answer_bank: { label: "Answer Bank", tone: "neutral" },
  written: { label: "Written for This Job", tone: "warning" },
  missing: { label: "Missing", tone: "danger" },
};

/** What the right side says for an application with no review to show. */
const WAITING: Partial<Record<ActivityStatus, string>> = {
  queued: "Waiting for WorkIt Desktop or the extension to pick it up.",
  browser: "Open in the extension's background tab. Finish it there.",
  tailoring: "Tailoring your resume for this job.",
  filling: "A WorkIt Desktop Worker is filling the form. Its review lands here when it's done.",
  approved: "Approved. WorkIt Desktop is submitting it with your answers.",
  failed: "Auto Apply couldn't finish this one. Finish it on the job's page.",
  skipped: "Skipped. Nothing was submitted.",
  applied: "Submitted.",
};

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The Inbox's right half (KAN-323): the application picked in Live
 * Activity. Its header is the job posting (the logo, the role, linked to
 * its page while open, and the match), then by status:
 *
 * NEEDS REVIEW shows what WorkIt Desktop filled, stopped before Submit
 * (GET .../review): the flags first, since they are why it needs a look,
 * then Desktop's one-line note, the resume it used, every essay as an
 * editable textarea with the bank facts its claims came from, and every
 * other answer as an editable field with its source. Approve & Submit sends
 * the edited answers (POST .../approve; an empty list when nothing changed,
 * which keeps the review's) and Desktop submits; Skip finishes it as skipped
 * (POST .../finish). Either then hands back to the Inbox (`onDone`), which
 * re-reads the list and moves to the next review.
 *
 * Every other status is a line on where it stands, plus what can be done
 * from here: go to the extension's tab, open the job's page to finish it,
 * or view the resume an applied one went out with.
 *
 * Keyed on the job by the caller, so edits never carry from one
 * application to the next.
 */
export function ReviewPane({ item, onDone }: { item: ActivityItem; onDone: () => void }) {
  const status = STATUS[item.status];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <CompanyLogo
            name={item.company}
            src={item.logoUrl}
            className="text-meta size-10 shrink-0 rounded"
          />
          <div className="min-w-0">
            {item.href ? (
              <Link
                href={item.href}
                className="text-subtitle text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                {item.role}
              </Link>
            ) : (
              <p className="text-subtitle text-ink truncate font-semibold">{item.role}</p>
            )}
            <p className="text-note text-ink-meta truncate">{item.company}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {item.match != null && <MatchBadge score={item.match} />}
          <Badge tone={status.tone}>
            <status.Icon aria-hidden className="mr-1 size-3.5 shrink-0" />
            {status.label}
          </Badge>
        </div>
      </div>

      {item.status === "review" ? (
        <ReviewForm item={item} onDone={onDone} />
      ) : (
        <div className="space-y-3">
          <p className="text-body text-ink-meta">{WAITING[item.status]}</p>
          {item.status === "browser" && (
            <Button variant="secondary" size="sm" onClick={() => void showRunTab()}>
              <AppWindow aria-hidden />
              Go to the Tab
            </Button>
          )}
          {item.status === "failed" && item.href && (
            <ButtonLink href={item.href} variant="secondary" size="sm">
              Open the Job
            </ButtonLink>
          )}
          {item.status === "applied" && item.sentResume && (
            <ViewResumeButton resume={item.sentResume} />
          )}
        </div>
      )}
    </div>
  );
}

function ReviewForm({ item, onDone }: { item: ActivityItem; onDone: () => void }) {
  const toast = useToast();
  const [review, setReview] = useState<Review | null>(null);
  const [answers, setAnswers] = useState<ReviewAnswer[]>([]);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // One decision at a time: `pending` disables the buttons a render late.
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    void getReview(item.id).then(({ data, error }) => {
      if (!live) return;
      if (!data) return setError(error ?? "Could not load the review.");
      setReview(data);
      setAnswers(data.answers);
    });
    return () => {
      live = false;
    };
  }, [item.id]);

  if (error && !review) {
    return (
      <p role="alert" className="text-body text-danger">
        {error}
      </p>
    );
  }
  if (!review) {
    return (
      <p className="text-body text-ink-meta flex items-center gap-2">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Loading the review…
      </p>
    );
  }

  const edit = (index: number, answer: string) => {
    setEdited(true);
    setAnswers((list) => list.map((a, i) => (i === index ? { ...a, answer } : a)));
  };

  function decide(approve: boolean) {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        const result = approve
          ? await approveApplication(item.id, edited ? answers : [])
          : await skipApplication(item.id);
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.show({
          message: (
            <>
              <span className="font-medium">{item.role}</span> from{" "}
              <span className="font-medium">{item.company}</span>{" "}
              {approve ? "is approved. WorkIt Desktop will submit it." : "is skipped."}
            </>
          ),
        });
        onDone();
      } finally {
        busy.current = false;
      }
    });
  }

  // Indexes into the one list, so an edit lands on the right answer.
  const essays = answers.flatMap((a, i) => (a.essay ? [{ a, i }] : []));
  const fields = answers.flatMap((a, i) => (a.essay ? [] : [{ a, i }]));

  return (
    <>
      {review.flags.length > 0 && (
        <ul className="space-y-1.5" aria-label="Flags">
          {review.flags.map((flag) => (
            <li
              key={flag}
              className="border-warning-border bg-warning-tint flex items-start gap-2 rounded-lg border px-3 py-2"
            >
              <TriangleAlert aria-hidden className="text-warning mt-px size-4 shrink-0" />
              <span className="text-note text-ink">{flag}</span>
            </li>
          ))}
        </ul>
      )}

      {review.note && <p className="text-body text-ink-meta">{review.note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="positive" size="sm" disabled={pending} onClick={() => decide(true)}>
          Approve &amp; Submit
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => decide(false)}>
          Skip
        </Button>
        {edited && <span className="text-note text-ink-meta">Your edits will be submitted.</span>}
      </div>
      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}

      <section aria-labelledby="review-resume">
        <h3 id="review-resume" className="text-subtitle text-ink">
          Resume
        </h3>
        {review.resume ? (
          review.resume.sent_resume_id ? (
            <div className="mt-1">
              <ViewResumeButton
                resume={
                  item.sentResume?.id === review.resume.sent_resume_id
                    ? item.sentResume
                    : { id: review.resume.sent_resume_id, name: review.resume.name, format: "pdf" }
                }
              />
            </div>
          ) : (
            <p className="text-body text-ink mt-1">{review.resume.name}</p>
          )
        ) : (
          <p className="text-note text-ink-meta mt-1">This form asked for no resume.</p>
        )}
      </section>

      {essays.length > 0 && (
        <section aria-labelledby="review-essays" className="space-y-4">
          <h3 id="review-essays" className="text-subtitle text-ink">
            Essays ({essays.length})
          </h3>
          {essays.map(({ a, i }) => (
            <div key={i}>
              <label htmlFor={`essay-${i}`} className="text-label text-ink">
                {a.question}
              </label>
              <textarea
                id={`essay-${i}`}
                value={a.answer}
                onChange={(e) => edit(i, e.target.value)}
                className={cn(
                  FIELD_CONTROL,
                  "mt-1 block field-sizing-content min-h-24 px-3.5 py-2.5",
                )}
              />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-note text-ink-meta tabular-nums">
                  {words(a.answer)} words
                </span>
                {a.facts.map((fact) => (
                  <span
                    key={fact}
                    className="bg-positive-tint text-positive-ink text-note rounded-md px-2 py-0.5"
                  >
                    From your bank: {fact}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {review.cover_letter && (
        <section aria-labelledby="review-cover">
          <h3 id="review-cover" className="text-subtitle text-ink">
            Cover Letter
          </h3>
          <p className="text-body text-ink bg-well mt-1 rounded-lg p-3 whitespace-pre-line">
            {review.cover_letter}
          </p>
        </section>
      )}

      <section aria-labelledby="review-answers">
        <h3 id="review-answers" className="text-subtitle text-ink">
          Form Answers ({fields.length})
        </h3>
        <p className="text-note text-ink-meta mb-2">
          Exactly what will be submitted. Change any answer before you approve.
        </p>
        <dl className="divide-border-subtle divide-y">
          {fields.map(({ a, i }) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-1 py-2 @xl/main:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @xl/main:items-center @xl/main:gap-3"
            >
              <dt className="text-note text-ink-meta">
                <label htmlFor={`answer-${i}`}>{a.question}</label>
              </dt>
              <dd>
                <input
                  id={`answer-${i}`}
                  value={a.answer}
                  onChange={(e) => edit(i, e.target.value)}
                  aria-invalid={a.source === "missing" && a.answer.trim() === "" ? true : undefined}
                  className={cn(FIELD_CONTROL, "px-2.5 py-1.5")}
                />
              </dd>
              <dd>
                <Badge variant="tag" tone={SOURCE[a.source].tone}>
                  {SOURCE[a.source].label}
                </Badge>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
