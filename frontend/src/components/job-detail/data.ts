import type { ComponentType } from "react";

import { BuildingIcon } from "@/app/company/icons";
import { COMPANY } from "@/app/company/profile/data";
import { POSTINGS, type JobStatus, type Posting } from "@/app/company/jobs/data";
import { RECOMMENDATIONS, type Highlight, type Recommendation } from "@/app/(seeker)/jobs/data";
import type { CompanyTileTone } from "@/components/ui/company-tile";

/**
 * The one job posting fixture both /company/jobs/[jobId] and /jobs/[jobId]
 * read from, keyed by an id both list screens already carry.
 *
 * Every field a fact or a card elsewhere already shows is DERIVED from that
 * fixture — `fromPosting`/`fromRecommendation` below read `POSTINGS` and
 * RECOMMENDATIONS` rather than re-typing their values, which is what keeps
 * the expanded view honest with the row or the card someone clicked to open
 * it. Only what neither fixture carries (the long-form copy, and — for a
 * company posting, which has no `level`/`starts` of its own — those two
 * facts) is authored here, in the per-id `*_EXTRAS` records below.
 *
 * `companyAbout`/`about`/`responsibilities`/`qualifications` stand in for
 * the schema's single markdown `description` column — nothing renders
 * markdown yet, the same call (seeker)/search/data.ts already made for its
 * DETAIL fixture.
 */
export type JobPosting = {
  id: string;

  companyName: string;
  /** Employer mark stand-in. The seeker page draws this; the company page
   *  always draws its own BuildingIcon instead, since a company has no
   *  logo to pick for itself. */
  Icon: ComponentType<{ className?: string }>;
  tone: CompanyTileTone;

  title: string;
  status: JobStatus;

  /** Free text, matching `Posting`/`Recommendation`'s own fields rather than
   *  a narrower enum — a job_postings column will eventually constrain this,
   *  but until then the fixture it was opened from is the source of truth. */
  jobType: string;
  workStyle: string;
  /** "Senior, Staff", "Mid-level" — `Recommendation.level`'s own shape, not
   *  the schema's `experience_level` enum, so the seeker feed and this page
   *  never describe the same posting two different ways. */
  level: string;
  starts: string;
  /** Always a display string, e.g. "Austin, TX" or "Remote" — never absent,
   *  matching `Posting.location`/`Recommendation.location`, which never are
   *  either. */
  locationCity: string;
  salary: string;

  postedAt: string; // ISO
  updatedAt: string; // ISO
  closesAt?: string; // ISO

  /** One short paragraph about the employer — who's hiring, not what the
   *  role does (see `about`) — shown under the facts. */
  companyAbout: string;
  about: string;
  responsibilities: string[];
  qualifications: string[];

  /** Company side only. */
  applicantCount?: number;
  unreviewedCount?: number;

  /** Seeker side only. */
  match?: number;
  highlights?: Highlight[];
};

/** What `Posting` has no field for: the two facts a company posting still
 *  needs, and the long-form copy. `jobType`/`salary` also live here — the
 *  postings table tracks neither — while `workStyle`/`locationCity` are
 *  derived from `Posting.location` in `fromPosting` instead of repeated. */
type CompanyExtra = {
  jobType: string;
  salary: string;
  level: string;
  starts: string;
  companyAbout: string;
  about: string;
  responsibilities: string[];
  qualifications: string[];
  /** Only when a posting was touched after it went up — closing it, most
   *  often, which is also when `closesAt` is set. */
  updatedAt?: string;
  closesAt?: string;
};

function fromPosting(source: Posting, extra: CompanyExtra): JobPosting {
  return {
    id: source.id,
    companyName: COMPANY.name,
    Icon: BuildingIcon,
    tone: "outline",
    title: source.role,
    status: source.status,
    jobType: extra.jobType,
    workStyle: source.location === "Remote" ? "Remote" : "Onsite",
    level: extra.level,
    starts: extra.starts,
    locationCity: source.location,
    salary: extra.salary,
    postedAt: source.posted,
    updatedAt: extra.updatedAt ?? source.posted,
    closesAt: extra.closesAt,
    companyAbout: extra.companyAbout,
    about: extra.about,
    responsibilities: extra.responsibilities,
    qualifications: extra.qualifications,
    applicantCount: source.applicants,
    unreviewedCount: source.unreviewed,
  };
}

/** What `Recommendation` has no field for: the long-form copy and a real
 *  posted date (its own fixture only carries a "Posted 3h ago"-style label,
 *  authored for a flag with nothing behind it — see the note on
 *  `formatRelativeTime`). Everything else — `jobType`, `workStyle`, `level`,
 *  `starts`, `locationCity`, `salary` — comes straight from `source`. */
type SeekerExtra = {
  companyAbout: string;
  about: string;
  responsibilities: string[];
  qualifications: string[];
  postedAt: string;
};

function fromRecommendation(source: Recommendation, extra: SeekerExtra): JobPosting {
  return {
    id: source.id,
    companyName: source.company,
    Icon: source.Icon,
    tone: source.tone,
    title: source.title,
    status: "Open",
    jobType: source.jobType,
    workStyle: source.workplace,
    level: source.level,
    starts: source.starts,
    locationCity: source.location,
    salary: source.salary,
    postedAt: extra.postedAt,
    updatedAt: extra.postedAt,
    companyAbout: extra.companyAbout,
    about: extra.about,
    responsibilities: extra.responsibilities,
    qualifications: extra.qualifications,
    match: source.match,
    highlights: source.highlights,
  };
}

const COMPANY_EXTRAS: Record<string, CompanyExtra> = {
  j1: {
    jobType: "Full-time",
    salary: "$95k - $120k",
    level: "New Grad",
    starts: "Immediate start",
    companyAbout: COMPANY.about[0],
    about:
      "TechNova Solutions is hiring a new-grad Frontend Engineer for the core product team, building the React and TypeScript interfaces our customers use every day. You will pair closely with senior engineers while owning real features from your first sprint.",
    responsibilities: [
      "Ship UI features in React and TypeScript alongside senior engineers.",
      "Fix bugs and write tests across the product's component library.",
      "Take part in code review and sprint planning from day one.",
    ],
    qualifications: [
      "A recent or upcoming degree in Computer Science or a related field.",
      "Comfortable with JavaScript/TypeScript and a modern framework.",
      "Eager to learn a large, existing codebase.",
    ],
  },
  j2: {
    jobType: "Full-time",
    salary: "$150k - $190k",
    level: "Experienced",
    starts: "Immediate start",
    companyAbout: COMPANY.about[0],
    about:
      "The Infrastructure team keeps every other engineering team shipping. As a Platform Engineer you will own the internal tooling, CI/CD pipelines, and cloud infrastructure that TechNova's product teams build on top of.",
    responsibilities: [
      "Operate and improve the CI/CD pipelines every team depends on.",
      "Design cloud infrastructure for reliability and cost.",
      "Build internal tooling that removes toil for product engineers.",
    ],
    qualifications: [
      "4+ years operating production infrastructure at scale.",
      "Deep comfort with Kubernetes, Terraform, and a major cloud provider.",
      "Track record of improving a system's reliability, not just its features.",
    ],
  },
  j3: {
    jobType: "Full-time",
    salary: "$28/hr",
    level: "Internship",
    starts: "Summer 2027",
    companyAbout: COMPANY.about[0],
    about:
      "A summer internship on the Analytics team, working with product and revenue data to help TechNova make better-informed decisions. You will build dashboards and dig into the questions the team hasn't had time to answer.",
    responsibilities: [
      "Build and maintain dashboards for product and revenue metrics.",
      "Run ad-hoc analyses for the Analytics and Product teams.",
      "Present findings at the end-of-summer intern showcase.",
    ],
    qualifications: [
      "Currently pursuing a degree in a quantitative field.",
      "Comfortable with SQL and a scripting language such as Python.",
      "Curious about the story behind a number, not just the number.",
    ],
  },
  j4: {
    jobType: "Full-time",
    salary: "$130k - $165k",
    level: "Experienced",
    starts: "Start date TBD",
    companyAbout: COMPANY.about[0],
    updatedAt: "2026-07-18",
    about:
      "TechNova's design system, Beacon, is the shared foundation every product surface is built on. As its engineer you will grow its component library and keep it in step with the product team's fast-moving mockups.",
    responsibilities: [
      "Design and build reusable components for the Beacon system.",
      "Partner with product designers to turn mockups into tokens and components.",
      "Document usage guidance so teams adopt components correctly the first time.",
    ],
    qualifications: [
      "3+ years building component libraries or design systems.",
      "Strong CSS fundamentals and an eye for interaction detail.",
      "Experience partnering directly with a design team.",
    ],
  },
  j5: {
    jobType: "Full-time",
    salary: "$145k - $180k",
    level: "Experienced",
    starts: "Immediate start",
    companyAbout: COMPANY.about[0],
    about:
      "Keep TechNova's production systems fast and available. This SRE role sits on-call for the Infrastructure team, driving incident response and the reliability work that prevents the next one.",
    responsibilities: [
      "Carry on-call rotation and lead incident response.",
      "Set and track SLOs for the product's critical services.",
      "Drive reliability projects that reduce recurring pages.",
    ],
    qualifications: [
      "4+ years in an SRE, DevOps, or production infrastructure role.",
      "Comfortable reading and writing Go, Python, or a similar language.",
      "Calm under a live incident and clear in a postmortem.",
    ],
  },
  j6: {
    jobType: "Full-time",
    salary: "$90k - $115k",
    level: "Experienced",
    starts: "Not yet published",
    companyAbout: COMPANY.about[0],
    about:
      "TechNova is hiring its first dedicated Technical Writer, to bring the same clarity to our docs that our engineers bring to our product. You will own the developer-facing documentation end to end.",
    responsibilities: [
      "Write and maintain developer-facing documentation and API references.",
      "Work with engineers to keep docs in step with what ships.",
      "Set a house style other teams can write against.",
    ],
    qualifications: [
      "2+ years writing technical documentation for a software product.",
      "Comfortable reading code well enough to document it accurately.",
      "A portfolio of clear, well-structured docs.",
    ],
  },
  j7: {
    jobType: "Full-time",
    salary: "$160k - $200k",
    level: "Experienced",
    starts: "Position filled",
    companyAbout: COMPANY.about[0],
    updatedAt: "2026-06-20",
    closesAt: "2026-06-20",
    about:
      "The Payments team moves money correctly, every time. This role owned the ledger and settlement services behind every transaction TechNova processes.",
    responsibilities: [
      "Built and operated the ledger and settlement services.",
      "Partnered with Finance on reconciliation and audit tooling.",
      "Held a high bar for correctness and idempotency in every change.",
    ],
    qualifications: [
      "5+ years building backend systems that handle money or other high-stakes data.",
      "Strong grasp of transactional correctness and idempotency.",
      "Experience working directly with a Finance or Risk team.",
    ],
  },
  j8: {
    jobType: "Full-time",
    salary: "$155k - $195k",
    level: "Experienced",
    starts: "Immediate start",
    companyAbout: COMPANY.about[0],
    about:
      "The Analytics team is building TechNova's first recommendation models. As an ML Engineer you will take a model from notebook to production, and own its performance once it's live.",
    responsibilities: [
      "Build and ship machine learning models into production.",
      "Design the data pipelines a model depends on.",
      "Monitor live model performance and retrain as it drifts.",
    ],
    qualifications: [
      "3+ years shipping ML models to production, not just research.",
      "Strong Python and comfort with a modern ML framework.",
      "Experience owning a model's performance after launch.",
    ],
  },
};

const SEEKER_EXTRAS: Record<string, SeekerExtra> = {
  "northwind-staff-frontend-engineer": {
    companyAbout:
      "Northwind Analytics builds the data infrastructure other engineering teams trust. Founded in 2019, it has grown from a two-person team into the pipeline layer several hundred companies now run their own products on.",
    about:
      "As Staff Frontend Engineer you will set technical direction for the console our customers use to monitor their pipelines, and mentor the engineers building it.",
    responsibilities: [
      "Set technical direction for the customer-facing console.",
      "Lead architecture decisions across the frontend organization.",
      "Mentor senior and mid-level engineers, and raise the team's review bar.",
      "Partner with design and product on the console's next generation.",
    ],
    qualifications: [
      "8+ years of professional frontend experience, some of it at staff level.",
      "Deep expertise in React and TypeScript at scale.",
      "A track record of pay above the $150k floor for comparable roles.",
      "Comfortable spending two days a week on-site in Seattle.",
    ],
    postedAt: "2026-09-15",
  },
  "lumen-product-engineer-design-systems": {
    companyAbout:
      "Lumen Labs is a developer-tools startup building AI-assisted workflows. Its editor and design system are used by engineering teams ranging from early-stage startups to publicly traded software companies.",
    about:
      "This role owns the design system every product surface is drawn from, working closely with a design team of three.",
    responsibilities: [
      "Grow and maintain the shared component library.",
      "Pair with design on new patterns as the product expands.",
      "Keep the system's documentation and usage guidance current.",
    ],
    qualifications: [
      "4+ years building design systems or component libraries.",
      "Experience sponsoring or working under H1B sponsorship a plus.",
      "Comfortable on a small team of twelve, with high individual ownership.",
    ],
    postedAt: "2026-09-15",
  },
  "atlas-senior-software-engineer-web": {
    companyAbout:
      "Atlas Freight moves freight across a marketplace of carriers and shippers. The company matches loads to trucks in real time, coordinating thousands of shipments a day across a network that spans the continental U.S.",
    about:
      "This role builds the web tools dispatchers use to match a load to a truck in seconds, not minutes.",
    responsibilities: [
      "Build and maintain the dispatcher-facing web application.",
      "Work with Node and GraphQL across the marketplace's core services.",
      "Pair with operations to turn workflow pain points into features.",
    ],
    qualifications: [
      "6+ years building production web applications.",
      "Strong Node and GraphQL experience.",
      "Comfortable working on-site five days a week in Austin.",
      "No relocation package is offered for this role.",
    ],
    postedAt: "2026-09-13",
  },
  "verdant-frontend-engineer-ii": {
    companyAbout:
      "Verdant Health builds telemedicine software for community clinics. Its platform connects patients in underserved areas with providers, and today supports care teams across dozens of clinics nationwide.",
    about:
      "This is a six-month contract-to-hire role, focused on making the patient portal usable for people who don't consider themselves technical.",
    responsibilities: [
      "Build accessible, responsive UI for the patient portal.",
      "Run usability sessions with clinic staff and patients.",
      "Contribute to the accessibility audit ahead of the portal's next release.",
    ],
    qualifications: [
      "3+ years of frontend experience, with real accessibility work.",
      "Comfortable starting on a six-month contract before conversion.",
      "Empathy for users who are not confident with technology.",
    ],
    postedAt: "2026-09-11",
  },
};

export const JOB_POSTINGS: JobPosting[] = [
  ...POSTINGS.map((posting) => fromPosting(posting, COMPANY_EXTRAS[posting.id])),
  ...RECOMMENDATIONS.map((recommendation) =>
    fromRecommendation(recommendation, SEEKER_EXTRAS[recommendation.id]),
  ),
];

export function getJobPosting(id: string) {
  return JOB_POSTINGS.find((posting) => posting.id === id);
}
