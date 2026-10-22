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
  // The site's Features, Resources and Pricing pages are not part of the
  // app, so the header links to this page's own sections.
  nav: [
    { label: "Features", href: "#features" },
    { label: "Applications", href: "#applications" },
    { label: "FAQ", href: "#faq" },
  ],
  footer: [
    {
      title: "Product",
      links: [
        { label: "Features", href: "/#features" },
        { label: "Applications", href: "/#applications" },
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
  // The pipeline in order, one beat per step, each in the past tense: things
  // WorkIt did for you. Plain spaces: text-balance makes two lines of two
  // from sm up, and one beat per line on a phone, where a pair of beats is
  // wider than the screen (a joined pair once overflowed, and overflowing
  // text is invisible under bg-clip-text).
  titleLines: ["Tailored. Matched. Applied. Tracked."],
  subtitle:
    "WorkIt tailors your resume to each role, finds the jobs that fit, applies for you, and keeps every application on track.",
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
    body: "Tailor a resume from your Experience Bank, then let autofill fill the company's own form.",
    points: [
      "Resumes built from your Experience Bank",
      "Autofill on the company's own form",
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
 * The hiring systems the scraper reads company job boards from
 * (scraper/workit_scraper/providers.py, LISTING_URL). Keep the two lists
 * the same: a name here is a claim that WorkIt reads it. `domain` feeds the
 * favicon service next.config.ts already allows.
 */
export const hiringSystemsSection = {
  eyebrow: "Hiring systems",
  title: "Straight from the hiring systems companies use",
  subtitle:
    "WorkIt reads job postings from company job boards on these hiring systems, so every role links to the company's own application.",
};

export const hiringSystems = [
  { name: "Greenhouse", domain: "greenhouse.com" },
  { name: "Lever", domain: "lever.co" },
  { name: "Ashby", domain: "ashbyhq.com" },
  { name: "Workday", domain: "workday.com" },
  { name: "Workable", domain: "workable.com" },
  { name: "BambooHR", domain: "bamboohr.com" },
  { name: "Recruitee", domain: "recruitee.com" },
];

/** The two cards under the hiring systems, after Calendly's suite cards. */
export const companions = [
  {
    id: "extension",
    title: "Autofill for Chrome",
    body: "The WorkIt extension fills the company's own application form from your profile. You check it over and press Submit yourself.",
  },
  {
    id: "scout",
    title: "Scout, your job assistant",
    body: "Ask Scout about any job posting: what the role needs, how you fit, and what to do next.",
  },
] as const;

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
