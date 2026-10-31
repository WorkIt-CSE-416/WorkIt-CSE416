import Link from "next/link";
import type { ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { CheckIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import type { JobListing } from "../../listings";
import { TailorBack } from "./tailor-back";
import { TAILOR_STEPS, type TailorStep } from "./tailor-steps";
import { jobLogo } from "@/lib/job-logo";

/**
 * A pick step's top under its `TailorBar`: the step's title, the job it
 * tailors for (`TailorJobLine`), and the step's line (`HEADINGS` in
 * ./tailor-screen.tsx). The intro sat inside the picker card until the
 * step views (2026-10-26), where it read as the card's instructions.
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
      <TailorJobLine job={job} className="mt-1" />
      <p className="text-body text-ink-meta mt-2 max-w-[68ch]">{children}</p>
    </>
  );
}

/**
 * The job being tailored to, as one line under each step's title, the
 * review's resume name included, so every step names it in the same place:
 * the employer's small logo, then "Title · Company", a link to the job
 * posting's page. Step 2's keywords and step 3's changes are read against
 * this job, so it stays in view; the resume's name, which the student can
 * rename, is no stand-in. It was a job card on the pick steps alone, with
 * the posting's location, pay, type and level, which help neither pick
 * (2026-10-26).
 */
export function TailorJobLine({ job, className }: { job: JobListing; className?: string }) {
  return (
    <Link
      href={`/jobs/${encodeURIComponent(job.id)}`}
      className={cn(
        "group text-label text-ink-muted hover:text-brand focus-visible:ring-brand-ring flex w-fit max-w-full items-center gap-2 rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      <CompanyLogo
        name={job.company}
        src={jobLogo(job)}
        className="text-caption rounded-control size-5 shrink-0"
      />
      <span className="truncate">
        <span className="text-ink group-hover:text-brand font-medium">{job.title}</span> ·{" "}
        {job.company}
      </span>
    </Link>
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
