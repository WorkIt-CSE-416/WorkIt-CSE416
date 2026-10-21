/**
 * Copy and sample data for the landing page's product tour
 * (product-tour.tsx): the feature list and the data each feature's
 * animation uses. The candidate and resumes are fictional. Every stop
 * names real employers the scraper reads, like the hero's cards; the
 * Auto Apply and Updates stops take theirs from the applications board
 * (./board-data.ts), so the sections match.
 */
import { stages } from "./board-data";

/** A company's site on the applications board, for its favicon. */
function boardDomain(company: string): string {
  const job = stages.flatMap((stage) => stage.jobs).find((item) => item.company === company);
  if (!job) throw new Error(`No application-board job for company "${company}"`);
  return job.domain;
}

export type FeatureId = "matching" | "resumes" | "auto-apply" | "updates";

/**
 * The carousel's features, in the hero's pipeline order: Tailored (resumes),
 * Matched, Applied (auto apply), Tracked (updates). `seconds` is how long each
 * shows before auto-advancing.
 */
export const features: { id: FeatureId; title: string; description: string; seconds: number }[] = [
  {
    id: "resumes",
    title: "A resume for every job",
    description:
      "Put everything you’ve done in one experience bank, or upload the resume you have. Pick a template and WorkIt writes the resume, then tailors it to each job posting.",
    seconds: 10,
  },
  {
    id: "matching",
    title: "Matched on your skills",
    description:
      "WorkIt scores every job posting against your experience bank, on your skills, past titles and experience, and puts the best fits first.",
    seconds: 7,
  },
  {
    id: "auto-apply",
    title: "Auto apply to your best matches",
    description:
      "WorkIt queues the jobs that fit you best, fills in every field of each application and attaches the resume tailored to it. You check each one and click Submit.",
    seconds: 7,
  },
  {
    id: "updates",
    title: "Know the moment they reply",
    description:
      "A view, a recruiter’s message, an interview invite, an offer: each one lands on your tracker the moment it happens, and moves the application along.",
    seconds: 9,
  },
];

// --- Matching: read the bank, scan postings, score, rank ---

/** The four things the app scores a posting on (backend matching/scoring.py). */
export type MatchFactor = "meaning" | "skills" | "title" | "experience";

export interface MatchJob {
  id: string;
  title: string;
  company: string;
  domain: string;
  /** A line from the posting; `keywords` light up where the student has them. */
  snippet: string;
  keywords: string[];
  score: number;
  /** Each factor from 0 to 1, for the top job's "why" bars. */
  factors: Record<MatchFactor, number>;
}

export const matchingFeature = {
  /** What the score reads from Alex Morgan's experience bank (the Resumes stop's). */
  profile: {
    degree: "Computer Science · 2027",
    skills: ["TypeScript", "Python", "SQL", "React", "Node.js"],
    titles: ["Teaching Assistant", "IT Support Intern"],
  },
  factorLabels: {
    meaning: "Meaning",
    skills: "Skills",
    title: "Title",
    experience: "Experience",
  } satisfies Record<MatchFactor, string>,
  /**
   * In the order they are scanned; ranking sorts them by score. Real
   * employers from scraper/boards.csv, intern and new-grad titles only,
   * like the hero's cards. The scores and lines are made up.
   */
  jobs: [
    {
      id: "spotify",
      title: "Backend Engineer Intern",
      company: "Spotify",
      domain: "spotify.com",
      snippet: "Build Java services on Kafka, with some Python tooling.",
      keywords: ["Java", "Kafka", "Python"],
      score: 63,
      factors: { meaning: 0.6, skills: 0.35, title: 0.5, experience: 1 },
    },
    {
      id: "stripe",
      title: "Software Engineer Intern",
      company: "Stripe",
      domain: "stripe.com",
      snippet: "Ship TypeScript and React tools on our payments APIs.",
      keywords: ["TypeScript", "React", "APIs"],
      score: 91,
      factors: { meaning: 0.92, skills: 0.85, title: 0.75, experience: 1 },
    },
    {
      id: "roblox",
      title: "Game Engineer Intern",
      company: "Roblox",
      domain: "roblox.com",
      snippet: "Write C++ and Lua for game systems and tools.",
      keywords: ["C++", "Lua"],
      score: 48,
      factors: { meaning: 0.45, skills: 0.1, title: 0.4, experience: 1 },
    },
    {
      id: "databricks",
      title: "New Grad Software Engineer",
      company: "Databricks",
      domain: "databricks.com",
      snippet: "Build data products in Python and SQL on Spark.",
      keywords: ["Python", "SQL", "Spark"],
      score: 86,
      factors: { meaning: 0.85, skills: 0.75, title: 0.7, experience: 1 },
    },
    {
      id: "duolingo",
      title: "Data Science Intern",
      company: "Duolingo",
      domain: "duolingo.com",
      snippet: "Run A/B tests and analyze them with SQL and R.",
      keywords: ["SQL", "R", "A/B tests"],
      score: 74,
      factors: { meaning: 0.72, skills: 0.45, title: 0.55, experience: 1 },
    },
  ] satisfies MatchJob[],
};

export const candidate = { name: "Alex Morgan" };

// --- Resumes: experience bank, template, generate, tailor ---

/** One loose entry in the experience bank, before it becomes a resume. */
export interface BankEntry {
  id: string;
  section: "Education" | "Experience" | "Projects" | "Leadership" | "Awards" | "Skills";
  title: string;
  detail: string;
  /** Where it floats in the jumble, in % of the stage, and its tilt. */
  x: number;
  y: number;
  tilt: number;
}

export const resumeFeature = {
  bank: [
    {
      id: "degree",
      section: "Education",
      title: "B.S. Computer Science",
      detail: "Northview University",
      x: 4,
      y: 6,
      tilt: -5,
    },
    {
      id: "ta",
      section: "Experience",
      title: "Teaching Assistant",
      detail: "Data Structures",
      x: 50,
      y: 2,
      tilt: 4,
    },
    {
      id: "help-desk",
      section: "Experience",
      title: "IT Support Intern",
      detail: "Campus Help Desk",
      x: 44,
      y: 30,
      tilt: -3,
    },
    {
      id: "budget",
      section: "Projects",
      title: "Budget Tracker",
      detail: "React · Node.js",
      x: 2,
      y: 38,
      tilt: 3,
    },
    {
      id: "club",
      section: "Leadership",
      title: "Treasurer",
      detail: "Coding Club",
      x: 50,
      y: 60,
      tilt: 5,
    },
    {
      id: "hackathon",
      section: "Awards",
      title: "1st Place",
      detail: "Spring Hackathon",
      x: 8,
      y: 70,
      tilt: -4,
    },
    {
      id: "skills",
      section: "Skills",
      title: "Python · SQL · Git",
      detail: "Languages and tools",
      x: 30,
      y: 84,
      tilt: 2,
    },
  ] satisfies BankEntry[],
  /** Jake's Resume is the template the app renders; the other two are looks to come. */
  templates: [
    { id: "jakes", label: "Jake's" },
    { id: "modern", label: "Modern" },
    { id: "compact", label: "Compact" },
  ],
  job: {
    title: "Software Engineer Intern",
    company: "Stripe",
    domain: "stripe.com",
    keywords: ["TypeScript", "REST APIs"],
    /** The match before tailoring; each suggestion adds its points. */
    before: 72,
  },
  /**
   * Mock AI suggestions for the tailor scene, two on each side of the page.
   * `target` names the line on the page it changes (resume-visual.tsx).
   */
  suggestions: [
    {
      id: "keep",
      kind: "keep",
      side: "right",
      target: "ta",
      title: "Keep",
      body: "Teaching shows you can explain code.",
      points: 0,
    },
    {
      id: "cut",
      kind: "cut",
      side: "left",
      target: "help-desk",
      title: "Cut",
      body: "Help desk work doesn’t fit this role.",
      points: 5,
    },
    {
      id: "rewrite",
      kind: "rewrite",
      side: "right",
      target: "budget",
      title: "Rewrite",
      body: "Name the stack the posting asks for.",
      points: 8,
    },
    {
      id: "add",
      kind: "add",
      side: "left",
      target: "languages",
      title: "Add",
      body: "TypeScript is the first skill they list.",
      points: 6,
    },
  ] satisfies ResumeSuggestion[],
};

export interface ResumeSuggestion {
  id: string;
  kind: "keep" | "cut" | "rewrite" | "add";
  side: "left" | "right";
  target: "ta" | "help-desk" | "budget" | "languages";
  title: string;
  body: string;
  points: number;
}

// --- Auto Apply: one application filled field by field, then a whole queue ---

/** One field on the sample application, in the order WorkIt fills it. */
export interface ApplicationField {
  id: string;
  label: string;
  value: string;
  /** How it fills: typed, picked from a list, a file attached, or a written answer. */
  kind?: "text" | "select" | "file" | "long";
  /** Half the form's width, beside its neighbour. */
  half?: boolean;
}

/** An employer in the zoomed-out grid of applications filling in parallel. */
export interface GridApplication {
  company: string;
  domain: string;
  title: string;
}

export const autoApplyFeature = {
  job: {
    title: "Frontend Engineer Intern",
    company: "Cloudflare",
    domain: boardDomain("Cloudflare"),
    place: "Austin, TX · Internship",
  },
  /** The address bar's text: a Greenhouse job board, as the scraper reads them. */
  url: "job-boards.greenhouse.io/cloudflare",
  /** The application, a Greenhouse-style form, in sections. */
  sections: [
    {
      title: "Personal information",
      fields: [
        { id: "first", label: "First name", value: "Alex", half: true },
        { id: "last", label: "Last name", value: "Morgan", half: true },
        { id: "email", label: "Email", value: "alex@example.com", half: true },
        // 555-01xx numbers are reserved for fiction.
        { id: "phone", label: "Phone", value: "(555) 014-2290", half: true },
        { id: "location", label: "Location (city)", value: "Chicago, Illinois" },
      ],
    },
    {
      title: "Resume",
      fields: [
        // The resume tailored to this posting in the Resumes stop.
        { id: "resume", label: "Resume/CV", value: "Alex_Morgan_Cloudflare.pdf", kind: "file" },
      ],
    },
    {
      title: "Links",
      fields: [
        { id: "linkedin", label: "LinkedIn", value: "linkedin.com/in/alexmorgan", half: true },
        { id: "github", label: "GitHub", value: "github.com/alexmorgan", half: true },
      ],
    },
    {
      title: "Education",
      fields: [
        { id: "school", label: "School", value: "Northview University", half: true },
        { id: "degree", label: "Degree", value: "B.S. Computer Science", half: true },
        { id: "grad", label: "Graduation date", value: "May 2027", half: true },
        { id: "start", label: "Earliest start date", value: "June 2027", half: true },
      ],
    },
    {
      title: "Application questions",
      fields: [
        {
          id: "authorized",
          label: "Are you legally authorized to work in the United States?",
          value: "Yes",
          kind: "select",
        },
        {
          id: "sponsorship",
          label: "Will you now or in the future require visa sponsorship?",
          value: "No",
          kind: "select",
        },
        {
          id: "why",
          label: "Why do you want to work at Cloudflare?",
          value:
            "I want to build the tools that keep the web fast and safe. Shipping a budgeting app that 200 students use every week showed me how much a slow page costs real people.",
          kind: "long",
        },
      ],
    },
    {
      title: "Voluntary self-identification",
      fields: [
        {
          id: "gender",
          label: "Gender",
          value: "Decline to self-identify",
          kind: "select",
          half: true,
        },
        {
          id: "veteran",
          label: "Veteran status",
          value: "I am not a protected veteran",
          kind: "select",
          half: true,
        },
      ],
    },
  ] satisfies { title: string; fields: ApplicationField[] }[],
  /** The other applications in the grid: the board's and Matching's real
   * employers, Cloudflare (the one filled up close) left out. */
  grid: [
    ...stages
      .flatMap((stage) => stage.jobs)
      .filter((job) => job.company !== "Cloudflare")
      .map(({ company, domain, title }) => ({ company, domain, title })),
    ...matchingFeature.jobs.map(({ company, domain, title }) => ({ company, domain, title })),
  ] satisfies GridApplication[],
};

// --- Recruiter updates ---

export interface RecruiterUpdate {
  id: string;
  company: string;
  /** The company's site, for its favicon. */
  domain: string;
  kind: "viewed" | "screen" | "interview" | "message" | "offer";
  /** Follows the company name, e.g. "Cloudflare viewed your application". */
  action: string;
  detail: string;
}

export const updatesFeature = {
  /** The application the Updates stop follows: the one Auto Apply just filled. */
  application: {
    title: "Frontend Engineer Intern",
    company: "Cloudflare",
    domain: boardDomain("Cloudflare"),
    applied: "Oct 1",
  },
  /** What the recruiter writes, and the student's quick replies. */
  message: {
    text: "Hi Alex, thanks for applying! Are you free Thursday for a 45-minute technical interview?",
    replies: ["Thursday works!", "Could we do Friday?"],
  },
  interview: {
    title: "Technical interview",
    /** The week it falls in, Monday first; `day` is its index. */
    week: [
      { day: "Mon", date: 5 },
      { day: "Tue", date: 6 },
      { day: "Wed", date: 7 },
      { day: "Thu", date: 8 },
      { day: "Fri", date: 9 },
    ],
    day: 3,
    time: "1:00 – 1:45 PM",
  },
  offer: { term: "Summer 2027", replyBy: "Oct 20" },
  /** A feed of updates across the board's companies, for the journey's
   * "Hear back" card. */
  updates: (
    [
      {
        id: "cloudflare-viewed",
        company: "Cloudflare",
        kind: "viewed",
        action: "viewed your application",
        detail: "Frontend Engineer Intern",
      },
      {
        id: "ramp-interview",
        company: "Ramp",
        kind: "interview",
        action: "moved you to Interview",
        detail: "System design round · Oct 8",
      },
      {
        id: "coinbase-message",
        company: "Coinbase",
        kind: "message",
        action: "sent you a message",
        detail: "“Are you free Thursday to pair?”",
      },
      {
        id: "plaid-screen",
        company: "Plaid",
        kind: "screen",
        action: "booked a recruiter screen",
        detail: "Oct 3, 2:30 PM EST",
      },
      {
        id: "vercel-offer",
        company: "Vercel",
        kind: "offer",
        action: "sent you an offer",
        detail: "Software Engineer, New Grad · reply by Oct 20",
      },
    ] satisfies Omit<RecruiterUpdate, "domain">[]
  ).map((update): RecruiterUpdate => ({ ...update, domain: boardDomain(update.company) })),
};
