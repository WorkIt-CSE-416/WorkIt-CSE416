/**
 * Copy and sample data for the landing page's product tour
 * (product-tour.tsx): the feature list and the data each feature's
 * animation uses. The candidate and resumes are fictional. The Autofill and
 * Updates stops' companies are too, and reuse the logos from the
 * application board (./board-data.ts) so the two sections match; the
 * Resumes and Matching stops name real employers the scraper reads, like
 * the hero's cards.
 */
import type { LucideIcon } from "lucide-react";
import { stages } from "./board-data";

/** Logo and tile colors for a company on the application board. */
function companyLogo(company: string): { logo: LucideIcon; logoTone: string } {
  const job = stages.flatMap((stage) => stage.jobs).find((item) => item.company === company);
  if (!job) throw new Error(`No application-board job for company "${company}"`);
  return { logo: job.logo, logoTone: job.logoTone };
}

export type FeatureId = "matching" | "resumes" | "autofill" | "updates";

/**
 * The carousel's features, in the hero's pipeline order: Tailored (resumes),
 * Matched, Applied (autofill), Tracked (updates). `seconds` is how long each
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
    id: "autofill",
    title: "Autofill on every application",
    description:
      "Your profile fills in every WorkIt application, resume attached. Check it over, then send.",
    seconds: 7,
  },
  {
    id: "updates",
    title: "Hear back, right here",
    description:
      "Views, interview invites, messages, and offers show up the moment a recruiter acts.",
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

// --- Autofill ---

export const autofillFeature = {
  job: { title: "Frontend Engineer", company: "Nimbus Cloud", ...companyLogo("Nimbus Cloud") },
  fields: [
    { id: "name", label: "Full name", value: candidate.name },
    { id: "email", label: "Email", value: "alex@example.com" },
    // Shown as an attached file rather than typed text.
    { id: "resume", label: "Resume", value: "Frontend.pdf", file: true },
  ],
};

// --- Recruiter updates ---

export interface RecruiterUpdate {
  id: string;
  company: string;
  logo: LucideIcon;
  logoTone: string;
  kind: "viewed" | "screen" | "interview" | "message" | "offer";
  /** Follows the company name, e.g. "Nimbus Cloud viewed your application". */
  action: string;
  detail: string;
}

export const updatesFeature = {
  updates: (
    [
      {
        id: "nimbus-viewed",
        company: "Nimbus Cloud",
        kind: "viewed",
        action: "viewed your application",
        detail: "Frontend Engineer",
      },
      {
        id: "dataforge-interview",
        company: "DataForge",
        kind: "interview",
        action: "moved you to Interview",
        detail: "System design round · Oct 8",
      },
      {
        id: "tempo-message",
        company: "Tempo",
        kind: "message",
        action: "sent you a message",
        detail: "“Are you free Thursday to pair?”",
      },
      {
        id: "acme-screen",
        company: "Acme Health",
        kind: "screen",
        action: "booked a recruiter screen",
        detail: "Oct 3, 2:30 PM EST",
      },
      {
        id: "fintech-offer",
        company: "FinTech Corp",
        kind: "offer",
        action: "sent you an offer",
        detail: "UI Developer · reply by Oct 20",
      },
    ] satisfies Omit<RecruiterUpdate, "logo" | "logoTone">[]
  ).map((update): RecruiterUpdate => ({ ...update, ...companyLogo(update.company) })),
};
