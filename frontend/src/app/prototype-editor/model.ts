"use client";

// PROTOTYPE (KAN-195), throwaway. One fixture bank, one built resume, the
// actions every editor layout shares, and a line-count stand-in for the PDF's
// page count. The real page count comes back with each Tectonic render
// (KAN-190); here a short delay plays that render.

import { useEffect, useReducer, useState } from "react";

export const SECTIONS = [
  "Education",
  "Experience",
  "Projects",
  "Leadership & Activities",
  "Awards",
  "Certifications",
  "Skills",
] as const;
export type Section = (typeof SECTIONS)[number];

export type Variant = {
  id: string;
  text: string;
  posting?: string;
  originalChanged?: boolean;
  /** Wording typed straight into one built resume (variant E). */
  local?: boolean;
};
export type Bullet = { id: string; text: string; variants: Variant[] };
export type Entry = {
  id: string;
  section: Exclude<Section, "Skills">;
  title: string;
  org?: string;
  location?: string;
  dates?: string;
  gpa?: string;
  coursework?: string[];
  bullets: Bullet[];
};
export type SkillGroup = { group: string; items: string[] };

const b = (id: string, text: string, variants: Variant[] = []): Bullet => ({ id, text, variants });

const BANK: Entry[] = [
  {
    id: "sbu",
    section: "Education",
    title: "B.S. Computer Science",
    org: "Stony Brook University",
    location: "Stony Brook, NY",
    dates: "Expected May 2027",
    gpa: "3.7 / 4.0",
    coursework: [
      "Data Structures",
      "Algorithms",
      "Systems Fundamentals",
      "Databases",
      "Machine Learning",
    ],
    bullets: [],
  },
  {
    id: "acme",
    section: "Experience",
    title: "Software Engineering Intern",
    org: "Acme Health",
    location: "New York, NY",
    dates: "Jun 2026 – Aug 2026",
    bullets: [
      b(
        "acme1",
        "Built a patient-intake form service in TypeScript and Postgres that cut average check-in time from 9 to 4 minutes across 3 clinics",
        [
          {
            id: "acme1v",
            text: "Shipped a TypeScript and Postgres intake service used by 3 clinics, halving check-in time",
            posting: "Datadog · Software Engineering Intern",
            originalChanged: true,
          },
        ],
      ),
      b(
        "acme2",
        "Wrote 120 integration tests with Playwright and raised the team's end-to-end coverage from 40% to 75%",
      ),
      b(
        "acme3",
        "Paired with two senior engineers to move a nightly batch job to an event queue, removing a 2-hour reporting delay",
      ),
    ],
  },
  {
    id: "lab",
    section: "Experience",
    title: "Undergraduate Research Assistant",
    org: "SBU Computer Vision Lab",
    location: "Stony Brook, NY",
    dates: "Jan 2026 – Present",
    bullets: [
      b(
        "lab1",
        "Trained PyTorch segmentation models on 40,000 microscope images and improved mean IoU by 6 points over the lab baseline",
        [
          {
            id: "lab1v",
            text: "Improved segmentation accuracy (mean IoU +6) with PyTorch on 40,000 images",
            posting: "NVIDIA · Deep Learning Intern",
          },
        ],
      ),
      b(
        "lab2",
        "Wrote a data-cleaning pipeline in Python that flags mislabeled images for review, saving the lab about 5 hours a week",
      ),
      b(
        "lab3",
        "Presented results at the department's spring research showcase to an audience of 80",
      ),
    ],
  },
  {
    id: "doit",
    section: "Experience",
    title: "IT Help Desk Assistant",
    org: "SBU Division of IT",
    location: "Stony Brook, NY",
    dates: "Sep 2024 – May 2025",
    bullets: [
      b(
        "doit1",
        "Resolved about 25 student and staff tickets a week for accounts, Wi-Fi and printing",
      ),
      b("doit2", "Wrote 12 knowledge-base articles that cut repeat Wi-Fi tickets by a third"),
    ],
  },
  {
    id: "workit",
    section: "Projects",
    title: "WorkIt",
    org: "CSE 416 course project",
    dates: "Aug 2026 – Present",
    bullets: [
      b(
        "workit1",
        "Building a job platform for students with Next.js, FastAPI and Postgres in a team of six",
        [
          {
            id: "workit1v",
            text: "Building a Next.js, FastAPI and Postgres job platform for students in a six-person team",
            posting: "Stripe · Software Engineer Intern",
            originalChanged: true,
          },
        ],
      ),
      b(
        "workit2",
        "Designed the experience bank schema and the resume renderer that turns it into a LaTeX PDF",
      ),
      b(
        "workit3",
        "Set up CI on GitHub Actions with type checks, lint and a scheduled job-board scrape",
      ),
    ],
  },
  {
    id: "eats",
    section: "Projects",
    title: "Campus Eats Tracker",
    org: "HackSBU 2025",
    dates: "Mar 2025",
    bullets: [
      b(
        "eats1",
        "Built a React Native app that shows dining-hall wait times from crowd-sourced check-ins in 24 hours",
      ),
      b("eats2", "Won Best Use of AI for a wait-time forecast trained on a week of check-in data"),
    ],
  },
  {
    id: "site",
    section: "Projects",
    title: "Personal Website",
    dates: "2024",
    bullets: [b("site1", "Static portfolio site built with Astro and deployed on Vercel")],
  },
  {
    id: "wics",
    section: "Leadership & Activities",
    title: "Treasurer",
    org: "Women in Computer Science",
    location: "Stony Brook, NY",
    dates: "Sep 2025 – Present",
    bullets: [
      b(
        "wics1",
        "Managed a $6,000 annual budget and secured $2,500 in sponsorship for the spring hackathon",
      ),
      b("wics2", "Organized 8 technical workshops with an average attendance of 45"),
    ],
  },
  {
    id: "tutor",
    section: "Leadership & Activities",
    title: "Volunteer Math Tutor",
    org: "Brookhaven Public Library",
    dates: "2023 – 2025",
    bullets: [b("tutor1", "Tutored middle-school students in algebra every week for two years")],
  },
  {
    id: "award1",
    section: "Awards",
    title: "Best Use of AI",
    org: "HackSBU",
    dates: "Mar 2025",
    bullets: [],
  },
  {
    id: "aws",
    section: "Certifications",
    title: "AWS Certified Cloud Practitioner",
    org: "Amazon Web Services",
    dates: "2025",
    bullets: [],
  },
];

const SKILLS: SkillGroup[] = [
  { group: "Languages", items: ["Python", "TypeScript", "Java", "C", "SQL"] },
  { group: "Frameworks", items: ["React", "Next.js", "FastAPI", "PyTorch"] },
  { group: "Tools", items: ["Git", "Docker", "Postgres", "Linux", "Playwright"] },
];

// ---------------------------------------------------------------------------
// The built resume: a choice and order over the bank (ADR 0001).

export type Built = {
  /** Shown entries, per section, in this resume's order. Absent = not shown. */
  order: Record<Exclude<Section, "Skills">, string[]>;
  /** Per entry, its bullets in this resume's order. */
  bulletOrder: Record<string, string[]>;
  hidden: string[]; // bullet ids hidden on this resume
  pick: Record<string, string>; // bullet id -> variant id; absent = original
  showGpa: boolean;
  showCoursework: boolean;
};

export type State = { bank: Entry[]; skills: SkillGroup[]; built: Built };

function initial(): State {
  const shown = new Set([
    "sbu",
    "acme",
    "lab",
    "doit",
    "workit",
    "eats",
    "wics",
    "tutor",
    "award1",
  ]);
  const order = Object.fromEntries(
    SECTIONS.filter((s) => s !== "Skills").map((s) => [
      s,
      BANK.filter((e) => e.section === s && shown.has(e.id)).map((e) => e.id),
    ]),
  ) as Built["order"];
  return {
    bank: BANK,
    skills: SKILLS,
    built: {
      order,
      bulletOrder: Object.fromEntries(BANK.map((e) => [e.id, e.bullets.map((x) => x.id)])),
      hidden: [],
      pick: { acme1: "acme1v" },
      showGpa: true,
      showCoursework: true,
    },
  };
}

export type Action =
  | { type: "toggleEntry"; id: string }
  | { type: "moveEntry"; id: string; by: -1 | 1 }
  | { type: "toggleBullet"; id: string }
  | { type: "moveBullet"; entry: string; id: string; by: -1 | 1 }
  | { type: "pick"; bullet: string; variant: string | null }
  | { type: "keepVariant"; variant: string }
  | { type: "editVariant"; variant: string; text: string }
  | { type: "deleteVariant"; variant: string }
  | { type: "toggleGpa" }
  | { type: "toggleCoursework" }
  | { type: "hideMany"; ids: string[] }
  | { type: "editBullet"; bullet: string; text: string }
  | { type: "addVariant"; bullet: string; text: string; note?: string }
  | { type: "setWording"; bullet: string; text: string }
  | {
      type: "editEntry";
      id: string;
      patch: Partial<Pick<Entry, "title" | "org" | "location" | "dates" | "gpa" | "coursework">>;
    };

function move<T>(xs: T[], x: T, by: number) {
  const i = xs.indexOf(x);
  const j = i + by;
  if (i < 0 || j < 0 || j >= xs.length) return xs;
  const next = [...xs];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function mapVariants(bank: Entry[], f: (v: Variant) => Variant | null): Entry[] {
  return bank.map((e) => ({
    ...e,
    bullets: e.bullets.map((bl) => ({
      ...bl,
      variants: bl.variants.map(f).filter((v): v is Variant => v !== null),
    })),
  }));
}

function reduce(s: State, a: Action): State {
  const built = s.built;
  switch (a.type) {
    case "toggleEntry": {
      const e = s.bank.find((x) => x.id === a.id)!;
      const list = built.order[e.section];
      // A re-shown entry goes back at its date position in the bank.
      const next = list.includes(a.id)
        ? list.filter((x) => x !== a.id)
        : s.bank
            .filter((x) => x.section === e.section && (list.includes(x.id) || x.id === a.id))
            .map((x) => x.id);
      return { ...s, built: { ...built, order: { ...built.order, [e.section]: next } } };
    }
    case "moveEntry": {
      const e = s.bank.find((x) => x.id === a.id)!;
      return {
        ...s,
        built: {
          ...built,
          order: { ...built.order, [e.section]: move(built.order[e.section], a.id, a.by) },
        },
      };
    }
    case "toggleBullet":
      return {
        ...s,
        built: {
          ...built,
          hidden: built.hidden.includes(a.id)
            ? built.hidden.filter((x) => x !== a.id)
            : [...built.hidden, a.id],
        },
      };
    case "moveBullet": {
      // Swap with the next shown neighbour, so a hidden bullet between
      // never swallows the move.
      const all = built.bulletOrder[a.entry];
      const shown = all.filter((x) => x === a.id || !built.hidden.includes(x));
      const other = shown[shown.indexOf(a.id) + a.by];
      if (!other) return s;
      const next = all.map((x) => (x === a.id ? other : x === other ? a.id : x));
      return { ...s, built: { ...built, bulletOrder: { ...built.bulletOrder, [a.entry]: next } } };
    }
    case "pick": {
      const pick = { ...built.pick };
      if (a.variant) pick[a.bullet] = a.variant;
      else delete pick[a.bullet];
      return { ...s, built: { ...built, pick } };
    }
    case "keepVariant":
      return {
        ...s,
        bank: mapVariants(s.bank, (v) =>
          v.id === a.variant ? { ...v, originalChanged: false } : v,
        ),
      };
    case "editVariant":
      return {
        ...s,
        bank: mapVariants(s.bank, (v) =>
          v.id === a.variant ? { ...v, text: a.text, originalChanged: false } : v,
        ),
      };
    case "deleteVariant": {
      const pick = Object.fromEntries(
        Object.entries(built.pick).filter(([, v]) => v !== a.variant),
      );
      return {
        ...s,
        bank: mapVariants(s.bank, (v) => (v.id === a.variant ? null : v)),
        built: { ...built, pick },
      };
    }
    case "toggleGpa":
      return { ...s, built: { ...built, showGpa: !built.showGpa } };
    case "toggleCoursework":
      return { ...s, built: { ...built, showCoursework: !built.showCoursework } };
    case "editBullet":
      // Editing the original marks its variants "original changed" (KAN-185).
      return {
        ...s,
        bank: s.bank.map((e) => ({
          ...e,
          bullets: e.bullets.map((bl) =>
            bl.id === a.bullet
              ? {
                  ...bl,
                  text: a.text,
                  variants: bl.variants.map((v) => ({ ...v, originalChanged: true })),
                }
              : bl,
          ),
        })),
      };
    case "addVariant": {
      const id = `${a.bullet}-v${Date.now()}`;
      return {
        bank: s.bank.map((e) => ({
          ...e,
          bullets: e.bullets.map((bl) =>
            bl.id === a.bullet
              ? { ...bl, variants: [...bl.variants, { id, text: a.text, posting: a.note }] }
              : bl,
          ),
        })),
        skills: s.skills,
        built: { ...built, pick: { ...built.pick, [a.bullet]: id } },
      };
    }
    case "setWording": {
      // Typing on the page changes this resume's wording only: the bank's
      // original stays, and the resume keeps one wording of its own per bullet.
      const bl = s.bank.flatMap((e) => e.bullets).find((x) => x.id === a.bullet)!;
      const picked = bl.variants.find((v) => v.id === built.pick[a.bullet]);
      if (a.text === (picked ? picked.text : bl.text)) return s;
      if (a.text === bl.text) return reduce(s, { type: "pick", bullet: a.bullet, variant: null });
      if (picked?.local)
        return {
          ...s,
          bank: mapVariants(s.bank, (v) => (v.id === picked.id ? { ...v, text: a.text } : v)),
        };
      const id = `${a.bullet}-local${Date.now()}`;
      return {
        ...s,
        bank: s.bank.map((e) => ({
          ...e,
          bullets: e.bullets.map((x) =>
            x.id === a.bullet
              ? { ...x, variants: [...x.variants, { id, text: a.text, local: true }] }
              : x,
          ),
        })),
        built: { ...built, pick: { ...built.pick, [a.bullet]: id } },
      };
    }
    case "editEntry":
      // Title, organization, place and dates have one value, kept in the bank (KAN-185).
      return { ...s, bank: s.bank.map((e) => (e.id === a.id ? { ...e, ...a.patch } : e)) };
    case "hideMany":
      return { ...s, built: { ...built, hidden: [...new Set([...built.hidden, ...a.ids])] } };
  }
}

/** The editor's state plus one-step-at-a-time undo. */
export function useEditor() {
  const [{ now, past }, dispatch] = useReducer(
    (h: { now: State; past: State[] }, a: Action | { type: "undo" }) =>
      a.type === "undo"
        ? h.past.length
          ? { now: h.past[h.past.length - 1], past: h.past.slice(0, -1) }
          : h
        : { now: reduce(h.now, a), past: [...h.past, h.now].slice(-50) },
    undefined,
    () => ({ now: initial(), past: [] as State[] }),
  );
  return { state: now, dispatch, canUndo: past.length > 0 };
}
export type Editor = ReturnType<typeof useEditor>;

// ---------------------------------------------------------------------------
// Reading the built resume.

export const entryById = (s: State, id: string) => s.bank.find((e) => e.id === id)!;

export function bulletText(s: State, bl: Bullet) {
  const v = bl.variants.find((x) => x.id === s.built.pick[bl.id]);
  return v ? v.text : bl.text;
}

/** Bullets of an entry in this resume's order, hidden ones included. */
export function orderedBullets(s: State, e: Entry) {
  return s.built.bulletOrder[e.id].map((id) => e.bullets.find((x) => x.id === id)!).filter(Boolean);
}

export const visibleBullets = (s: State, e: Entry) =>
  orderedBullets(s, e).filter((x) => !s.built.hidden.includes(x.id));

/** Entries in the bank that this resume does not show. */
export const unusedEntries = (s: State) =>
  s.bank.filter((e) => !s.built.order[e.section].includes(e.id));

/** Variants still marked "original changed", with the bullet they belong to. */
export function changedVariants(s: State) {
  return s.bank.flatMap((e) =>
    e.bullets.flatMap((bl) =>
      bl.variants
        .filter((v) => v.originalChanged)
        .map((v) => ({ entry: e, bullet: bl, variant: v })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Page fit. Lines of Jake's Resume on Letter at 11pt; the stand-in for the
// page count Tectonic returns. The editor must never measure the PDF itself.

export const LINES_PER_PAGE = 53;
const CHARS_PER_LINE = 108;

export type Block =
  | { kind: "header"; lines: number }
  | { kind: "section"; section: Section; lines: number }
  | { kind: "entry"; entry: Entry; lines: number }
  | { kind: "bullet"; entry: Entry; bullet: Bullet; lines: number }
  | { kind: "skill"; group: SkillGroup; lines: number };

export function blocks(s: State): Block[] {
  const out: Block[] = [{ kind: "header", lines: 4 }];
  for (const section of SECTIONS) {
    if (section === "Skills") {
      out.push({ kind: "section", section, lines: 2 });
      s.skills.forEach((group) => out.push({ kind: "skill", group, lines: 1 }));
      continue;
    }
    const ids = s.built.order[section];
    if (!ids.length) continue;
    out.push({ kind: "section", section, lines: 2 });
    for (const id of ids) {
      const e = entryById(s, id);
      const extra =
        e.section === "Education" && s.built.showCoursework && e.coursework?.length ? 1 : 0;
      out.push({
        kind: "entry",
        entry: e,
        lines: (e.section === "Awards" || e.section === "Certifications" ? 1 : 2) + extra,
      });
      for (const bl of visibleBullets(s, e))
        out.push({
          kind: "bullet",
          entry: e,
          bullet: bl,
          lines: Math.ceil(bulletText(s, bl).length / CHARS_PER_LINE),
        });
    }
  }
  return out;
}

/** Blocks split into pages, the way the PDF would break them. */
export function paginate(s: State): Block[][] {
  const pages: Block[][] = [[]];
  let used = 0;
  for (const bl of blocks(s)) {
    if (used + bl.lines > LINES_PER_PAGE) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(bl);
    used += bl.lines;
  }
  return pages;
}

export function fit(s: State) {
  const total = blocks(s).reduce((n, x) => n + x.lines, 0);
  return {
    lines: total,
    pages: Math.ceil(total / LINES_PER_PAGE),
    over: Math.max(0, total - LINES_PER_PAGE),
  };
}

/**
 * "Fit to one page": hide the last bullet of the oldest entry with more than
 * one, repeatedly, until it fits. A base resume has no job posting to rank
 * against, so oldest-and-last is the stand-in for "least relevant".
 */
export function fitSuggestion(s: State): string[] {
  let t = s;
  const ids: string[] = [];
  for (let guard = 0; fit(t).over > 0 && guard < 30; guard++) {
    const candidates = (["Leadership & Activities", "Projects", "Experience"] as const).flatMap(
      (sec) => [...t.built.order[sec]].reverse().map((id) => entryById(t, id)),
    );
    const target = candidates.find((e) => visibleBullets(t, e).length > 1);
    if (!target) break;
    const vb = visibleBullets(t, target);
    const id = vb[vb.length - 1].id;
    ids.push(id);
    t = reduce(t, { type: "toggleBullet", id });
  }
  return ids;
}

/**
 * The preview lags edits by one render, as the real PDF will: every change
 * starts a render, and the page shows the last finished one.
 */
export function useRendered(s: State, ms = 700) {
  const [rendered, setRendered] = useState(s);
  useEffect(() => {
    if (rendered === s) return;
    const t = setTimeout(() => setRendered(s), ms);
    return () => clearTimeout(t);
  }, [s, rendered, ms]);
  return { rendered, rendering: rendered !== s };
}
