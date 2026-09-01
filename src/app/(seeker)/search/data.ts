import type { ComponentType } from "react";

import { AwardIcon, BriefcaseIcon, CoinIcon, MonitorIcon } from "@/components/icons";

import { GlobeIcon, WaveIcon } from "./icons";

/**
 * The fixtures the KAN-43 search mockup renders against.
 *
 * The mockup's count reads "24 Jobs" over the two results it draws. The count
 * on screen is JOBS.length so it cannot disagree with what is beneath it, which
 * means it reads 2 until the other twenty-two exist — the same call the
 * applications board made about its "Applied" column. The selected result is a
 * flag on the fixture rather than routing state.
 *
 * `Icon` stands in for an employer's logo, as it does on the applications
 * board: the mockup draws real marks and the repo has no image for them.
 */
export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  posted: string;
  match: number;
  Icon: ComponentType<{ className?: string }>;
  /** Tints the employer tile. The mockup gives each employer its own. */
  tone: "brand" | "deep";
  isNew?: boolean;
  saved?: boolean;
  /** The spark the mockup puts beside the strongest match. */
  hot?: boolean;
  /** The result the mockup draws as selected, and so the one detailed here. */
  selected?: boolean;
};

export const JOBS: Job[] = [
  {
    id: "senior-frontend-engineer",
    title: "Senior Frontend Engineer",
    company: "GlobalTech Solutions",
    location: "Remote (US)",
    salary: "$140k - $180k",
    posted: "Posted 2h ago",
    match: 92,
    Icon: GlobeIcon,
    tone: "brand",
    isNew: true,
    saved: true,
    hot: true,
    selected: true,
  },
  {
    id: "lead-react-developer",
    title: "Lead React Developer",
    company: "FinStream Inc.",
    location: "New York, NY (Hybrid)",
    salary: "$150k - $190k",
    posted: "Posted 1d ago",
    match: 88,
    Icon: WaveIcon,
    tone: "deep",
  },
];

/** `active` is the one filter the mockup shows applied, so it is removable. */
export const FILTERS = [
  { label: "Full-time" },
  { label: "Remote", active: true },
  { label: "Salary Range" },
];

export const DETAIL = {
  status: "Actively Hiring",
  stats: [
    { label: "Salary", value: "$140k - $180k", Icon: CoinIcon },
    { label: "Job Type", value: "Full-time", Icon: BriefcaseIcon },
    { label: "Setting", value: "Remote", Icon: MonitorIcon },
    { label: "Experience", value: "5+ Years", Icon: AwardIcon },
  ],
  about:
    "We are seeking a highly skilled Senior Frontend Engineer to join our core product team. You will be responsible for architecting and building complex, high-performance web applications using modern React and TypeScript. You will work closely with product managers, designers, and backend engineers to deliver exceptional user experiences.",
  responsibilities: [
    "Lead the development of new features in our flagship web application.",
    "Architect scalable and maintainable frontend solutions.",
    "Mentor junior engineers and conduct code reviews.",
    "Collaborate with design to implement responsive, pixel-perfect UIs.",
    "Optimize application performance for maximum speed and scalability.",
  ],
  qualifications: [
    "5+ years of professional experience in frontend development.",
    "Deep expertise in React, hooks, and state management (Redux, Zustand, etc.).",
    "Strong proficiency in TypeScript and modern JavaScript (ES6+).",
    "Experience with responsive design and CSS frameworks (Tailwind CSS preferred).",
    "Excellent problem-solving and communication skills.",
  ],
};
