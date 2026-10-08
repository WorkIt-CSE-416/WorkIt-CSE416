import { cache } from "react";

import { CoinIcon, MonitorIcon, PinIcon } from "@/components/icons";

import type { Application } from "../tracker";
import {
  BuildingIcon,
  CloudIcon,
  CubeIcon,
  LandmarkIcon,
  LeafIcon,
  NodesIcon,
  OrbitIcon,
  PlaneIcon,
  StorefrontIcon,
} from "./icons";

/**
 * The application tracker's fixture: twelve applications, three to a stage,
 * read by the Applications board, grid and list and by the Dashboard's Next
 * Up and Up Next. When the tracker has a backend this file becomes the fetch,
 * and ../tracker.ts is the shape it returns.
 *
 * THE DATES ARE RELATIVE TO TODAY, built per request by `getApplications`, so
 * the sample search is always mid-flight: an interview tomorrow, an offer to
 * answer next week. Fixed dates went stale within a fortnight, and a fixture
 * whose every deadline has passed shows an empty Up Next.
 *
 * They are written on a New York clock, where the team is: `at(now, 1,
 * "14:00")` is 2 PM in New York tomorrow, which a browser elsewhere shows in
 * its own time. Bare dates (`day(now, 5)`) are due on a day and read the same
 * everywhere.
 *
 * KAN-43's mockup drew the first two cards in Saved and Applied and the first
 * in Interviewing and Offer; the rest, every event and every match are
 * invented. Every card carries a summary long enough to fill its two clamped
 * lines, so the board's cards stand at one height; keep new ones to that
 * shape.
 */

const ZONE = "America/New_York";
const YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, timeZoneName: "longOffset" });

/** The New York date `days` from today, as "YYYY-MM-DD". */
function day(now: Date, days: number) {
  const [year, month, date] = YMD.format(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** The instant `days` from today at `time` ("14:00") on a New York clock,
 *  moved to the Monday after when it lands on a weekend: nobody books an
 *  interview for a Saturday. The offset is read at noon that day, so it
 *  follows daylight saving. */
function at(now: Date, days: number, time: string) {
  const weekday = new Date(`${day(now, days)}T12:00:00Z`).getUTCDay();
  const date = day(now, days + (weekday === 6 ? 2 : weekday === 0 ? 1 : 0));
  const zone =
    OFFSET.formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")
      ?.value ?? "GMT";
  const offset = zone === "GMT" ? "Z" : zone.slice(3); // "GMT-04:00" -> "-04:00"
  return new Date(`${date}T${time}:00${offset}`).toISOString();
}

function build(now: Date): Application[] {
  const d = (days: number) => day(now, days);
  const t = (days: number, time: string) => at(now, days, time);

  return [
    {
      id: "technova-product-designer",
      role: "Product Designer",
      company: "TechNova Inc.",
      Icon: BuildingIcon,
      stage: "saved",
      summary:
        "End-to-end product design for their B2B analytics suite, working alongside two PMs.",
      match: 92,
      savedOn: d(-2),
      appliedOn: null,
      events: [{ kind: "deadline", title: "Application Closes", at: t(8, "23:59") }],
    },
    {
      id: "quantum-frontend-engineer",
      role: "Frontend Engineer",
      company: "Quantum Solutions",
      Icon: CubeIcon,
      stage: "saved",
      summary:
        "React and TypeScript on the design-systems team rebuilding their component library.",
      match: 84,
      savedOn: d(-7),
      appliedOn: null,
      events: [{ kind: "deadline", title: "Application Closes", at: d(12) }],
    },
    {
      // No closing date posted, so it is the one card with nothing scheduled.
      id: "brightline-interaction-designer",
      role: "Interaction Designer",
      company: "Brightline Labs",
      Icon: MonitorIcon,
      stage: "saved",
      summary:
        "Interaction design for a clinical scheduling tool used across three hospital networks.",
      match: 61,
      savedOn: d(-3),
      appliedOn: null,
      events: [],
    },
    {
      id: "nexus-ux-researcher",
      role: "UX Researcher",
      company: "Nexus Dynamics",
      Icon: NodesIcon,
      stage: "applied",
      summary:
        "Mixed-methods research on a fintech onboarding flow. Applied through their careers page.",
      match: 78,
      savedOn: d(-12),
      appliedOn: d(-8),
      events: [{ kind: "follow-up", title: "Hear Back By", at: d(10) }],
    },
    {
      id: "retailhub-senior-ui-designer",
      role: "Senior UI Designer",
      company: "RetailHub",
      Icon: StorefrontIcon,
      stage: "applied",
      summary: "Design-system and UI work across the storefront and the merchant dashboard.",
      match: 88,
      savedOn: d(-14),
      appliedOn: d(-11),
      events: [{ kind: "interview", title: "Recruiter Screen", at: t(4, "11:30") }],
    },
    {
      id: "orbit-product-engineer",
      role: "Product Engineer",
      company: "Orbit Analytics",
      Icon: OrbitIcon,
      stage: "applied",
      summary:
        "Full-stack work on self-serve dashboards. Referred by a former teammate on the data team.",
      match: 70,
      savedOn: d(-18),
      appliedOn: d(-14),
      events: [{ kind: "follow-up", title: "Follow Up", at: d(2) }],
    },
    {
      id: "cloudsync-lead-designer",
      role: "Lead Designer",
      company: "CloudSync",
      Icon: CloudIcon,
      stage: "interviewing",
      status: "Round 3",
      summary:
        "Leading design for the platform team. The technical interview is the third of four rounds.",
      match: 95,
      savedOn: d(-30),
      appliedOn: d(-21),
      events: [
        { kind: "interview", title: "Recruiter Screen", at: t(-14, "10:00") },
        { kind: "interview", title: "Portfolio Review", at: t(-6, "15:00") },
        { kind: "interview", title: "Technical Interview", at: t(1, "14:00") },
      ],
    },
    {
      id: "vertex-design-systems-lead",
      role: "Design Systems Lead",
      company: "Vertex Mobility",
      Icon: PinIcon,
      stage: "interviewing",
      status: "Round 2",
      summary:
        "Owning the component library across the rider and driver apps. Round one was a portfolio review.",
      match: 86,
      savedOn: d(-16),
      appliedOn: d(-12),
      events: [
        { kind: "interview", title: "Portfolio Review", at: t(-5, "13:00") },
        { kind: "interview", title: "Hiring Manager Call", at: t(3, "15:30") },
      ],
    },
    {
      id: "harbor-product-designer-ii",
      role: "Product Designer II",
      company: "Harbor Bank",
      Icon: LandmarkIcon,
      stage: "interviewing",
      status: "Final Round",
      summary:
        "Onboarding and account flows for their consumer app. The last step is an onsite with the team.",
      match: 58,
      savedOn: d(-35),
      appliedOn: d(-28),
      events: [
        { kind: "interview", title: "Phone Screen", at: t(-20, "11:00") },
        { kind: "interview", title: "Design Exercise Review", at: t(-9, "14:00") },
        { kind: "interview", title: "Onsite Interview", at: t(6, "09:00") },
      ],
    },
    {
      id: "fintech-ui-developer",
      role: "UI Developer",
      company: "FinTech Corp",
      Icon: CoinIcon,
      stage: "offer",
      summary: "Offer in hand for their payments dashboard team. Needs an answer within the week.",
      match: 90,
      savedOn: d(-40),
      appliedOn: d(-33),
      events: [
        { kind: "interview", title: "Recruiter Screen", at: t(-26, "10:30") },
        { kind: "interview", title: "Final Round", at: t(-12, "13:00") },
        { kind: "offer", title: "Offer Received", at: d(-3) },
        { kind: "offer", title: "Negotiation Call", at: t(2, "16:00") },
        { kind: "offer", title: "Respond By", at: d(7) },
      ],
    },
    {
      id: "atlas-frontend-developer",
      role: "Frontend Developer",
      company: "Atlas Travel",
      Icon: PlaneIcon,
      stage: "offer",
      summary:
        "Offer from the booking experience team, with a signing bonus. Waiting on the benefits details.",
      match: 81,
      savedOn: d(-38),
      appliedOn: d(-30),
      events: [
        { kind: "interview", title: "Technical Interview", at: t(-18, "14:00") },
        { kind: "interview", title: "Final Round", at: t(-10, "11:00") },
        { kind: "offer", title: "Offer Received", at: d(-2) },
        { kind: "offer", title: "Benefits Review", at: t(5, "11:00") },
        { kind: "offer", title: "Respond By", at: d(14) },
      ],
    },
    {
      id: "greenleaf-ui-ux-designer",
      role: "UI/UX Designer",
      company: "Greenleaf Energy",
      Icon: LeafIcon,
      stage: "offer",
      summary:
        "Verbal offer for the customer portal redesign. The written offer follows their reference checks.",
      match: 67,
      savedOn: d(-45),
      appliedOn: d(-37),
      events: [
        { kind: "interview", title: "Hiring Manager Call", at: t(-22, "15:00") },
        { kind: "offer", title: "Verbal Offer", at: d(-1) },
        { kind: "offer", title: "Reference Check", at: t(5, "14:00") },
        { kind: "offer", title: "Written Offer Due", at: d(9) },
      ],
    },
  ];
}

/** The time of the request, read once. cache() so every component in one
 *  render agrees on it: the fixture is dated against it, and the pages ask
 *  what is still upcoming against the same instant. */
export const getNow = cache(() => new Date());

/** Every application, dated against the time of the request. */
export const getApplications = cache(() => build(getNow()));
