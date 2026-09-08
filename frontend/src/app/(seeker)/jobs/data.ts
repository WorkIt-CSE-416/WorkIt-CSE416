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
 * What a score is called.
 *
 * Bands rather than a bare percentage because a number alone invites a reading
 * it has not earned — 76 and 74 are not two different things. The thresholds
 * are a placeholder: whoever owns the matching model sets the real ones, and
 * the labels are the only place the screen states them.
 */
const TIERS = [
  { min: 85, label: "Strong match" },
  { min: 70, label: "Good match" },
  { min: 0, label: "Fair match" },
] as const;

export function matchTier(score: number) {
  return (TIERS.find((tier) => score >= tier.min) ?? TIERS[TIERS.length - 1]).label;
}

/** `active` is the one facet shown applied, so it is the one that can be cleared. */
export const FILTERS = [
  { label: "United States" },
  { label: "Frontend Engineer" },
  { label: "Full-time" },
  { label: "Remote (+2)", active: true },
  { label: "Date posted" },
  { label: "Experience" },
];

/** The sort the board opens on, and the reason the route is called this. */
export const SORT = "Best match";

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
    match: 68,
    highlights: [
      { text: "Accessibility work you list as a strength", met: true },
      { text: "Contract for the first six months", met: false },
      { text: "Below your salary floor", met: false },
    ],
  },
];
