import type { JobPosting } from "@/components/job-detail/data";
import { NOT_LISTED } from "@/components/job-posting-card";

import { listingFacts } from "./listing-card";
import type { JobListing } from "./listings";

/*
 * A live role in the shape the shared job header (JobDetailHeader) reads:
 * its job page's and its application's page alike (KAN-256), so a role reads
 * the same on both.
 */

/** A fact's words, or nothing where the posting doesn't say (the header
 *  leaves that fact out). */
const text = (value: string | null | typeof NOT_LISTED | undefined) =>
  typeof value === "string" ? value : "";

/** The live role in the shape the shared header reads. What only a fixture
 *  carries (an employer blurb, the mock's sections) is empty. */
export function toPosting(job: JobListing): JobPosting {
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
