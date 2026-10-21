/**
 * The Pricing page's plans, prices, limits and billing FAQ, in one place.
 *
 * **Placeholders.** WorkIt has no billing yet, so every account is on Free
 * and nobody can buy Plus or Pro. The team picked these numbers on
 * 2026-10-21 against Simplify+, Jobright Turbo and Teal+ ($29 to $39.99 a
 * month): half their price, for students. While `PLANS_ARE_PLACEHOLDERS` is
 * true the page says "Prices are not final" and the paid cards say they are
 * not on sale; set it to false only once billing ships and the limits below
 * are enforced.
 *
 * Every limit is a claim. Free's Tailor and Scout limits are the caps the
 * API enforces today (`ai_tailor_cap`, `ai_scout_cap` in
 * `backend/app/config.py`); change them together. The API has no Auto Apply
 * limit and no paid caps yet. A Scout use is one message the student sends
 * (`backend/app/routers/scout.py`), a Tailor use one resume tailored to one
 * job posting; neither counts when it fails.
 */
export const PLANS_ARE_PLACEHOLDERS = true;

export type PlanId = "free" | "plus" | "pro";
export type BillingId = "monthly" | "quarterly";

/** The switch above the cards. A job search runs one recruiting season, so
 *  the longer term is 3 months, as Simplify, Jobright and Teal sell it, not a
 *  year. */
export const billing: { id: BillingId; label: string; note?: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "3 months", note: "Save 20%" },
];

/** Uses a day, per plan. Every limit resets at midnight UTC, as the API's do
 *  (`backend/app/services/usage.py`). */
const limits = {
  autoApply: { free: 5, plus: 15, pro: 40 },
  tailor: { free: 2, plus: 15, pro: 40 },
  scout: { free: 3, plus: 50, pro: 150 },
} satisfies Record<string, Record<PlanId, number>>;

export type Plan = {
  id: PlanId;
  name: string;
  pitch: string;
  /** Dollars a month on each term; the 3-month term bills 3 of them at once. */
  price: Record<BillingId, number>;
  /** The card's list, under its title: the plan's limits, then for Free the
   *  features every plan has. */
  listTitle: string;
  includes: string[];
  /** The one plan drawn filled in violet, so it stands out from the others. */
  highlighted?: boolean;
};

export const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    pitch: "Everything you need to start your search.",
    price: { monthly: 0, quarterly: 0 },
    listTitle: "What you get:",
    includes: [
      `Auto Apply: ${limits.autoApply.free} applications a day`,
      `Tailor: ${limits.tailor.free} resumes a day`,
      `Scout: ${limits.scout.free} messages a day`,
      "Job Matching on every job posting",
      "Resume Builder and Application Tracker",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    pitch: "For a steady search through recruiting season.",
    price: { monthly: 15, quarterly: 12 },
    listTitle: "Everything in Free, with higher limits:",
    includes: [
      `Auto Apply: ${limits.autoApply.plus} applications a day`,
      `Tailor: ${limits.tailor.plus} resumes a day`,
      `Scout: ${limits.scout.plus} messages a day`,
    ],
    highlighted: true,
  },
  {
    id: "pro",
    name: "Pro",
    pitch: "For students who apply to many jobs each week.",
    price: { monthly: 29, quarterly: 23 },
    listTitle: "Everything in Plus, with the highest limits:",
    includes: [
      `Auto Apply: ${limits.autoApply.pro} applications a day`,
      `Tailor: ${limits.tailor.pro} resumes a day`,
      `Scout: ${limits.scout.pro} messages a day`,
    ],
  },
];

/** A table cell: a daily limit, included, or not built yet. */
export type Cell = number | "included" | "soon";

const every = (cell: Cell): Record<PlanId, Cell> => ({ free: cell, plus: cell, pro: cell });

/**
 * The comparison table, one group per feature. Updates (replies from
 * employers on the tracker) are not built, whatever the home page's tour
 * shows, so they stay "Coming soon" here until they are.
 */
export const comparison: {
  feature: string;
  note?: string;
  rows: { label: string; cells: Record<PlanId, Cell> }[];
}[] = [
  {
    feature: "Resume Builder and tailoring",
    rows: [
      { label: "Resumes built from your experience bank, as PDFs", cells: every("included") },
      { label: "Resumes tailored to a job posting", cells: limits.tailor },
    ],
  },
  {
    feature: "Job Matching",
    rows: [
      { label: "A match score on every job posting", cells: every("included") },
      { label: "Jobs sorted by Best Match", cells: every("included") },
    ],
  },
  {
    feature: "Auto Apply",
    note: "One application at a time. You check each one and click Submit.",
    rows: [{ label: "Applications filled for you", cells: limits.autoApply }],
  },
  {
    feature: "Application Tracker and updates",
    rows: [
      { label: "Every application in one place", cells: every("included") },
      { label: "Replies from employers, on your tracker", cells: every("soon") },
    ],
  },
  {
    feature: "Scout",
    rows: [{ label: "Messages to Scout", cells: limits.scout }],
  },
];

/**
 * Billing questions. Each answer is a claim: Auto Apply's rules are
 * auto-apply/architecture.md's (one at a time, the student submits,
 * Greenhouse only for now in `backend/app/auto_apply/hosts.py`), and nothing
 * here promises a billing term (refunds, cancelling) that does not exist yet.
 */
export const billingFaqs = [
  {
    question: "Can I buy Plus or Pro today?",
    answer:
      "Not yet. WorkIt has no billing yet, so every account is on the Free plan. The prices and limits on this page are not final and can change before paid plans open.",
  },
  {
    question: "What counts as one use?",
    answer:
      "For Auto Apply, one application filled for you. For Tailor, one resume tailored to one job posting. For Scout, one message you send. A Tailor run or a Scout message that fails does not count.",
  },
  {
    question: "When do the daily limits reset?",
    answer: "Every day at midnight UTC.",
  },
  {
    question: "Does WorkIt submit applications for me?",
    answer:
      "No. Auto Apply fills one application at a time in your Chrome, with the resume for that job attached. You check each one and click Submit yourself.",
  },
  {
    question: "Which applications can Auto Apply fill?",
    answer:
      "Job postings on Greenhouse, for now. More hiring systems come as the Chrome extension learns to fill them.",
  },
  {
    question: "Why 3 months and not a year?",
    answer:
      "A job search usually runs one recruiting season. The 3-month plan costs about 20% less than paying month by month.",
  },
  {
    question: "Is there a student discount?",
    answer:
      "Every plan is already priced for students. WorkIt lists internships and new-grad jobs only.",
  },
];
