"use client";

/**
 * PROTOTYPE (KAN-193), throwaway. A scripted stand-in for intake so three
 * layouts can be judged with the same conversation. No model, no API, no
 * persistence: every turn's reply and draft come from SCRIPTS below, and the
 * bank lives in memory. `?bank=empty` walks the sections; `?bank=some` starts
 * with a filled bank so the duplicate warning can fire.
 */

import { useState } from "react";

export const SECTIONS = [
  "Education",
  "Projects",
  "Leadership & Activities",
  "Experience",
  "Awards",
  "Certifications",
] as const;
export type Section = (typeof SECTIONS)[number];

export type Draft = {
  section: Section;
  title: string;
  organization: string;
  location: string;
  start: string;
  end: string;
  details: { label: string; value: string }[];
  bullets: string[];
  skills: string[];
  ready: boolean;
};

export type Entry = Pick<Draft, "section" | "title" | "organization" | "start" | "end">;

export type Message =
  | { kind: "text"; from: "workit" | "student"; text: string; opensDraft?: Section }
  | { kind: "saved"; entry: Entry }
  | { kind: "skipped"; section: Section };

type Turn = { student: string; reply: string; patch: Partial<Draft> };
type Script = { opening: string; turns: Turn[] };

const SCRIPTS: Record<Section, Script> = {
  Education: {
    opening: "Let's start with school. Where do you study, and what is your degree?",
    turns: [
      {
        student: "Stony Brook, BS in Computer Science, graduating May 2027",
        reply: "Got it. Do you want your GPA on it? You can skip.",
        patch: {
          title: "B.S. Computer Science",
          organization: "Stony Brook University",
          location: "Stony Brook, NY",
          end: "May 2027",
        },
      },
      {
        student: "3.7",
        reply: "Any coursework you want listed?",
        patch: { details: [{ label: "GPA", value: "3.7" }] },
      },
      {
        student: "Data structures, algorithms, databases, software engineering",
        reply: "This one is ready to save. Check the card, then save it.",
        patch: {
          details: [
            { label: "GPA", value: "3.7" },
            {
              label: "Coursework",
              value: "Data Structures, Algorithms, Databases, Software Engineering",
            },
          ],
          ready: true,
        },
      },
    ],
  },
  Projects: {
    opening:
      "Next, projects. Tell me about one thing you built: for a class, a hackathon or on your own.",
    turns: [
      {
        student:
          "For CSE 416 I'm building WorkIt with 4 others, a job site for students. I did the resume upload and the parser in Python.",
        reply: "When did you work on it?",
        patch: {
          title: "WorkIt",
          organization: "CSE 416, Stony Brook University",
          bullets: [
            "Built the resume upload and parser in Python for WorkIt, a job platform for students",
            "Worked in a team of 5",
          ],
          skills: ["Python"],
        },
      },
      {
        student: "Since August 2026",
        reply: "About how many resumes has the parser read so far? Skip if you don't know.",
        patch: { start: "Aug 2026", end: "Present" },
      },
      {
        student: "skip",
        reply: "No number, then. The bullet stays as it is. This one is ready to save.",
        patch: { ready: true },
      },
    ],
  },
  "Leadership & Activities": {
    opening: "Any clubs, teams or roles where you led or organized something?",
    turns: [
      {
        student: "I'm treasurer of the Robotics club since last fall, I handle the budget",
        reply: "About how big is the budget, or how many members does the club have?",
        patch: {
          title: "Treasurer",
          organization: "Robotics Club",
          start: "Sep 2025",
          end: "Present",
          bullets: ["Manage the club budget as treasurer"],
        },
      },
      {
        student: "About $4,000 a year, 30 members",
        reply: "Thanks. This one is ready to save.",
        patch: {
          bullets: ["Manage a $4,000 yearly budget for a 30-member club"],
          ready: true,
        },
      },
    ],
  },
  Experience: {
    opening: "Any jobs or internships, paid or not? Campus jobs count.",
    turns: [
      {
        student: "I was a TA for CSE 214 last spring, I graded and ran office hours",
        reply: "About how many students were in the course?",
        patch: {
          title: "Teaching Assistant",
          organization: "Stony Brook University",
          start: "Jan 2026",
          end: "May 2026",
          bullets: ["Graded assignments and held office hours for CSE 214"],
        },
      },
      {
        student: "around 200",
        reply: "This one is ready to save.",
        patch: {
          bullets: ["Graded assignments and held office hours for about 200 students in CSE 214"],
          ready: true,
        },
      },
    ],
  },
  Awards: {
    opening: "Any awards, scholarships or honors?",
    turns: [
      {
        student: "Dean's list, fall 2025",
        reply: "This one is ready to save.",
        patch: {
          title: "Dean's List",
          organization: "Stony Brook University",
          end: "Dec 2025",
          ready: true,
        },
      },
    ],
  },
  Certifications: {
    opening: "Any certifications?",
    turns: [
      {
        student: "AWS Cloud Practitioner, 2026",
        reply: "This one is ready to save.",
        patch: {
          title: "AWS Certified Cloud Practitioner",
          organization: "Amazon Web Services",
          end: "Mar 2026",
          ready: true,
        },
      },
    ],
  },
};

export const MAX_FOLLOW_UPS = 3;

const SOME_BANK: Entry[] = [
  {
    section: "Education",
    title: "B.S. Computer Science",
    organization: "Stony Brook University",
    start: "",
    end: "May 2027",
  },
  {
    section: "Projects",
    title: "WorkIt",
    organization: "CSE 416, Stony Brook University",
    start: "Aug 2026",
    end: "Present",
  },
  {
    section: "Experience",
    title: "Teaching Assistant",
    organization: "Stony Brook University",
    start: "Jan 2026",
    end: "May 2026",
  },
];

function emptyDraft(section: Section): Draft {
  return {
    section,
    title: "",
    organization: "",
    location: "",
    start: "",
    end: "",
    details: [],
    bullets: [],
    skills: [],
    ready: false,
  };
}

export type SectionState = "done" | "skipped" | "current" | "todo";

export function useIntake(bank: "empty" | "some") {
  const walk = bank === "empty";
  const [entries, setEntries] = useState<Entry[]>(walk ? [] : SOME_BANK);
  const [typing, setTyping] = useState(false);
  const [section, setSection] = useState<Section | null>(walk ? "Education" : null);
  const [draft, setDraft] = useState<Draft | null>(walk ? emptyDraft("Education") : null);
  const [turn, setTurn] = useState(0);
  const [skipped, setSkipped] = useState<Section[]>([]);
  const [duplicate, setDuplicate] = useState<Entry | null>(null);
  const [messages, setMessages] = useState<Message[]>(
    walk
      ? [
          {
            kind: "text",
            from: "workit",
            text: "Hi! I'll help you fill your experience bank, one thing at a time. You can skip any section.",
          },
          {
            kind: "text",
            from: "workit",
            text: SCRIPTS.Education.opening,
            opensDraft: "Education",
          },
        ]
      : [
          {
            kind: "text",
            from: "workit",
            text: "What do you want to add? Pick a section, or just tell me about something you did.",
          },
        ],
  );

  const script = section ? SCRIPTS[section] : null;
  const nextAnswer = script?.turns[turn]?.student ?? "";
  const followUps = Math.max(0, Math.min(turn - 1, MAX_FOLLOW_UPS));

  function say(...more: Message[]) {
    setMessages((m) => [...m, ...more]);
  }

  function start(next: Section) {
    setSection(next);
    setDraft(emptyDraft(next));
    setTurn(0);
    setDuplicate(null);
    say({ kind: "text", from: "workit", text: SCRIPTS[next].opening, opensDraft: next });
  }

  function advance() {
    if (!walk) {
      setSection(null);
      setDraft(null);
      setDuplicate(null);
      say({ kind: "text", from: "workit", text: "Anything else? Pick a section or tell me." });
      return;
    }
    const i = section ? SECTIONS.indexOf(section) : -1;
    const next = SECTIONS[i + 1];
    if (next) start(next);
    else {
      setSection(null);
      setDraft(null);
      say({
        kind: "text",
        from: "workit",
        text: "That's every section. Your bank is ready to build a resume from.",
      });
    }
  }

  function send(text: string) {
    if (!script || !draft || typing) return;
    const t = script.turns[turn];
    say({ kind: "text", from: "student", text: text || t?.student || "" });
    // A short "typing" pause so the stub reads like a reply, not a form.
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      if (!t) {
        say({ kind: "text", from: "workit", text: "Noted. Check the card, then save it." });
        return;
      }
      setDraft((d) => (d ? { ...d, ...t.patch } : d));
      setTurn((n) => n + 1);
      say({ kind: "text", from: "workit", text: t.reply });
    }, 900);
  }

  function commit() {
    if (!draft) return;
    const entry: Entry = {
      section: draft.section,
      title: draft.title || "Untitled",
      organization: draft.organization,
      start: draft.start,
      end: draft.end,
    };
    setEntries((e) => [...e, entry]);
    say({ kind: "saved", entry });
    advance();
  }

  function save() {
    if (!draft) return;
    const match = entries.find(
      (e) =>
        e.section === draft.section &&
        e.title.trim().toLowerCase() === draft.title.trim().toLowerCase() &&
        e.organization.trim().toLowerCase() === draft.organization.trim().toLowerCase(),
    );
    if (match) setDuplicate(match);
    else commit();
  }

  function skip() {
    if (!section) return;
    setSkipped((s) => [...s, section]);
    say({ kind: "skipped", section });
    advance();
  }

  function sectionState(s: Section): SectionState {
    if (s === section) return "current";
    if (skipped.includes(s)) return "skipped";
    if (entries.some((e) => e.section === s)) return "done";
    return "todo";
  }

  return {
    walk,
    entries,
    section,
    draft,
    setDraft,
    messages,
    nextAnswer,
    followUps,
    duplicate,
    send,
    save,
    skip,
    start,
    saveAsNew: commit,
    cancelDuplicate: () => setDuplicate(null),
    sectionState,
    typing,
  };
}

export type Intake = ReturnType<typeof useIntake>;

export function entryLabel(e: Entry) {
  return [e.title, e.organization].filter(Boolean).join(", ");
}

export function entryDates(e: Pick<Entry, "start" | "end">) {
  return [e.start, e.end].filter(Boolean).join(" – ");
}
