import type { BadgeTone } from "@/components/ui/badge";

/** What /company/applicants lists. Fixtures — one file to swap for real data. */

export type Stage = "Applied" | "Screening" | "Interview" | "Offer" | "Rejected";

export type Applicant = {
  id: string;
  name: string;
  /** The posting this application is against. */
  role: string;
  stage: Stage;
  /** Percent, as the matcher scores it. */
  match: number;
  /** ISO date the application arrived. */
  applied: string;
  location: string;
};

/** Pipeline order, not alphabetical — the dropdown reads as a funnel. */
export const STAGES: Stage[] = ["Applied", "Screening", "Interview", "Offer", "Rejected"];

/**
 * What each stage is, rather than what each one is called.
 *
 * Applied is inert — it has arrived and nobody has done anything with it.
 * Screening and Interview are both in flight but do not share a tone: a screen
 * is a recruiter and twenty minutes, an interview is a panel and an afternoon.
 * Offer and Rejected are the two ways it ends, and they must not look alike.
 *
 * Beside the data rather than in the table, so /design-kit renders the real set
 * from the same source instead of a copy that goes stale.
 */
export const STAGE_TONE: Record<Stage, BadgeTone> = {
  Applied: "inert",
  Screening: "brand",
  Interview: "advanced",
  Offer: "positive",
  Rejected: "danger",
};

export const ROLES = [
  "Frontend Engineer, New Grad",
  "Platform Engineer",
  "Data Analyst Intern",
  "Site Reliability Engineer",
  "Machine Learning Engineer",
];

export const APPLICANTS: Applicant[] = [
  {
    id: "c1",
    name: "Amara Osei",
    role: "Frontend Engineer, New Grad",
    stage: "Interview",
    match: 94,
    applied: "2026-08-30",
    location: "New York, NY",
  },
  {
    id: "c2",
    name: "Devin Park",
    role: "Platform Engineer",
    stage: "Screening",
    match: 88,
    applied: "2026-08-30",
    location: "Remote",
  },
  {
    id: "c3",
    name: "Rosa Iglesias",
    role: "Data Analyst Intern",
    stage: "Applied",
    match: 81,
    applied: "2026-08-29",
    location: "Stony Brook, NY",
  },
  {
    id: "c4",
    name: "Tom Whitfield",
    role: "Frontend Engineer, New Grad",
    stage: "Applied",
    match: 77,
    applied: "2026-08-28",
    location: "Brooklyn, NY",
  },
  {
    id: "c5",
    name: "Priya Raman",
    role: "Machine Learning Engineer",
    stage: "Offer",
    match: 96,
    applied: "2026-08-12",
    location: "Remote",
  },
  {
    id: "c6",
    name: "Marcus Bell",
    role: "Site Reliability Engineer",
    stage: "Interview",
    match: 84,
    applied: "2026-08-18",
    location: "Austin, TX",
  },
  {
    id: "c7",
    name: "Hana Kobayashi",
    role: "Platform Engineer",
    stage: "Screening",
    match: 90,
    applied: "2026-08-21",
    location: "Remote",
  },
  {
    id: "c8",
    name: "Elliot Nwosu",
    role: "Frontend Engineer, New Grad",
    stage: "Rejected",
    match: 62,
    applied: "2026-08-09",
    location: "Jersey City, NJ",
  },
  {
    id: "c9",
    name: "Sofia Marchetti",
    role: "Data Analyst Intern",
    stage: "Interview",
    match: 87,
    applied: "2026-08-15",
    location: "Remote",
  },
  {
    id: "c10",
    name: "Jonah Reyes",
    role: "Machine Learning Engineer",
    stage: "Applied",
    match: 73,
    applied: "2026-08-27",
    location: "Queens, NY",
  },
];
