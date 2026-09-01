import type { ComponentType } from "react";

import { CalendarIcon, CoinIcon } from "@/components/icons";

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
   * The next three exist because the shadcn kanban design has slots for them
   * and WorkIt had no field to fill them: a card there carries a two-line
   * description and a pair of counts. They are invented fixture values, not
   * measured from any mockup — `summary` is what you would write to remind
   * yourself what the role is, `documents` counts what you sent them, and
   * `notes` counts what you have written down since. Replace them the moment
   * real data exists; a card renders fine without any of them.
   */
  summary?: string;
  documents?: number;
  notes?: number;
  /** The card the mockup draws as focused. */
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
 * The fixture the KAN-43 mockup shows.
 *
 * Two places where the mockup could not simply be copied:
 *
 * Its "Applied" column is headed 3 but draws two cards. The count on screen is
 * `items.length`, so it cannot disagree with what is drawn; that means this
 * column reads 2. If there is a third applied job, it belongs in this fixture.
 *
 * The Offer column is clipped by the right edge of the export, so only "UI
 * Dev…", "FinTech C…" and "Deadline to accep…" are legible and the green
 * button's label is not visible at all. The full strings below are inferred.
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
        summary:
          "End-to-end product design for their B2B analytics suite, working alongside two PMs.",
        documents: 2,
        notes: 1,
        Icon: BuildingIcon,
        saved: true,
        tags: ["Remote", "$120k - $150k"],
        meta: { text: "Saved 2 days ago" },
        action: { label: "Apply", href: "/apply" },
      },
      {
        role: "Frontend Engineer",
        company: "Quantum Solutions",
        summary:
          "React and TypeScript on the design-systems team rebuilding their component library.",
        documents: 1,
        notes: 0,
        Icon: CubeIcon,
        saved: true,
        meta: { text: "Saved 1 week ago" },
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
        summary:
          "Mixed-methods research on a fintech onboarding flow. Applied through their careers page.",
        documents: 3,
        notes: 2,
        Icon: NodesIcon,
        status: "Applied",
        meta: { text: "Oct 12, 2023", Icon: CalendarIcon },
      },
      {
        role: "Senior UI Designer",
        company: "RetailHub",
        summary: "Design-system and UI work across the storefront and the merchant dashboard.",
        documents: 2,
        notes: 1,
        Icon: StorefrontIcon,
        status: "Applied",
        meta: { text: "Oct 10, 2023", Icon: CalendarIcon },
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
        summary:
          "Leading design for the platform team. The technical interview is the third of four rounds.",
        documents: 3,
        notes: 4,
        Icon: CloudIcon,
        status: "Round 2",
        active: true,
        next: { label: "Next: Technical Interview", when: "Tomorrow, 2:00 PM EST" },
        meta: { text: "14 days active", Icon: ClockIcon },
        owner: "Alex Chen",
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
        summary: "Offer in hand for their payments dashboard team. Needs an answer by the 20th.",
        documents: 4,
        notes: 3,
        Icon: CoinIcon,
        tone: "positive",
        meta: { text: "Deadline to accept: Oct 20, 2023" },
        cta: "Review Offer",
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
