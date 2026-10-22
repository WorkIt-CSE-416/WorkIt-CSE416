/**
 * The landing page's copy, from the team's marketing site (its site.ts and
 * home.ts). The testimonial is still the site's placeholder, written as guidance:
 * replace it with a real quote and the layout stays intact. The feature
 * carousel's copy is in feature-data.ts, the application board's in
 * board-data.ts.
 */

export const site = {
  name: "WorkIt",
  tagline: "Where candidates and recruiters finally share a platform.",
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
  ],
};

export const hero = {
  // The tagline, "Stop ___ by hand." (hero-title.tsx): the blank walks the
  // pipeline in the tour's order, one chore a student knows per step, and
  // rests on `rest`, auto apply, which with matching matters most. "By hand"
  // carries the pain; each phrase is a step WorkIt takes over.
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
 * The search end to end, in the hero's own words (journey.tsx). `line` shows
 * while a card is closed, `body` once it is open. `glow` is an app colour, so
 * each step matches its stop in the product tour.
 */
export type JourneyStep = {
  id: "find" | "apply" | "track" | "hear";
  title: string;
  line: string;
  body: string;
  points: string[];
  glow: string;
};

export const journeySection = {
  eyebrow: "How it works",
  title: "Your whole job search, in one place",
  subtitle:
    "From the first search to the offer, WorkIt keeps every step together, so nothing slips between tabs.",
};

export const journey: JourneyStep[] = [
  {
    id: "find",
    title: "Find",
    line: "Roles you fit, first.",
    body: "Open roles come straight from company job boards, ranked by how well your skills fit each one.",
    points: [
      "A match score on every job posting",
      "Filters for role, level and work style",
      "Save a role for later in one click",
    ],
    glow: "var(--color-brand)",
  },
  {
    id: "apply",
    title: "Apply",
    line: "Less typing, every time.",
    body: "Tailor a resume from your Experience Bank, then let Auto Apply fill each company's own form. You press Submit.",
    points: [
      "Resumes built from your Experience Bank",
      "Auto Apply on the company's own form",
      "A copy of every resume you send",
    ],
    glow: "var(--color-advanced)",
  },
  {
    id: "track",
    title: "Track",
    line: "Every application, one board.",
    body: "Each application moves from Saved to Offer, with its next step and deadline on the card.",
    points: [
      "One board from Saved to Offer",
      "The next step and deadline on each card",
      "Interviews on your calendar",
    ],
    glow: "var(--color-positive)",
  },
  {
    id: "hear",
    title: "Hear back",
    line: "Know the moment they act.",
    body: "Views, interview invites, messages and offers show up the moment a recruiter acts.",
    points: [
      "Updates as recruiters move you forward",
      "Interview times and offer deadlines",
      "Your tracker updates itself",
    ],
    glow: "var(--color-match-good)",
  },
];

/**
 * The home page's hiring-systems section: the job pipeline
 * (docs/job-pipeline.md) drawn as a stream (hiring-systems.tsx). Every line
 * is a claim: the scraper runs every 3 hours, reads the company job boards
 * on the hiring systems below, keeps only internship and new-grad roles,
 * reads their facts, merges duplicates and drops postings that closed.
 */
export const hiringSystemsSection = {
  eyebrow: "Hiring systems",
  title: "Straight from the hiring systems companies use",
  subtitle:
    "Every 3 hours, WorkIt reads thousands of company job boards on these hiring systems, keeps the internships and new-grad roles, and links each one to the company's own application.",
  intake: "Company job boards",
  output: "Your Jobs page",
  sort: "Sorted by Best Match",
  cadence: "Every 3 hours",
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
 * (scraper/workit_scraper/providers.py, LISTING_URL). Keep the two lists
 * the same: a name here is a claim that WorkIt reads it. `logo` is a file
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
      card: { location: "Seattle, WA", facts: ["Hybrid", "$55/hr"], score: 94 },
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
    answer:
      "WorkIt is a job search app for college students. It finds the internships and new-grad jobs that fit you, tailors your resume to each one, fills in the application, and keeps every application on one board.",
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
