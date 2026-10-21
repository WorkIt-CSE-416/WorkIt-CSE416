import { Check, Info, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { cn } from "@/lib/cn";

import { GlassButton } from "../buttons";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "../layout-parts";
import {
  billing,
  billingFaqs,
  comparison,
  plans,
  PLANS_ARE_PLACEHOLDERS,
  type Cell,
  type Plan,
} from "./data";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Start free with Job Matching, the Resume Builder and the Application Tracker. Plus and Pro fill more applications, tailor more resumes and answer more Scout messages each day.",
};

/**
 * /pricing: the plans over violet blobs in the hero panel (Plus filled, the
 * other two glass), then the feature table, the billing FAQ and a sign-up
 * panel. Everything it
 * says about a plan lives in data.ts. No JavaScript: the Monthly / 3 months
 * switch is two native radios (arrow keys move between them), and the cards
 * read the checked one with :has().
 */
export default function PricingPage() {
  return (
    <main id="main" className="flex-1">
      {/* Hero and plans, in one rounded panel. The blobs are the panel's own
          background so the glass cards have colour to blur; nothing between
          them and the cards may fade, filter or mask (landing.css). */}
      <section className={PANEL_INSET}>
        <div
          className={cn(PANEL, "pt-16 pb-12 sm:pt-20 sm:pb-16 lg:pt-24 lg:pb-20")}
          style={{ background: HERO_BACKDROP }}
        >
          <div className={cn(CONTAINER, "text-center")}>
            <h1 className="from-ink to-landing-brand-800 mx-auto max-w-3xl bg-linear-to-b from-40% bg-clip-text pb-[0.1em] text-[2.75rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-transparent sm:text-6xl">
              Pricing built for students.
            </h1>
            <p className="text-ink-muted mx-auto mt-4 max-w-[600px] text-lg leading-[1.55] text-pretty sm:text-[19px]">
              Start free. Upgrade when you want more applications filled and more resumes tailored
              each day.
            </p>
          </div>

          <div className={cn(CONTAINER, "group/pricing mt-10")}>
            {PLANS_ARE_PLACEHOLDERS && <PlaceholderNote />}
            <BillingSwitch />
            <ul className="mx-auto mt-8 grid max-w-md gap-4 lg:max-w-none lg:grid-cols-3 lg:gap-6">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Every feature, plan by plan. */}
      <section className={cn(PANEL_INSET, "mt-2 sm:mt-6")}>
        <div className={cn(PANEL, "bg-surface py-20 sm:py-28")}>
          <div className={CONTAINER}>
            <SectionHeading
              eyebrow="Compare plans"
              title="What each plan includes."
              subtitle="Daily limits reset at midnight UTC."
            />
            <ComparisonTable />
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className={CONTAINER}>
          <SectionHeading eyebrow="FAQ" title="Billing, answered." />
          <FaqList items={billingFaqs} />
        </div>
      </section>

      {/* Closing call to action, in the hero's colours. */}
      <section className={cn(PANEL_INSET, "mb-2 sm:mb-6")}>
        <div
          className={cn(PANEL, "py-20 text-center sm:py-24")}
          style={{ background: CLOSING_BACKDROP }}
        >
          <div className={CONTAINER}>
            <h2 className="text-ink mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Start your search for free.
            </h2>
            <p className="text-ink-meta mx-auto mt-4 max-w-xl text-lg text-pretty">
              Sign up and upload a resume, and WorkIt starts ranking jobs by how well you fit. No
              card needed.
            </p>
            <GlassButton
              href="/signup"
              label="Get started for free"
              className="mt-8 h-12 px-6 text-base"
            />
          </div>
        </div>
      </section>
    </main>
  );
}

/** Soft violet and magenta blobs under the plan cards, over white fading to
 *  the brand tint. */
const HERO_BACKDROP = [
  "radial-gradient(42% 32% at 12% 72%, color-mix(in oklab, var(--color-landing-brand-400) 38%, transparent), transparent)",
  "radial-gradient(40% 30% at 88% 62%, color-mix(in oklab, var(--color-match-good) 24%, transparent), transparent)",
  "radial-gradient(45% 28% at 52% 96%, color-mix(in oklab, var(--color-landing-brand-300) 50%, transparent), transparent)",
  "linear-gradient(180deg, #ffffff 0%, #ffffff 28%, var(--color-brand-tint) 100%)",
].join(", ");

const CLOSING_BACKDROP = [
  "radial-gradient(50% 70% at 15% 100%, color-mix(in oklab, var(--color-landing-brand-400) 30%, transparent), transparent)",
  "radial-gradient(45% 70% at 85% 0%, color-mix(in oklab, var(--color-match-good) 18%, transparent), transparent)",
  "var(--color-brand-tint)",
].join(", ");

/** The highlighted plan's fill: a sheen and two soft circles over a deep
 *  violet gradient, light at the top where the small type sits (white on
 *  landing-brand-600 is 6.26:1). */
const FEATURED_FILL = [
  "linear-gradient(115deg, transparent 40%, rgb(255 255 255 / 0.13) 52%, transparent 64%)",
  "radial-gradient(circle 150px at 100% 0%, rgb(255 255 255 / 0.12) 99%, transparent 100%)",
  "radial-gradient(circle 110px at 74% 12%, rgb(255 255 255 / 0.08) 99%, transparent 100%)",
  "linear-gradient(165deg, var(--color-landing-brand-600), var(--color-landing-brand-800) 60%, var(--color-landing-brand-900))",
].join(", ");

/** One term's price shows, the other's hides: the cards sit inside
 *  `group/pricing`, which holds the switch's radios. */
const ON_MONTHLY = "group-has-[#billing-quarterly:checked]/pricing:hidden";
const ON_QUARTERLY = "hidden group-has-[#billing-quarterly:checked]/pricing:inline";

function PlaceholderNote() {
  return (
    <p className="bg-warning-tint text-warning ring-warning-fill/40 mx-auto mb-8 flex w-fit max-w-full items-start gap-2 rounded-2xl px-4 py-2.5 text-left text-sm ring-1 ring-inset">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">Prices are not final.</strong> WorkIt has no billing yet,
        so every account is on Free for now.
      </span>
    </p>
  );
}

/** Monthly or 3 months: two native radios drawn as a segmented control, so
 *  Tab reaches it and the arrow keys switch it with no script. */
function BillingSwitch() {
  return (
    <fieldset className="glass-card mx-auto flex w-fit rounded-full p-1">
      <legend className="sr-only">Billing period</legend>
      {billing.map((term, index) => (
        <label
          key={term.id}
          className="text-ink-meta has-checked:text-ink has-focus-visible:outline-landing-brand-500 flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors select-none has-checked:bg-white has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2"
        >
          <input
            type="radio"
            name="billing"
            id={`billing-${term.id}`}
            value={term.id}
            defaultChecked={index === 0}
            className="sr-only"
          />
          {term.label}
          {term.note && (
            <span className="bg-landing-brand-100 text-landing-brand-700 rounded-full px-2 py-0.5 text-xs">
              {term.note}
            </span>
          )}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A plan: its price and button above a rule, its list below. The highlighted
 * plan is filled violet with white type, a sheen and two soft circles, and on
 * lg reaches past the other two at top and bottom, so it is the one the eye
 * lands on; the other two stay glass over the panel's blobs.
 */
function PlanCard({ plan }: { plan: Plan }) {
  const featured = plan.highlighted;
  const free = plan.price.monthly === 0;
  // A paid plan's button still leads to the free sign-up until billing ships.
  const label = free || PLANS_ARE_PLACEHOLDERS ? "Get started for free" : `Get ${plan.name}`;
  const onSale = free ? "No card needed" : PLANS_ARE_PLACEHOLDERS ? "Not on sale yet" : null;
  const meta = featured ? "text-white/80" : "text-ink-meta";

  return (
    <li
      className={cn(
        "flex flex-col overflow-hidden rounded-[1.75rem] text-left",
        featured
          ? "text-white shadow-[0_32px_64px_-24px_rgb(58_30_124/0.65)] ring-1 ring-white/25 ring-inset lg:-my-4"
          : "glass-card text-ink",
      )}
      style={featured ? { background: FEATURED_FILL } : undefined}
    >
      <div className={cn("p-6 sm:p-8", featured && "lg:pt-12")}>
        <div className="flex min-h-7 items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{plan.name}</h2>
          {featured && (
            <span className="bg-warning-tint text-warning inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm">
              <Star className="size-3 fill-current" aria-hidden="true" />
              Recommended
            </span>
          )}
        </div>
        <p className={cn("mt-2 text-sm lg:min-h-10", meta)}>{plan.pitch}</p>

        <p className="mt-6 flex items-baseline gap-1.5">
          <span className="text-5xl font-semibold tracking-tight">
            <span className={ON_MONTHLY}>${plan.price.monthly}</span>
            <span className={ON_QUARTERLY}>${plan.price.quarterly}</span>
          </span>
          <span className={cn("text-sm", meta)}>/ month</span>
        </p>
        <p className={cn("mt-1 min-h-5 text-sm", meta)}>
          {!free && (
            <>
              <span className={ON_MONTHLY}>Billed monthly</span>
              <span className={ON_QUARTERLY}>${plan.price.quarterly * 3} every 3 months</span>
              {onSale && " · "}
            </>
          )}
          {onSale}
        </p>

        <div className="mt-6">
          {featured ? (
            <Link
              href="/signup"
              className="text-landing-brand-900 hover:bg-landing-brand-50 inline-flex h-12 w-full items-center justify-center rounded-lg bg-white text-base font-semibold shadow-[0_10px_24px_-10px_rgb(34_17_75/0.7)] transition-colors focus-visible:outline-white!"
            >
              {label}
            </Link>
          ) : (
            <GlassButton href="/signup" label={label} className="h-12 w-full text-base" />
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex-1 border-t p-6 sm:p-8",
          featured ? "border-white/20" : "border-landing-brand-950/10",
        )}
      >
        <p className="text-sm font-semibold">{plan.listTitle}</p>
        <ul className="mt-4 grid gap-3 text-sm">
          {plan.includes.map((line) => (
            <li
              key={line}
              className={cn("flex gap-2.5", featured ? "text-white" : "text-ink-muted")}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full",
                  featured ? "text-landing-brand-700 bg-white" : "bg-landing-brand-600 text-white",
                )}
                aria-hidden="true"
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/** One group per feature, its rows' limits in plan columns. Fixed columns,
 *  so it fits a phone without scrolling sideways. */
function ComparisonTable() {
  return (
    <table className="mx-auto mt-12 w-full max-w-4xl table-fixed border-collapse text-left text-sm">
      <caption className="sr-only">What each plan includes</caption>
      <colgroup>
        <col className="w-[37%] sm:w-[46%]" />
        {plans.map((plan) => (
          <col key={plan.id} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <td />
          {plans.map((plan) => (
            <th
              key={plan.id}
              scope="col"
              className={cn(
                "px-1 pb-2 text-center text-base font-semibold sm:px-4",
                plan.highlighted ? "text-landing-brand-700" : "text-ink",
              )}
            >
              {plan.name}
            </th>
          ))}
        </tr>
      </thead>
      {comparison.map((group) => (
        <tbody key={group.feature}>
          <tr>
            <th scope="colgroup" colSpan={plans.length + 1} className="pt-8 pb-3 font-normal">
              <span className="text-ink block text-base font-semibold">{group.feature}</span>
              {group.note && <span className="text-ink-meta mt-1 block text-sm">{group.note}</span>}
            </th>
          </tr>
          {group.rows.map((row) => (
            <tr key={row.label} className="border-border border-t">
              <th scope="row" className="text-ink-muted py-3 pr-2 font-normal">
                {row.label}
              </th>
              {plans.map((plan) => (
                <td key={plan.id} className="px-1 py-3 text-center sm:px-4">
                  <CellValue cell={row.cells[plan.id]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

function CellValue({ cell }: { cell: Cell }) {
  if (cell === "included") {
    return (
      <>
        <Check className="text-landing-brand-600 mx-auto size-5" aria-hidden="true" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (cell === "soon") return <span className="text-ink-meta text-xs">Coming soon</span>;
  return (
    <>
      <span className="text-ink block font-semibold">{cell}</span>
      <span className="text-ink-meta block text-xs">a day</span>
    </>
  );
}

/** The home page's FAQ list (`../page.tsx`), for the billing questions. */
function FaqList({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <div className="divide-border border-border mx-auto mt-12 max-w-3xl divide-y border-y">
      {items.map((item) => (
        // A shared name, so opening one question closes the others.
        <details key={item.question} name="billing-faq" className="group py-5">
          <summary className="text-ink flex cursor-pointer list-none items-center justify-between gap-6 font-medium [&::-webkit-details-marker]:hidden">
            {item.question}
            <span
              className="text-ink-meta relative size-4 shrink-0 before:absolute before:inset-x-0 before:top-1/2 before:h-0.5 before:-translate-y-1/2 before:rounded before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded after:bg-current after:transition-transform group-open:after:scale-y-0"
              aria-hidden="true"
            />
          </summary>
          <p className="text-ink-meta mt-3 pr-10">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
