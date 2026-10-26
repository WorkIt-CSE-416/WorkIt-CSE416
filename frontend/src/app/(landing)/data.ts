/**
 * The landing page's copy, from the team's marketing site (its site.ts and
 * home.ts). The testimonial is still the site's placeholder, written as
 * guidance, and stays hidden (`show`) until a real quote replaces it; the
 * layout stays intact. The feature carousel's copy is in feature-data.ts,
 * the application board's in board-data.ts.
 */

import { followedJob } from "./feature-data";

export const site = {
  name: "WorkIt",
  // The footer's sign-off and the home page's title. For students: the
  // site's two-sided pitch to recruiters went while the business side is
  // hidden.
  tagline: "Your job search, without the busywork.",
  primaryCta: { label: "Get started for free", href: "/signup" },
  login: { label: "Log in", href: "/login" },
  pricing: { label: "Pricing", href: "/pricing" },
  // The header's menus and the footer's Features and Resources columns list
  // features/catalog.ts and resources/catalog.ts; these are the footer's
  // other columns.
  footer: [
    {
      title: "Product",
      links: [
        { label: "Overview", href: "/" },
        { label: "Pricing", href: "/pricing" },
        { label: "FAQ", href: "/#faq" },
      ],
    },
    {
      title: "Account",
      links: [
        { label: "Log in", href: "/login" },
        { label: "Sign up", href: "/signup" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
      ],
    },
  ],
};

export const hero = {
  // The tagline, "Stop ___ by hand." (hero-title.tsx): the blank loops
  // through the pipeline in the tour's order, one chore a student knows per
  // step, starting on `rest`, auto apply, which with matching matters most;
  // with reduced motion it shows only `rest`. "By hand" carries the pain;
  // each phrase is a step WorkIt takes over.
  lead: "Stop",
  phrases: [
    "rewriting resumes",
    "searching for jobs",
    "filling out applications",
    "tracking applications",
  ],
  rest: 2,
  tail: "by hand.",
  // The promise, step by step. Auto apply fills the form and the student
  // clicks Submit (auto-apply/architecture.md), so it never says WorkIt
  // applies or sends.
  subtitle:
    "WorkIt learns your experience, builds and tailors your resume, finds the jobs that fit and fills in each application. You just click Submit.",
};

/**
 * The home page's hiring-systems section: the job pipeline
 * (docs/job-pipeline.md) drawn as a stream (hiring-systems.tsx). Every line
 * is a claim: the scraper runs every 3 hours, reads the company job boards
 * on the hiring systems below, keeps only internship and new-grad roles,
 * reads their facts, merges duplicates and drops postings that closed. The
 * page says "freshest" rather than the 3-hour schedule, at the team's ask,
 * and labels only the two ends of the pipeline (no cadence or sort note).
 */
export const hiringSystemsSection = {
  eyebrow: "Hiring systems",
  // "hiring systems" kept on one line: the page's own term, split across
  // two it read as two words.
  title: "Straight from the hiring\u00a0systems companies use",
  subtitle:
    "WorkIt pulls the freshest internships and new-grad roles from thousands of company job boards on these hiring systems, and links each one to the company's own application.",
  intake: "Company job boards",
  output: "Your Jobs page",
  /** What WorkIt does to the stream, one line at a time under its mark. */
  steps: [
    "Keeping internships and new-grad roles",
    "Reading pay, work style and visa",
    "Merging duplicate job postings",
    "Dropping job postings that closed",
  ],
};

/**
 * The hiring systems the scraper reads company job boards from
 * (scraper/workit_scraper/providers.py, PROVIDERS). Keep the two lists
 * the same: a name here is a claim that WorkIt reads it. Rippling and iCIMS
 * are read but not listed yet: each needs its logo file and a stream below. `logo` is a file
 * in public/hiring-systems/, from the company's own site or its GitHub
 * organization: Google's favicon host had only 16-32px copies of
 * BambooHR's and Workday's, which looked blurry. The header's Features
 * menu names the first three.
 */
export const hiringSystems = [
  { name: "Greenhouse", logo: "/hiring-systems/greenhouse.png" },
  { name: "Lever", logo: "/hiring-systems/lever.png" },
  { name: "Ashby", logo: "/hiring-systems/ashby.png" },
  { name: "Workday", logo: "/hiring-systems/workday.png" },
  { name: "Workable", logo: "/hiring-systems/workable.svg" },
  { name: "BambooHR", logo: "/hiring-systems/bamboohr.png" },
  { name: "Recruitee", logo: "/hiring-systems/recruitee.png" },
] as const;

export type HiringSystemName = (typeof hiringSystems)[number]["name"];

/** A job posting in the hiring-systems section's stream. */
export interface StreamPosting {
  company: string;
  /** The company's site, for its favicon. */
  domain: string;
  title: string;
  /** Only on a role the scraper keeps: the clean card it becomes. */
  card?: {
    location: string;
    /** Work style, then pay. */
    facts: [string, string];
    /** The match, in the score chip. */
    score: number;
  };
}

/**
 * Each hiring system's lane in the stream: real employers whose company
 * job board is on that hiring system in scraper/boards.csv. A posting with
 * a `card` is an internship, co-op or new-grad role in one of the
 * scraper's categories, so it is kept (docs/job-pipeline.md, 3.1); one
 * without is a senior role, dropped at WorkIt. The postings, facts and
 * scores are made up.
 */
export const streams: Record<HiringSystemName, StreamPosting[]> = {
  Greenhouse: [
    {
      company: "Stripe",
      domain: "stripe.com",
      title: "Software Engineer Intern",
      // The application the page follows: one score everywhere it shows.
      card: { location: "Seattle, WA", facts: ["Hybrid", "$55/hr"], score: followedJob.score },
    },
    { company: "Cloudflare", domain: "cloudflare.com", title: "Senior Systems Engineer" },
    {
      company: "Databricks",
      domain: "databricks.com",
      title: "Data Science Intern",
      card: { location: "San Francisco, CA", facts: ["Hybrid", "$60/hr"], score: 89 },
    },
  ],
  Lever: [
    {
      company: "Palantir",
      domain: "palantir.com",
      title: "Software Engineer, New Grad",
      card: { location: "New York, NY", facts: ["On site", "$160k/yr"], score: 81 },
    },
    { company: "Spotify", domain: "spotify.com", title: "Engineering Manager" },
    {
      company: "Zoox",
      domain: "zoox.com",
      title: "Firmware Engineer Intern",
      card: { location: "Foster City, CA", facts: ["On site", "$48/hr"], score: 72 },
    },
  ],
  Ashby: [
    {
      company: "Notion",
      domain: "notion.so",
      title: "Product Design Intern",
      card: { location: "San Francisco, CA", facts: ["Hybrid", "$50/hr"], score: 77 },
    },
    { company: "OpenAI", domain: "openai.com", title: "Research Scientist" },
    {
      company: "Plaid",
      domain: "plaid.com",
      title: "Product Manager Intern",
      card: { location: "New York, NY", facts: ["Hybrid", "$52/hr"], score: 83 },
    },
  ],
  Workday: [
    {
      company: "NVIDIA",
      domain: "nvidia.com",
      title: "Hardware Engineering Intern",
      card: { location: "Santa Clara, CA", facts: ["On site", "$58/hr"], score: 91 },
    },
    { company: "Netflix", domain: "netflix.com", title: "Senior Software Engineer" },
    {
      company: "Capital One",
      domain: "capitalone.com",
      title: "Financial Analyst Intern",
      card: { location: "McLean, VA", facts: ["Hybrid", "$45/hr"], score: 79 },
    },
  ],
  Workable: [
    {
      company: "Infleqtion",
      domain: "infleqtion.com",
      title: "Quantum Software Intern",
      card: { location: "Boulder, CO", facts: ["On site", "$32/hr"], score: 86 },
    },
    { company: "Genetec", domain: "genetec.com", title: "Director of Product Sales" },
  ],
  BambooHR: [
    { company: "Lunar Outpost", domain: "lunaroutpost.com", title: "Principal Systems Engineer" },
    {
      company: "Berkshire Grey",
      domain: "berkshiregrey.com",
      title: "Mechanical Engineering Co-op",
      card: { location: "Bedford, MA", facts: ["On site", "$28/hr"], score: 74 },
    },
  ],
  Recruitee: [
    {
      company: "1X",
      domain: "1x.tech",
      title: "Robotics Engineering Intern",
      card: { location: "Palo Alto, CA", facts: ["On site", "$45/hr"], score: 68 },
    },
    { company: "Hard Rock Digital", domain: "hardrockdigital.com", title: "Senior Data Engineer" },
  ],
};

export const testimonial = {
  // Hidden until a real, approved quote replaces the placeholder: shown, it
  // read as an unfinished site on production. Never fill it with an
  // invented quote.
  show: false,
  quote:
    "A short, specific customer quote about an outcome goes here. “We cut X in half within a month” lands harder than general praise.",
  name: "Customer Name",
  role: "Role, Company",
};

/**
 * Each answer is a claim about the product: the jobs' source must match the
 * hiring-system list above, and "you press Submit" is auto-apply's rule
 * (auto-apply/architecture.md). Pricing is not set, so the cost answer says
 * no more than the header's "Get started for free".
 */
export const faqs = [
  {
    question: "What is WorkIt?",
    // "On one board" went: the Applications board is archived and the list
    // is the default view (KAN-256).
    answer:
      "WorkIt is a job search app for college students. It finds the internships and new-grad jobs that fit you, tailors your resume to each one, fills in the application, and keeps track of every job you save or apply to.",
  },
  {
    question: "Who is WorkIt for?",
    answer:
      "Students and recent graduates applying for internships and entry-level roles, especially anyone sending a lot of applications and losing track of them.",
  },
  {
    question: "Where do the jobs come from?",
    answer:
      "Straight from company job boards on the hiring systems companies use, such as Greenhouse, Lever, Ashby and Workday. Every job posting links to the company's own application.",
  },
  {
    question: "Does WorkIt apply without me?",
    answer:
      "No. WorkIt tailors your resume and the Chrome extension fills in the company's form, but you check every application and press Submit yourself.",
  },
  {
    question: "How much does it cost?",
    answer: "Getting started is free. Sign up and you can search, tailor and track right away.",
  },
  {
    question: "How do I get started?",
    answer:
      "Sign up and upload a resume. WorkIt reads it into your experience bank and starts ranking jobs by how well you fit.",
  },
];

/** The applications section's heading (applications.tsx), as KAN-316 wrote it. */
export const applicationsSection = {
  // The feature's name, as in the Features menu: "For applicants" said
  // nothing once the whole site was for applicants.
  eyebrow: "Application tracker",
  title: "Every application, from saved to signed.",
  // What the tracker keeps today (frontend/CLAUDE.md, the application
  // tracker): one list, each job's match score and the resume it went out
  // with. The board, a next step and a deadline per card are not built.
  subtitle:
    "Every role you save or apply to sits in one list, with its match score and, once you apply, the resume you sent.",
};

/** The home page's closing call to action (closing-cta.tsx). Its claims
 * are the FAQ's "How do I get started?" answer. */
export const closing = {
  title: "Find the jobs that fit you",
  subtitle:
    "Sign up free and upload a resume. WorkIt reads it and starts ranking jobs by how well you fit.",
};
