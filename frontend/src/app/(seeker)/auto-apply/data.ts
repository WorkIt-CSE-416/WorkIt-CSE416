import { cache } from "react";

/**
 * Auto Apply's activity fixture: what the pipeline in `auto-apply/design.md`
 * (repo root) is doing to each job posting, newest first. Nothing runs yet,
 * so every row is invented. When the applications and autofill-run routes
 * exist (the design's section 7), this file becomes the fetch, and
 * `ActivityItem` is the shape it returns.
 *
 * THE TIMES ARE RELATIVE TO THE REQUEST, built by `getActivity` against
 * `getNow` (both `cache()`d), so the feed always reads as current, the way
 * the Applications fixture keeps its dates mid-flight.
 */

/** Where one application stands in the pipeline. The order a job moves
 *  through: queued, tailoring, filling, then review or failed, then applied. */
export type ActivityStatus = "queued" | "tailoring" | "filling" | "review" | "failed" | "applied";

export type ActivityItem = {
  id: string;
  role: string;
  company: string;
  /** A job board's logo URL. The fixture has none, so tiles show initials,
   *  as Workday postings do. */
  logoUrl: string | null;
  location: string;
  status: ActivityStatus;
  /** One line on what is happening or what went wrong. */
  detail: string;
  /** When the status last changed: an ISO instant. */
  at: string;
};

const MINUTE = 60_000;

export const getNow = cache(() => new Date());

/** The feed, newest change first. */
export const getActivity = cache((): ActivityItem[] => {
  const now = getNow().getTime();
  const ago = (minutes: number) => new Date(now - minutes * MINUTE).toISOString();

  return [
    {
      id: "a1",
      role: "Software Engineer Intern",
      company: "Stripe",
      logoUrl: null,
      location: "San Francisco, CA",
      status: "filling",
      detail: "Filled 14 of 18 fields on Greenhouse",
      at: ago(0),
    },
    {
      id: "a2",
      role: "Data Analyst Intern",
      company: "Capital One",
      logoUrl: null,
      location: "McLean, VA",
      status: "tailoring",
      detail: "Reordering projects for SQL and Tableau",
      at: ago(1),
    },
    {
      id: "a3",
      role: "Backend Engineer, New Grad",
      company: "Ramp",
      logoUrl: null,
      location: "New York, NY",
      status: "review",
      detail: "Filled and ready for you to check and submit",
      at: ago(4),
    },
    {
      id: "a4",
      role: "Machine Learning Intern",
      company: "Nvidia",
      logoUrl: null,
      location: "Santa Clara, CA",
      status: "failed",
      detail: "2 required questions left blank on Workday",
      at: ago(9),
    },
    {
      id: "a5",
      role: "Software Engineer Intern",
      company: "Datadog",
      logoUrl: null,
      location: "New York, NY",
      status: "applied",
      detail: "Submitted with your tailored resume",
      at: ago(18),
    },
    {
      id: "a6",
      role: "Product Engineer Intern",
      company: "Notion",
      logoUrl: null,
      location: "San Francisco, CA",
      status: "applied",
      detail: "Submitted with your tailored resume",
      at: ago(42),
    },
    {
      id: "a7",
      role: "Frontend Engineer Intern",
      company: "Figma",
      logoUrl: null,
      location: "Remote",
      status: "queued",
      detail: "Waiting for its turn",
      at: ago(55),
    },
    {
      id: "a8",
      role: "Quantitative Developer Intern",
      company: "Jane Street",
      logoUrl: null,
      location: "New York, NY",
      status: "queued",
      detail: "Waiting for its turn",
      at: ago(55),
    },
  ];
});
