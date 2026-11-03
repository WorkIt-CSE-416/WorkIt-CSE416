/**
 * Sample jobs for the landing page: the stages of the applications section
 * (applications.tsx), and the jobs the bridge's and the tour's cards draw
 * on. Every
 * company is a real employer on scraper/boards.csv with an intern or
 * new-grad title, the only roles the scraper keeps, like the hero's cards;
 * the logo is the company's favicon. The dates and scores are made up.
 */
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  BookmarkSimpleIcon,
  ChatsIcon,
  HandshakeIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react/ssr";

export interface TrackedJob {
  title: string;
  company: string;
  /** The company's site, for its favicon. */
  domain: string;
  /** The match, in the score chip. */
  score: number;
  next: { label: string; when: string };
  footer: string;
}

export interface Stage {
  id: "saved" | "applied" | "interview" | "offer";
  /** Column name, as used in the product. */
  label: string;
  /** The stage's line on the home page's rail. */
  description: string;
  /** Label for a single card in this stage. */
  cardLabel: string;
  chipClass: string;
  /** Status icon shown in the stage chips and on the rail. */
  icon: PhosphorIcon;
  iconClass: string;
  /** The stage's colour: the glow behind the tracker card, and the Updates stop's track. */
  color: string;
  /** Text on a tint of `color`, at AA contrast. */
  ink: string;
  jobs: TrackedJob[];
  /** Not built yet: the rail says "Coming soon" (`SoonChip`). The tracker
   * stores no employer replies, so its Interviewing and Offer columns stay
   * empty. */
  soon?: boolean;
}

export const stages: Stage[] = [
  {
    id: "saved",
    label: "Saved",
    description: "Bookmark roles worth a closer look.",
    cardLabel: "Saved",
    chipClass: "bg-slate-100 text-slate-700",
    icon: BookmarkSimpleIcon,
    iconClass: "text-slate-600",
    color: "#64748b",
    ink: "#475569",
    jobs: [
      {
        title: "Product Design Intern",
        company: "Notion",
        domain: "notion.so",
        score: 88,
        next: { label: "Tailor portfolio", when: "Due Sep 24" },
        footer: "Posting closes: Oct 3",
      },
      {
        title: "Data Analyst Intern",
        company: "Airtable",
        domain: "airtable.com",
        score: 81,
        next: { label: "Request referral", when: "Sep 26" },
        footer: "Posting closes: Oct 10",
      },
      {
        title: "iOS Engineer Intern",
        company: "Lyft",
        domain: "lyft.com",
        score: 76,
        next: { label: "Update resume", when: "Sep 27" },
        footer: "Posting closes: Oct 14",
      },
      {
        title: "Software Engineer Intern",
        company: "Benchling",
        domain: "benchling.com",
        score: 84,
        next: { label: "Draft cover letter", when: "Sep 29" },
        footer: "Posting closes: Oct 18",
      },
    ],
  },
  {
    id: "applied",
    label: "Applied",
    // Which resume went out is kept (the sent resume); a follow-up day was
    // tried and dropped, so the line no longer promises one.
    description: "Know when you applied and which resume you sent.",
    cardLabel: "Applied",
    chipClass: "bg-landing-brand-100 text-landing-brand-800",
    icon: PaperPlaneTiltIcon,
    iconClass: "text-landing-brand-600",
    color: "var(--color-brand)",
    ink: "var(--color-brand-ink)",
    jobs: [
      {
        title: "Frontend Engineer Intern",
        company: "Cloudflare",
        domain: "cloudflare.com",
        score: 92,
        next: { label: "Follow up with recruiter", when: "Oct 1, 10:00 AM EST" },
        footer: "Applied: Sep 22",
      },
      {
        title: "Software Engineer, New Grad",
        company: "Plaid",
        domain: "plaid.com",
        score: 79,
        next: { label: "Recruiter Screen", when: "Oct 3, 2:30 PM EST" },
        footer: "Applied: Sep 19",
      },
      {
        title: "Product Manager Intern",
        company: "DoorDash",
        domain: "doordash.com",
        score: 74,
        next: { label: "Check application status", when: "Oct 6" },
        footer: "Applied: Sep 15",
      },
      {
        title: "Software Engineer in Test Intern",
        company: "Datadog",
        domain: "datadoghq.com",
        score: 86,
        next: { label: "Send work samples", when: "Oct 2" },
        footer: "Applied: Sep 24",
      },
    ],
  },
  {
    id: "interview",
    label: "Interview",
    description: "See every round and prep for the next one.",
    soon: true,
    cardLabel: "Interview",
    chipClass: "bg-amber-100 text-amber-800",
    icon: ChatsIcon,
    iconClass: "text-amber-700",
    color: "var(--color-warning-fill)",
    ink: "var(--color-warning)",
    jobs: [
      {
        title: "Full-Stack Engineer Intern",
        company: "Ramp",
        domain: "ramp.com",
        score: 89,
        next: { label: "System Design Interview", when: "Oct 8, 1:00 PM EST" },
        footer: "Interview round 3 of 4",
      },
      {
        title: "Product Designer Intern",
        company: "Robinhood",
        domain: "robinhood.com",
        score: 83,
        next: { label: "Portfolio Presentation", when: "Oct 9, 11:00 AM EST" },
        footer: "Interview round 2 of 3",
      },
      {
        title: "Backend Engineer Intern",
        company: "Coinbase",
        domain: "coinbase.com",
        score: 91,
        next: { label: "Pair Programming", when: "Oct 7, 3:30 PM EST" },
        footer: "Interview round 2 of 4",
      },
      {
        title: "Data Engineer Intern",
        company: "Snowflake",
        domain: "snowflake.com",
        score: 87,
        next: { label: "Final Interview", when: "Oct 10, 9:00 AM EST" },
        footer: "Interview round 4 of 4",
      },
    ],
  },
  {
    id: "offer",
    label: "Job Offers",
    description: "Compare offers before the deadline to accept.",
    soon: true,
    cardLabel: "Job Offer",
    chipClass: "bg-emerald-100 text-emerald-800",
    icon: HandshakeIcon,
    iconClass: "text-emerald-700",
    color: "var(--color-positive)",
    ink: "var(--color-positive-ink)",
    jobs: [
      {
        title: "Software Engineer, New Grad",
        company: "Vercel",
        domain: "vercel.com",
        score: 90,
        next: { label: "Negotiation Call", when: "Oct 17, 4:00 PM EST" },
        footer: "Deadline to accept: Oct 20",
      },
      {
        title: "Machine Learning Intern",
        company: "Waymo",
        domain: "waymo.com",
        score: 85,
        next: { label: "Benefits Review", when: "Oct 15, 12:00 PM EST" },
        footer: "Deadline to accept: Oct 22",
      },
      {
        title: "Frontend Engineer, New Grad",
        company: "Twitch",
        domain: "twitch.tv",
        score: 78,
        next: { label: "Review Written Offer", when: "Oct 14" },
        footer: "Deadline to accept: Oct 24",
      },
      {
        title: "Software Engineer Intern",
        company: "Samsara",
        domain: "samsara.com",
        score: 82,
        next: { label: "Call Hiring Manager", when: "Oct 16, 10:00 AM EST" },
        footer: "Deadline to accept: Oct 27",
      },
    ],
  },
];
