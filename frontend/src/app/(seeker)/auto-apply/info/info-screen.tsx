"use client";

import { useState } from "react";

import { PROFILE_QUESTIONS, SELF_ID_KEYS, type AutofillAnswers } from "@/lib/autofill-answers";
import type { BankEntry } from "@/lib/bank-actions";

import { ApplicationAnswers } from "./application-answers";
import { ApplicationQuestions } from "./application-questions";
import { Transcript } from "./transcript";
import { WorkdaySignup } from "./workday-signup";
import { WritingSamples } from "./writing-samples";

const WORK_QUESTIONS = PROFILE_QUESTIONS.filter((q) => !SELF_ID_KEYS.includes(q.key));
const SELF_ID_QUESTIONS = PROFILE_QUESTIONS.filter((q) => SELF_ID_KEYS.includes(q.key));

/** The nav's links, in the cards' order: each card's address on the page. */
const SECTIONS = [
  { href: "#section-work-authorization", label: "Work Authorization" },
  { href: "#section-self-identification", label: "Self-Identification" },
  { href: "#section-application-answers", label: "Application Answers" },
  { href: "#section-transcript", label: "Transcript" },
  { href: "#writing-samples", label: "Writing Samples" },
  { href: "#section-workday", label: "Workday Sign-Up" },
];

/**
 * Application Info's cards (./page.tsx), and the answer bank they share:
 * a Save in one card hands the whole bank back (the PATCH answers it), so
 * the other cards read what it saved.
 *
 * From @4xl/main up a nav of plain links sits left of the cards and stays
 * in view as the page scrolls; below it the cards stack with no nav, since
 * a row of six links over a phone's first screen pushed the first card
 * down for little. Each card's `scroll-mt-6` keeps a jump clear of the top.
 */
export function InfoScreen({
  initial,
  education,
}: {
  initial: AutofillAnswers;
  /** The experience bank's entries; School Year reads the education ones. */
  education: BankEntry[];
}) {
  const [answers, setAnswers] = useState(initial);

  return (
    <div className="mt-6 grid gap-8 @4xl/main:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Application Info" className="hidden @4xl/main:block">
        <ul className="sticky top-6 flex flex-col gap-0.5">
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <a
                href={section.href}
                className="text-body text-ink-muted hover:text-ink focus-visible:ring-brand-ring hover:bg-ink/5 block rounded-md px-3 py-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col gap-5">
        <p className="text-body text-ink-meta">
          What WorkIt and your Claude fill into your applications, beyond your resume. Only you can
          see these.
        </p>
        <ApplicationQuestions
          id="work-authorization"
          title="Work Authorization"
          description="Whether you can work here and under what status. Most applications ask."
          questions={WORK_QUESTIONS}
          answers={answers}
          onSaved={setAnswers}
        />
        <ApplicationQuestions
          id="self-identification"
          title="Voluntary Self-Identification"
          description="The equal opportunity questions U.S. employers ask. Answering is optional."
          questions={SELF_ID_QUESTIONS}
          concealed
          answers={answers}
          onSaved={setAnswers}
        />
        <ApplicationAnswers answers={answers} education={education} onSaved={setAnswers} />
        <Transcript />
        <WritingSamples />
        <WorkdaySignup />
      </div>
    </div>
  );
}
