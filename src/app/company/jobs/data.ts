/** What /company/jobs lists. Fixtures — one file to swap for real data. */

export type JobStatus = "Open" | "Paused" | "Closed" | "Draft";

export type Posting = {
  id: string;
  role: string;
  team: string;
  status: JobStatus;
  applicants: number;
  /** Applicants nobody has opened yet. */
  unreviewed: number;
  /** ISO date. Sorted and formatted as a date, never as a string. */
  posted: string;
  location: string;
};

export const STATUSES: JobStatus[] = ["Open", "Paused", "Closed", "Draft"];

export const POSTINGS: Posting[] = [
  {
    id: "j1",
    role: "Frontend Engineer, New Grad",
    team: "Product",
    status: "Open",
    applicants: 86,
    unreviewed: 6,
    posted: "2026-08-04",
    location: "New York, NY",
  },
  {
    id: "j2",
    role: "Platform Engineer",
    team: "Infrastructure",
    status: "Open",
    applicants: 41,
    unreviewed: 12,
    posted: "2026-08-11",
    location: "Remote",
  },
  {
    id: "j3",
    role: "Data Analyst Intern",
    team: "Analytics",
    status: "Open",
    applicants: 63,
    unreviewed: 0,
    posted: "2026-07-22",
    location: "Stony Brook, NY",
  },
  {
    id: "j4",
    role: "Design Systems Engineer",
    team: "Product",
    status: "Paused",
    applicants: 18,
    unreviewed: 3,
    posted: "2026-06-30",
    location: "Remote",
  },
  {
    id: "j5",
    role: "Site Reliability Engineer",
    team: "Infrastructure",
    status: "Open",
    applicants: 27,
    unreviewed: 9,
    posted: "2026-08-19",
    location: "Austin, TX",
  },
  {
    id: "j6",
    role: "Technical Writer",
    team: "Product",
    status: "Draft",
    applicants: 0,
    unreviewed: 0,
    posted: "2026-08-26",
    location: "Remote",
  },
  {
    id: "j7",
    role: "Backend Engineer, Payments",
    team: "Payments",
    status: "Closed",
    applicants: 112,
    unreviewed: 0,
    posted: "2026-05-14",
    location: "New York, NY",
  },
  {
    id: "j8",
    role: "Machine Learning Engineer",
    team: "Analytics",
    status: "Open",
    applicants: 54,
    unreviewed: 4,
    posted: "2026-08-01",
    location: "Remote",
  },
];
