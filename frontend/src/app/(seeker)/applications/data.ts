import type { ComponentType } from "react";

import {
  AwardIcon,
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  MonitorIcon,
  PinIcon,
} from "@/components/icons";

import { BuildingIcon, ClockIcon, CloudIcon, CubeIcon, NodesIcon, StorefrontIcon } from "./icons";

export type Tone = "brand" | "positive";

export type Application = {
  role: string;
  company: string;
  /** Stand-in for the company logo — see the note in icons.tsx. */
  Icon: ComponentType<{ className?: string }>;
  /** Tints the company tile. Only an offer leaves brand. */
  tone?: Tone;
  /** Where the application stands, shown as a chip beside the role. */
  status?: string;
  saved?: boolean;
  /** Facts about the job rather than the application. */
  tags?: string[];
  /** The scheduled thing this card is waiting on. */
  next?: { label: string; when: string };
  meta: { text: string; Icon?: ComponentType<{ className?: string }> };
  /** A link in the footer — the one action a saved row offers. */
  action?: { label: string; href: string };
  /** A filled button, for the one card whose action cannot wait. */
  cta?: string;
  /** Whose interview it is; the mockup shows a face here. */
  owner?: string;
  /**
   * Exists because the shadcn kanban design has a slot for it and WorkIt had no
   * field to fill it: a card there carries a two-line description. An invented
   * fixture value, not measured from any mockup — what you would write to
   * remind yourself what the role is. Replace it the moment real data exists; a
   * card renders fine without it.
   */
  summary?: string;
  /**
   * 0-100. How well the job fits the seeker — the same score the Jobs screen
   * shows, read in the bands in @/lib/match. Per application, unlike a stage's
   * `progress`, so two cards in one column can disagree. Invented here.
   */
  match: number;
  /** Draws the card selected. The mockup draws the Lead Designer card this way,
   *  but the fixture leaves every card unset so the board shows cards at rest. */
  active?: boolean;
};

export type Column = {
  title: string;
  /** Painted along the card's top edge, so a card carries its column with it. */
  accent: "pale" | "brand" | "positive";
  /**
   * How far through the pipeline this stage is. The grid and list draw a bar
   * where the board draws a column, and this is what fills it — progress is a
   * property of the stage, not of the application, so a card can never show a
   * percentage that disagrees with the column it sits in.
   */
  progress: number;
  items: Application[];
};

/**
 * The fixture the KAN-43 mockup shows, filled out to three cards a column.
 *
 * Every card carries the same set of fields — a summary long enough to fill its
 * two clamped lines, a next step, a match score, and no `cta` — so every card
 * on the board draws at the height of the mockup's Interviewing card. Cards of
 * mixed heights made it hard to judge how the board scrolls, which is what the
 * extra cards are for. Keep new cards to the same shape: a role or a next-step
 * label long enough to wrap, or a `cta`, makes that one card taller.
 *
 * The mockup draws the first two cards in Saved and Applied and the first in
 * Interviewing and Offer. The rest are invented, and so is every `next` except
 * the Lead Designer card's, and every `match`.
 *
 * Two places where the mockup could not simply be copied:
 *
 * Its "Applied" column is headed 3 but draws two cards. The count on screen is
 * `items.length`, so it cannot disagree with what is drawn. The third card here
 * is invented, so the column now reads 3 like the mockup.
 *
 * The Offer column is clipped by the right edge of the export, so only "UI
 * Dev…", "FinTech C…" and "Deadline to accep…" are legible. The full strings
 * below are inferred. The mockup's green button is left off that card to keep
 * its height matched; the board still draws a `cta` for any card that has one.
 */
export const COLUMNS: Column[] = [
  {
    title: "Saved",
    accent: "pale",
    progress: 25,
    items: [
      {
        role: "Product Designer",
        company: "TechNova Inc.",
        match: 92,
        summary:
          "End-to-end product design for their B2B analytics suite, working alongside two PMs.",
        Icon: BuildingIcon,
        saved: true,
        tags: ["Remote", "$120k - $150k"],
        next: { label: "Next: Application Closes", when: "Oct 20, 11:59 PM EST" },
        meta: { text: "Saved 2 days ago" },
        action: { label: "Apply", href: "/apply" },
      },
      {
        role: "Frontend Engineer",
        company: "Quantum Solutions",
        match: 84,
        summary:
          "React and TypeScript on the design-systems team rebuilding their component library.",
        Icon: CubeIcon,
        saved: true,
        next: { label: "Next: Coffee Chat", when: "Thursday, 10:00 AM EST" },
        meta: { text: "Saved 1 week ago" },
      },
      {
        role: "Interaction Designer",
        company: "Brightline Labs",
        match: 61,
        summary:
          "Interaction design for a clinical scheduling tool used across three hospital networks.",
        Icon: MonitorIcon,
        saved: true,
        next: { label: "Next: Virtual Info Session", when: "Oct 18, 1:00 PM EST" },
        meta: { text: "Saved 3 days ago" },
      },
    ],
  },
  {
    title: "Applied",
    accent: "brand",
    progress: 50,
    items: [
      {
        role: "UX Researcher",
        company: "Nexus Dynamics",
        match: 78,
        summary:
          "Mixed-methods research on a fintech onboarding flow. Applied through their careers page.",
        Icon: NodesIcon,
        status: "Applied",
        next: { label: "Next: Hear Back By", when: "Oct 26, per the recruiter" },
        meta: { text: "Oct 12, 2023", Icon: CalendarIcon },
      },
      {
        role: "Senior UI Designer",
        company: "RetailHub",
        match: 88,
        summary: "Design-system and UI work across the storefront and the merchant dashboard.",
        Icon: StorefrontIcon,
        status: "Applied",
        next: { label: "Next: Recruiter Screen", when: "Oct 17, 11:30 AM EST" },
        meta: { text: "Oct 10, 2023", Icon: CalendarIcon },
      },
      {
        role: "Product Engineer",
        company: "Orbit Analytics",
        match: 70,
        summary:
          "Full-stack work on self-serve dashboards. Referred by a former teammate on the data team.",
        Icon: BriefcaseIcon,
        status: "Applied",
        next: { label: "Next: Follow Up", when: "Oct 15, if no reply" },
        meta: { text: "Oct 8, 2023", Icon: CalendarIcon },
      },
    ],
  },
  {
    title: "Interviewing",
    accent: "brand",
    progress: 75,
    items: [
      {
        role: "Lead Designer",
        company: "CloudSync",
        match: 95,
        summary:
          "Leading design for the platform team. The technical interview is the third of four rounds.",
        Icon: CloudIcon,
        status: "Round 2",
        next: { label: "Next: Technical Interview", when: "Tomorrow, 2:00 PM EST" },
        meta: { text: "14 days active", Icon: ClockIcon },
        owner: "Alex Chen",
      },
      {
        role: "Design Systems Lead",
        company: "Vertex Mobility",
        match: 86,
        summary:
          "Owning the component library across the rider and driver apps. Round one was a portfolio review.",
        Icon: PinIcon,
        status: "Round 1",
        next: { label: "Next: Hiring Manager Call", when: "Oct 16, 3:30 PM EST" },
        meta: { text: "6 days active", Icon: ClockIcon },
      },
      {
        role: "Product Designer II",
        company: "Harbor Bank",
        match: 58,
        summary:
          "Onboarding and account flows for their consumer app. The last step is an onsite with the team.",
        Icon: BuildingIcon,
        status: "Final Round",
        next: { label: "Next: Onsite Interview", when: "Oct 19, 9:00 AM EST" },
        meta: { text: "21 days active", Icon: ClockIcon },
      },
    ],
  },
  {
    title: "Offer",
    accent: "positive",
    progress: 100,
    items: [
      {
        role: "UI Developer",
        company: "FinTech Corp",
        match: 90,
        summary: "Offer in hand for their payments dashboard team. Needs an answer by the 20th.",
        Icon: CoinIcon,
        tone: "positive",
        next: { label: "Next: Negotiation Call", when: "Oct 17, 4:00 PM EST" },
        meta: { text: "Deadline to accept: Oct 20, 2023" },
      },
      {
        role: "Frontend Developer",
        company: "Atlas Travel",
        match: 81,
        summary:
          "Offer from the booking experience team, with a signing bonus. Waiting on the benefits details.",
        Icon: BriefcaseIcon,
        tone: "positive",
        next: { label: "Next: Benefits Review", when: "Oct 18, 11:00 AM EST" },
        meta: { text: "Deadline to accept: Oct 27, 2023" },
      },
      {
        role: "UI/UX Designer",
        company: "Greenleaf Energy",
        match: 67,
        summary:
          "Verbal offer for the customer portal redesign. The written offer follows their reference checks.",
        Icon: AwardIcon,
        tone: "positive",
        next: { label: "Next: Reference Check", when: "Oct 18, 2:00 PM EST" },
        meta: { text: "Deadline to accept: Nov 3, 2023" },
      },
    ],
  },
];

/** A stage with its contents removed — what an ungrouped view needs to label a card. */
export type Stage = Omit<Column, "items">;

export type StagedApplication = Application & { stage: Stage };

/**
 * Every application in one flat list, each carrying the stage it sits in.
 *
 * The board is grouped by stage and the grid and list are not, so the three
 * views cannot read the same shape. This is derived from COLUMNS rather than
 * written out again: a card added to the board turns up in all three views, and
 * the stage a card claims stays the column it is actually in.
 */
export const APPLICATIONS: StagedApplication[] = COLUMNS.flatMap(({ items, ...stage }) =>
  items.map((item) => ({ ...item, stage })),
);
