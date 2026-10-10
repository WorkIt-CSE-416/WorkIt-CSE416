import { Flag } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompanyLogo } from "@/components/company-logo";
import { ExternalLinkIcon } from "@/components/icons";
import type { JobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { NOT_LISTED } from "@/components/job-posting-card";
import { SaveButton } from "@/components/save-button";
import { AskScoutButton } from "@/components/scout/scout-buttons";
import { ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";
import { placesOf } from "../format";
import { ListingsError, listingFacts } from "../listing-card";
import { getJobListing, type JobListing } from "../listings";
import { JobDescription } from "./description";
import { BackToJobs, ShareButton } from "./page-actions";

export async function generateMetadata({ params }: PageProps<"/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const { job } = await getJobListing(jobId);
  return { title: job ? `${job.title} at ${job.company}` : "Job Not Found" };
}

/**
 * /jobs/[jobId] — one live role's own page, opened from its card's title on
 * /jobs or /search (KAN-73). `jobId` is the row's UUID; `GET /jobs/{id}`
 * answers with the role and its description, or 404 for one that has closed,
 * a company's own posting, or no such job, all of which get not-found.tsx.
 *
 * THE MOCK'S HEADER, WITH THE CARD'S FACTS. `JobDetailHeader` is shared with
 * the company's view of its own postings, so the live role is shaped into its
 * `JobPosting` (`toPosting`), with the six facts the card prints
 * (`listingFacts`), so a role reads the same on its card and its page. A fact
 * the posting doesn't state is left out, not marked.
 *
 * ONE "ABOUT THE ROLE", NOT THE MOCK'S THREE SECTIONS. A scraped posting is
 * plain text in whatever order its employer wrote it; ./description reads its
 * paragraphs, lists and subheadings from the text itself rather than sorting
 * it into "What You'll Do" and "Qualifications" by guesswork.
 *
 * Its actions: Apply Now leaves for the employer's posting, Ask Scout asks
 * about this role, Share copies the page's link. Save and Report are still
 * inert, as on the card (KAN-65 makes saving real). No match rail: nothing
 * scores a role yet, and an empty ring here would read as a verdict.
 */
export default async function JobDetailPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;
  const { job, error } = await getJobListing(jobId);

  if (error != null) {
    return (
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
        <BackToJobs />
        <ListingsError error={error} retryHref={`/jobs/${encodeURIComponent(jobId)}`} />
      </div>
    );
  }
  if (job == null) notFound();
  const places = placesOf(job.location_label ?? job.location);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackToJobs />

      <JobDetailHeader
        posting={toPosting(job)}
        // The employer's own logo, as on the card, at the header's 32px; its
        // initials when it has none.
        tile={
          <CompanyLogo name={job.company} src={job.logo_url} className="text-meta size-8 rounded" />
        }
        actions={
          <>
            {/* Outlined like the feed card's icon actions. On a narrow card
                these sit left and Apply Now right, on a row of their own. */}
            <SaveButton title={job.title} />
            <IconButton
              label={`Report ${job.title}`}
              tooltip="Report"
              variant="outline"
              className="size-8 shrink-0"
            >
              <Flag className="size-4" />
            </IconButton>
            <ShareButton title={job.title} />
            <AskScoutButton id={job.id} title={job.title} company={job.company} />
            <ButtonLink
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              size="lg"
              className="ml-auto shrink-0 @xl:ml-0"
            >
              Apply Now
              <ExternalLinkIcon className="size-4" />
              <span className="sr-only"> (opens in a new tab)</span>
            </ButtonLink>
          </>
        }
      />

      <Section title="About the Role">
        {/* The card names one place and how many more; here, all of them. */}
        {places.length > 1 && (
          <p className="text-body text-ink-muted mt-3">Open in {places.join(" · ")}.</p>
        )}
        {job.description ? (
          <JobDescription text={job.description} company={job.company} applyUrl={job.apply_url} />
        ) : (
          <p className="text-body text-ink-meta mt-3">
            This posting has no description here. Apply Now opens it on {job.company}&apos;s site.
          </p>
        )}
      </Section>
    </div>
  );
}

/** A fact's words, or nothing where the posting doesn't say (the header
 *  leaves that fact out). */
const text = (value: string | null | typeof NOT_LISTED | undefined) =>
  typeof value === "string" ? value : "";

/** The live role in the shape the shared header reads. What only a fixture
 *  carries (an employer blurb, the mock's sections) is empty. */
function toPosting(job: JobListing): JobPosting {
  const facts = listingFacts(job);
  return {
    id: job.id,
    companyName: job.company,
    title: job.title,
    status: "Open",
    jobType: text(facts.jobType),
    workStyle: text(facts.workStyle),
    level: text(facts.experienceLevel),
    starts: text("startTerm" in facts ? facts.startTerm : facts.minYearsExperience),
    locationCity: text(facts.location),
    salary: text(facts.salary),
    postedAt: job.posted_at ?? "",
    updatedAt: job.posted_at ?? "",
    companyAbout: "",
    about: "",
    responsibilities: [],
    qualifications: [],
  };
}
