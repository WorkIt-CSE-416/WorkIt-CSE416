/**
 * Copy and sample data for the landing page's product tour
 * (product-tour.tsx): the feature list and the data each feature's
 * animation uses. The candidate, resumes and companies are fictional;
 * companies reuse the logos from the application board (./board-data.ts)
 * so the two sections match.
 */
import {
  Accessibility,
  Braces,
  Briefcase,
  Building2,
  ChartColumn,
  CircleDollarSign,
  Clock,
  Cloud,
  Code,
  Container,
  Database,
  FlaskConical,
  Globe,
  GraduationCap,
  HeartPulse,
  Layers,
  MessageCircle,
  PenTool,
  RefreshCw,
  Rocket,
  Search,
  Target,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { MagnifiedTag } from "./magnified-tags";
import { stages } from "./board-data";

/** Logo and tile colors for a company on the application board. */
function companyLogo(company: string): { logo: LucideIcon; logoTone: string } {
  const job = stages.flatMap((stage) => stage.jobs).find((item) => item.company === company);
  if (!job) throw new Error(`No application-board job for company "${company}"`);
  return { logo: job.logo, logoTone: job.logoTone };
}

export type FeatureId = "matching" | "resumes" | "autofill" | "updates";

/** The carousel's features, in order. `seconds` is how long each shows before auto-advancing. */
export const features: { id: FeatureId; title: string; description: string; seconds: number }[] = [
  {
    id: "matching",
    title: "Matched on your skills",
    description:
      "WorkIt reads the skills and experience in your profile and looks for them in every role, so the jobs you’re qualified for rise to the top.",
    seconds: 7,
  },
  {
    id: "resumes",
    title: "Resumes that pass the ATS",
    description:
      "Keep a resume for every kind of role. WorkIt reads each one the way applicant tracking systems do, scores it, and suggests exact fixes you can apply in a click.",
    seconds: 10,
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

// --- Skill matching ---

// Example profile skills, experience, and preferences, one scrolling row each.
export const skillTags = [
  [
    { id: "react", icon: Code, label: "React" },
    { id: "product-design", icon: PenTool, label: "Product Design" },
    { id: "sql", icon: Database, label: "SQL" },
    { id: "ux-research", icon: Search, label: "UX Research" },
    { id: "python", icon: Terminal, label: "Python" },
  ],
  [
    { id: "experience", icon: Briefcase, label: "5+ yrs experience" },
    { id: "leadership", icon: Users, label: "Team Leadership" },
    { id: "remote", icon: Globe, label: "Remote" },
    { id: "communication", icon: MessageCircle, label: "Stakeholder Communication" },
    { id: "agile", icon: RefreshCw, label: "Agile" },
  ],
  [
    { id: "typescript", icon: Braces, label: "TypeScript" },
    { id: "aws", icon: Cloud, label: "AWS" },
    { id: "data-analysis", icon: ChartColumn, label: "Data Analysis" },
    { id: "design-systems", icon: Layers, label: "Design Systems" },
    { id: "accessibility", icon: Accessibility, label: "Accessibility" },
  ],
  [
    { id: "strategy", icon: Target, label: "Product Strategy" },
    { id: "kubernetes", icon: Container, label: "Kubernetes" },
    { id: "ab-testing", icon: FlaskConical, label: "A/B Testing" },
    { id: "mentoring", icon: GraduationCap, label: "Mentoring" },
    { id: "figma", icon: PenTool, label: "Figma" },
  ],
  [
    { id: "hybrid", icon: Building2, label: "Hybrid" },
    { id: "salary", icon: CircleDollarSign, label: "$140k+ salary" },
    { id: "full-time", icon: Clock, label: "Full-time" },
    { id: "startups", icon: Rocket, label: "Series B startups" },
    { id: "healthcare", icon: HeartPulse, label: "Healthcare" },
  ],
] satisfies MagnifiedTag[][];

export const candidate = { name: "Alex Morgan" };

// --- Resumes + ATS feedback ---

export interface ResumeSuggestion {
  id: string;
  kind: "keyword" | "impact" | "clarity";
  title: string;
  detail: string;
  /** Index of the bullet this suggestion rewrites. */
  bullet: number;
  /** The bullet after the suggestion is applied. */
  after: string;
  /** Score gained by applying it. */
  points: number;
}

export interface ResumeVersion {
  id: string;
  /** Label in the version switcher. */
  label: string;
  file: string;
  role: string;
  /** ATS score before any suggestions are applied. */
  score: number;
  bullets: string[];
  /** Phrases highlighted as ATS matches once the scan finishes. */
  keywords: string[];
  suggestions: ResumeSuggestion[];
}

export const resumeFeature = {
  versions: [
    {
      id: "design",
      label: "Design",
      file: "Design.pdf",
      role: "Product Designer",
      score: 74,
      bullets: [
        "Redesigned the checkout flow with the payments team.",
        "Improved onboarding for new users.",
        "Built and maintained the design system.",
      ],
      keywords: ["checkout flow", "design system", "onboarding", "Figma"],
      suggestions: [
        {
          id: "design-impact",
          kind: "impact",
          title: "Quantify your impact",
          detail: "Numbers catch a recruiter’s eye.",
          bullet: 1,
          after: "Cut onboarding drop-off 30% with a guided first-run flow.",
          points: 9,
        },
        {
          id: "design-figma",
          kind: "keyword",
          title: "Add “Figma”",
          detail: "It’s in 4 of your saved roles.",
          bullet: 2,
          after: "Built and maintained the Figma design system used by 6 teams.",
          points: 8,
        },
      ],
    },
    {
      id: "frontend",
      label: "Frontend",
      file: "Frontend.pdf",
      role: "Frontend Engineer",
      score: 68,
      bullets: [
        "Worked on the React dashboard customers use.",
        "Helped make pages load faster.",
        "Set up end-to-end tests with Playwright.",
      ],
      keywords: ["React", "TypeScript", "Playwright", "code splitting"],
      suggestions: [
        {
          id: "frontend-typescript",
          kind: "keyword",
          title: "Add “TypeScript”",
          detail: "It’s in 5 of your saved roles.",
          bullet: 0,
          after: "Shipped the React and TypeScript dashboard used by 40k customers.",
          points: 10,
        },
        {
          id: "frontend-impact",
          kind: "impact",
          title: "Show the result",
          detail: "Say how much faster, not just faster.",
          bullet: 1,
          after: "Cut page load time from 3.2s to 1.1s with code splitting.",
          points: 12,
        },
      ],
    },
    {
      id: "data",
      label: "Data",
      file: "Data.pdf",
      role: "Data Analyst",
      score: 71,
      bullets: [
        "Built dashboards for the sales team.",
        "Analyzed customer churn with SQL and Python.",
        "Responsible for weekly reporting.",
      ],
      keywords: ["SQL", "Python", "Tableau", "churn"],
      suggestions: [
        {
          id: "data-tableau",
          kind: "keyword",
          title: "Add “Tableau”",
          detail: "It’s in 3 of your saved roles.",
          bullet: 0,
          after: "Built Tableau dashboards the sales team checks daily.",
          points: 9,
        },
        {
          id: "data-verb",
          kind: "clarity",
          title: "Lead with an action verb",
          detail: "“Responsible for” sounds passive.",
          bullet: 2,
          after: "Automated weekly reporting, saving the team 6 hours a week.",
          points: 8,
        },
      ],
    },
  ] satisfies ResumeVersion[],
};

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
