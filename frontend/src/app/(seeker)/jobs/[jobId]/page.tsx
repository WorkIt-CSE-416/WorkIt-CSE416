import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";
import { ListingsError } from "../listing-card";
import { getJobListing } from "../listings";
import { JobActionBar } from "./action-bar";
import {
  JOB_PAGE_WIDTH,
  JobViewActions,
  JobViewBody,
  JobViewHeader,
  loadJobView,
} from "./job-view";
import { BackToJobs } from "./page-actions";

export async function generateMetadata({ params }: PageProps<"/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const { job, error } = await getJobListing(jobId);
  if (job) return { title: `${job.title} at ${job.company}` };
  return { title: error != null ? "Jobs Aren't Loading" : "Job Not Found" };
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
 * Its actions sit in one bar with Back, held at the top of the page from md
 * while the description scrolls (./action-bar): Save, the "…" menu (Copy Link
 * and Report, ./page-actions), Ask Scout, Auto Apply (queues it for the Auto
 * Apply page, as on the card), Tailor My Resume (./tailor, KAN-217; "Your
 * Tailored Resume" once the student has one for this posting) and Apply Now.
 * The header card below holds only who is hiring, the title and the facts.
 * Apply Now asks which resume to send, keeps it as a sent resume linked to
 * this posting, then leaves for the employer's posting (../apply-button,
 * KAN-220); once one is sent, the page says "You sent <name> on <date>"
 * (./sent-note, story 98). After the seeker leaves for the posting, the same
 * dialog asks "Did You Apply?" (KAN-242); Yes marks the job applied (KAN-232),
 * the page says "You applied on <date>", and the job leaves their feed. There
 * is no Applied button: one misclick marked a job applied with no undo. Save
 * keeps the job in My Applications (KAN-261); Report is still inert. No
 * match rail: nothing scores a role yet, and an empty ring here would read as
 * a verdict.
 */
export default async function JobDetailPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;
  const view = await loadJobView(jobId);
  const { job, error } = view;

  if (error != null) {
    return (
      <div className={cn(JOB_PAGE_WIDTH, SEEKER_GUTTER)}>
        <BackToJobs />
        <ListingsError error={error} retryHref={`/jobs/${encodeURIComponent(jobId)}`} />
      </div>
    );
  }
  if (job == null) notFound();

  // The actions, header and body are ./job-view's, which the application's
  // own page (/applications/[jobId]) draws too.
  return (
    <div className={cn(JOB_PAGE_WIDTH, SEEKER_GUTTER)}>
      {/* Back and the job's actions, held at the top while the description
          scrolls under them (./action-bar). */}
      <JobActionBar>
        <JobViewActions view={view} job={job} />
      </JobActionBar>
      <JobViewHeader job={job} />
      <JobViewBody view={view} job={job} />
    </div>
  );
}
