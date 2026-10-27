import Link from "next/link";
import type { ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import {
  BriefcaseIcon,
  CalendarIcon,
  CheckIcon,
  CoinIcon,
  LevelIcon,
  PinIcon,
  workStyleIcon,
} from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/fact";

import type { JobListing } from "../../listings";
import { toPosting } from "../../to-posting";
import { TailorBack } from "./tailor-back";
import { TAILOR_STEPS, type TailorStep } from "./tailor-steps";

/**
 * The pick views' top: the page title and its line, then the job card.
 * The pick steps (./tailor-screen.tsx) share it, so the student sees the
 * same job on each; the review step has the slim `TailorReviewBar`.
 * The intro sat inside the picker card until the step views (2026-10-26),
 * where it read as the card's instructions rather than the page's.
 */
export function TailorHeader({
  job,
  title,
  children,
}: {
  job: JobListing;
  title: string;
  /** The line under the title, sentence case. */
  children: ReactNode;
}) {
  return (
    <>
      <h1 className="text-heading text-ink">{title}</h1>
      <p className="text-body text-ink-meta mt-1 max-w-[68ch]">{children}</p>
      <TailorJobCard job={job} />
    </>
  );
}

/**
 * The job being tailored to, as the job page's header names it
 * (`JobViewHeader`, ../job-view.tsx): the employer's logo and name over
 * the title, then the facts the posting states. It is that card made
 * small: one heading per page, so the title is not a second h1, and only
 * the stated facts show, in one wrapping row, since an empty slot kept
 * for alignment has nothing here to line up with. The title links to the
 * job posting's page; Back goes to the Jobs page.
 */
function TailorJobCard({ job }: { job: JobListing }) {
  const posting = toPosting(job);
  const facts = [
    { Icon: PinIcon, value: posting.locationCity },
    { Icon: BriefcaseIcon, value: posting.jobType },
    { Icon: CoinIcon, value: posting.salary },
    { Icon: workStyleIcon(posting.workStyle), value: posting.workStyle },
    { Icon: LevelIcon, value: posting.level },
    { Icon: CalendarIcon, value: posting.starts },
  ].filter((fact) => fact.value);

  return (
    <Card
      as="section"
      padding="md"
      aria-label={`${job.title} at ${job.company}`}
      className="mt-4 flex items-start gap-3"
    >
      <span className="flex shrink-0">
        <CompanyLogo
          name={job.company}
          src={job.logo_url}
          className="text-label rounded-control size-10"
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink-meta font-normal">{job.company}</p>
        <Link
          href={`/jobs/${encodeURIComponent(job.id)}`}
          className="text-subtitle text-ink hover:text-brand focus-visible:ring-brand-ring rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          {job.title}
        </Link>
        {facts.length > 0 && (
          <ul role="list" aria-label="Job facts" className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {facts.map(({ Icon, value }) => (
              <li key={value} className="min-w-0">
                <Fact Icon={Icon} title={value}>
                  {value}
                </Fact>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * The review step's whole header (./page.tsx), one slim row so the resume
 * starts near the top, in three parts: Back (to Choose Keywords,
 * `TailorBack`),
 * the step in the middle on one line ("Review Changes · Step 3 of 3"), and Finish at the right, which leaves for the job
 * posting's page, where the student applies. Download sat beside Finish
 * for a day; it is back on the editor's toolbar, with the page's tools. Every change is saved as it is made, so
 * Finish saves nothing; suggestions not yet handled stay as the run made
 * them. The page's h1 names the job for screen readers only; on screen the
 * resume's own title (`ResumeTitle`, under this row) leads. Until
 * 2026-10-26 this step had the pick steps' Back, title, line, job card and
 * timeline, about 300px over the resume, and the user found it
 * overwhelming beside the review (after Quinncia's slim bar); then the
 * job's logo and "Title · Company" beside Back, which crowded it; then
 * Back and "Step 3 of 3" alone, with no way to say the review was done.
 * It sat bare on the page until it took the brand tint, which the user
 * wanted so the row stands out against the content under it.
 */
export function TailorReviewBar({ job, resumeId }: { job: JobListing; resumeId: string }) {
  return (
    <>
      <h1 className="sr-only">
        Tailor for {job.title} at {job.company}
      </h1>
      <TailorBar
        step="review"
        back={<TailorBack jobId={job.id} resumeId={resumeId} />}
        next={
          <ButtonLink href={`/jobs/${encodeURIComponent(job.id)}`} size="sm">
            <CheckIcon aria-hidden className="size-4" /> Finish
          </ButtonLink>
        }
      />
    </>
  );
}

/**
 * Every Tailor step's top row (2026-10-26): Back at the left, the step on
 * one line in the middle ("Choose Keywords · Step 2 of 3"), and the step's
 * way on at the right (Use This Resume, Tailor Resume, Finish), in the
 * brand tint with its ring, as the Suggestions panel is, so the frame
 * stands apart from the content under it. It replaced the step timeline
 * (`TailorSteps`), the pick steps' Back above the title, and the buttons at
 * each card's foot: one row says where the student is and moves them on.
 * The step's name over "Step 3 of 3", two lines, said more than it needs.
 */
export function TailorBar({
  step,
  back,
  next,
}: {
  step: TailorStep;
  back: ReactNode;
  next: ReactNode;
}) {
  const at = TAILOR_STEPS.findIndex((s) => s.value === step);
  return (
    <div className="bg-brand-tint ring-brand-pale grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl p-2 ring-1">
      <div className="flex justify-self-start">{back}</div>
      <p aria-current="step" className="text-label text-ink truncate text-center font-semibold">
        {TAILOR_STEPS[at].label}{" "}
        <span className="text-ink-meta font-normal">
          · Step {at + 1} of {TAILOR_STEPS.length}
        </span>
      </p>
      <div className="flex justify-self-end">{next}</div>
    </div>
  );
}
