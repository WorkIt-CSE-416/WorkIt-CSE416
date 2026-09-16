import type { ComponentType } from "react";

import { CompassIcon, LayersIcon, LeafIcon, SunIcon } from "./icons";

/**
 * The fixtures the Jobs screen renders against.
 *
 * NO MOCKUP EXISTS FOR THIS ROUTE. The route is /jobs — the tab reads Jobs
 * and the heading reads Recommended for You — but the type below stays
 * Recommendation: the section is where you go to find work, and a scored
 * match is what it happens to show you there. `Job` is also already taken,
 * by search/data.ts, and two different Jobs would be worse than one
 * Recommendation.
 * The shell already links to it, so the screen
 * is built from the layout of a competitor's board — a wide row per job, its
 * facts on a grid, and a scored rail down the right — redrawn in WorkIt's own
 * kit. What that reference contributes is structure and the set of fields a row
 * is expected to carry; every colour, control and type size here comes from the
 * three screens KAN-43 already signed off.
 *
 * Nothing reads or writes yet: the filters, the sort, the dismiss and save
 * actions, Ask WorkIt and Apply Now are all inert, as they are on search and on
 * the applications board.
 *
 * `Icon` stands in for an employer's logo — see the note in ./icons.
 */

export type Highlight = {
  text: string;
  /** True is a reason to apply; false is a caveat to weigh before applying. */
  met: boolean;
};

export type Recommendation = {
  id: string;
  title: string;
  company: string;
  /** What the employer is, read as one grey line after the company name. */
  industries: string[];
  Icon: ComponentType<{ className?: string }>;
  /** Tints the employer tile. Each company gets its own, as on the board. */
  tone: "brand" | "deep" | "positive";
  /** Pills above the title. `fresh` is the one that reads green: a new post. */
  flags: { label: string; fresh?: boolean }[];
  location: string;
  workplace: string;
  jobType: string;
  level: string;
  salary: string;
  starts: string;
  /** How much competition there is, which is why it sits beside the actions. */
  applicants: string;
  /** 0-100. The rail draws it as an arc and names the band it falls in. */
  match: number;
  /** Why the score is what it is. Three fit a rail without scrolling. */
  highlights: Highlight[];
  saved?: boolean;
};

/**
 * What a score is called, and what colour says so at a glance.
 *
 * Bands rather than a bare percentage because a number alone invites a reading
 * it has not earned — 76 and 74 are not two different things. The thresholds
 * are a placeholder: whoever owns the matching model sets the real ones, and
 * the labels are the only place the screen states them.
 *
 * Four bands, blue through red, rather than one flat colour at every score.
 * Top band reuses `--color-brand` — the score that earns the app's own
 * primary colour is the one worth calling out — and the three below it step
 * through green, yellow and red so the bands read as a falling scale rather
 * than a set of unrelated badges. Green and red here are a warmer, more
 * saturated pair than `--color-positive`/`--color-negative`, chosen so a
 * match score doesn't borrow the applications board's vocabulary for "you
 * have an offer" / "rejected" — the two never sit on screen together, but
 * they'd still be the same colour meaning two different things.
 *
 * One hue per band, not two bands sharing a hue family (the old green/lime
 * and amber/orange pairs read as the same colour at a glance). Fair match —
 * the old 50-64 band — folds into Weak match instead of getting its own
 * colour, since below Good is all "don't count on this one."
 */
const TIERS = [
  { min: 90, label: "Excellent match", color: "var(--color-brand)" },
  { min: 80, label: "Strong match", color: "#22c55e" },
  { min: 65, label: "Good match", color: "#eab308" },
  { min: 0, label: "Weak match", color: "#ef4444" },
] as const;

function tierFor(score: number) {
  return TIERS.find((tier) => score >= tier.min) ?? TIERS[TIERS.length - 1];
}

export function matchTier(score: number) {
  return tierFor(score).label;
}

/** The hex a match's ring and tier label draw in — see the note on `TIERS`. */
export function matchColor(score: number) {
  return tierFor(score).color;
}

/**
 * The facets the filter row offers, and the options behind each one.
 *
 * Location and keyword are deliberately not here: the top bar's search field
 * already owns both, and a filter chip for "United States" or "Frontend
 * Engineer" would just be a second, disagreeing way to set the same query.
 * What's left is the set every job board narrows on — type, workplace,
 * level, and how fresh the posting is — plus the three that are common
 * enough to want but not frequent enough to earn permanent row space, kept
 * behind All Filters instead.
 */
export const JOB_TYPE_OPTIONS = [
  "Full-time",
  "Part-time",
  "Contract",
  "Contract to hire",
  "Internship",
];

export const WORKPLACE_OPTIONS = ["On-site", "Hybrid", "Remote"];

export const EXPERIENCE_OPTIONS = ["Entry", "Mid", "Senior", "Staff", "Lead"];

export const DATE_POSTED_OPTIONS = ["Past 24 hours", "Past week", "Past month", "Any time"];

export const LOCATION_OPTIONS = ["Remote (US)", "New York, NY", "Seattle, WA", "Austin, TX"];

export const SALARY_OPTIONS = ["$80k+", "$120k+", "$160k+", "$200k+"];

export const INDUSTRY_OPTIONS = [
  "B2B SaaS",
  "Data Infrastructure",
  "Fintech",
  "Healthcare",
  "Logistics",
];

export const RECOMMENDATIONS: Recommendation[] = [
  {
    id: "northwind-staff-frontend-engineer",
    title: "Staff Frontend Engineer",
    company: "Northwind Analytics",
    industries: ["Data Infrastructure", "B2B SaaS", "Series C"],
    Icon: CompassIcon,
    tone: "brand",
    flags: [{ label: "Posted 3h ago", fresh: true }, { label: "2 alumni here" }],
    location: "Seattle, WA",
    workplace: "Hybrid",
    jobType: "Full-time",
    level: "Senior, Staff",
    salary: "$165k - $210k",
    starts: "Immediate start",
    applicants: "Under 25 applicants",
    match: 94,
    highlights: [
      { text: "React and TypeScript depth", met: true },
      { text: "Pays above your $150k floor", met: true },
      { text: "Two days on-site each week", met: false },
    ],
    saved: true,
  },
  {
    id: "lumen-product-engineer-design-systems",
    title: "Product Engineer, Design Systems",
    company: "Lumen Labs",
    industries: ["Developer Tools", "Artificial Intelligence", "Series B"],
    Icon: SunIcon,
    tone: "deep",
    flags: [{ label: "Posted 9h ago", fresh: true }, { label: "Early applicant" }],
    location: "Remote (US)",
    workplace: "Remote",
    jobType: "Full-time",
    level: "Mid, Senior",
    salary: "$150k - $185k",
    starts: "Start date flexible",
    applicants: "31 applicants",
    match: 88,
    highlights: [
      { text: "Design-systems work you saved twice", met: true },
      { text: "Sponsors H1B", met: true },
      { text: "Team of 12, smaller than you filtered for", met: false },
    ],
  },
  {
    id: "atlas-senior-software-engineer-web",
    title: "Senior Software Engineer, Web",
    company: "Atlas Freight",
    industries: ["Logistics", "Marketplace", "Public Company"],
    Icon: LayersIcon,
    tone: "brand",
    flags: [{ label: "Reposted 2d ago" }, { label: "6 alumni here" }],
    location: "Austin, TX",
    workplace: "On-site",
    jobType: "Full-time",
    level: "Senior",
    salary: "$140k - $175k",
    starts: "Starts Oct 2026",
    applicants: "80+ applicants",
    match: 76,
    highlights: [
      { text: "Matches your Node and GraphQL work", met: true },
      { text: "On-site five days a week", met: false },
      { text: "No relocation package", met: false },
    ],
  },
  {
    id: "verdant-frontend-engineer-ii",
    title: "Frontend Engineer II",
    company: "Verdant Health",
    industries: ["Healthcare", "Telemedicine", "Series A"],
    Icon: LeafIcon,
    tone: "positive",
    flags: [{ label: "Posted 4d ago" }, { label: "Early applicant" }],
    location: "Boston, MA",
    workplace: "Hybrid",
    jobType: "Contract to hire",
    level: "Mid-level",
    salary: "$120k - $145k",
    starts: "Starts Jan 2027",
    applicants: "45 applicants",
    match: 58,
    highlights: [
      { text: "Accessibility work you list as a strength", met: true },
      { text: "Contract for the first six months", met: false },
      { text: "Below your salary floor", met: false },
    ],
  },
];
