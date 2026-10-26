import Link from "next/link";
import type { ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import {
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  LevelIcon,
  PinIcon,
  workStyleIcon,
} from "@/components/icons";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/fact";

import type { JobListing } from "../../listings";
import { toPosting } from "../../to-posting";
import { BackToJobs } from "../page-actions";
import { TAILOR_STEPS } from "./tailor-steps";

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
 * starts near the top: Back (the job page's `BackToJobs`) and "Step 3 of
 * 3". The page's h1 names the job for screen readers only; on screen the
 * resume's own title (`ResumeTitle`, over the page) leads. Until
 * 2026-10-26 this step had the pick steps' Back, title, line, job card and
 * timeline, about 300px over the resume, and the user found it
 * overwhelming beside the review (after Quinncia's slim bar); then the
 * job's logo and "Title · Company" beside Back, which the user found
 * crowded Back and repeated what the resume's name already says.
 */
export function TailorReviewBar({ job }: { job: JobListing }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="sr-only">
        Tailor for {job.title} at {job.company}
      </h1>
      <BackToJobs className="group/back shrink-0" />
      <p className="text-note text-ink-meta shrink-0 whitespace-nowrap">
        Step {TAILOR_STEPS.length} of {TAILOR_STEPS.length}
      </p>
    </div>
  );
}
