import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

import { GlassButton } from "../buttons";
import { FaqList } from "../faq-list";
import { FocusIn } from "../focus-in";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "../layout-parts";
import {
  billing,
  billingFaqs,
  features,
  plans,
  PAID_PLANS_ON_SALE,
  type Cell,
  type Plan,
  type PlanId,
} from "./data";
import { RowArrival } from "./row-arrival";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "WorkIt's plans for students: start free with every feature, or raise your daily Auto Apply, Tailor and Scout limits with Plus or Pro.",
};

/**
 * /pricing, after Jobright's pricing page: one board where the plans head
 * their own columns and every feature runs across them as a row, then the
 * billing FAQ and a sign-up panel. Everything it says about a plan lives in
 * data.ts. The Monthly / 3 months switch needs no JavaScript: it is two
 * native radios (arrow keys move between them), and the prices read the
 * checked one with :has().
 *
 * It opens with motion (landing.css, "The Pricing page's motion"): the hero
 * and the board rise in, the cards one after another, the Popular pill pops
 * on and a light sweeps once across Plus; a switched price rolls in and its
 * strike draws; each feature row rises in as it reaches the screen
 * (`RowArrival`); the FAQ and the closing band rise as on the home page.
 * Every piece is a CSS animation of `opacity` and `transform` that runs from
 * the server's HTML, so it plays before the script loads and ends on the
 * page as drawn; nothing above the glass fades. With reduced motion it is
 * still.
 */
export default function PricingPage() {
  return (
    <main id="main" className="flex-1">
      {/* Hero and board, in one rounded panel. The blobs are the panel's own
          background so the glass has colour to blur; nothing between them
          and the glass may fade, filter or mask (landing.css). */}
      <section className={PANEL_INSET}>
        <div
          className={cn(PANEL, "pt-14 pb-12 sm:pt-16 sm:pb-16 lg:pt-20 lg:pb-20")}
          style={{ background: HERO_BACKDROP }}
        >
          <div className={cn(CONTAINER, "text-center")}>
            <p
              className="hero-rise text-landing-brand-800 mx-auto w-fit rounded-full px-4 py-1.5 text-xs font-semibold tracking-[0.18em] uppercase [box-shadow:var(--brand-glass-edge)] [background:var(--brand-glass-fill)]"
              style={{ "--rd": "0s" } as CSSProperties}
            >
              Pricing
            </p>
            <h1
              className="hero-rise from-ink to-landing-brand-800 mx-auto mt-6 max-w-3xl bg-linear-to-b from-40% bg-clip-text pb-[0.1em] text-[2.75rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-transparent sm:text-6xl"
              style={{ "--rd": "0.08s" } as CSSProperties}
            >
              Plans built for students.
            </h1>
            <p
              className="hero-rise text-ink-muted mx-auto mt-4 max-w-[600px] text-lg leading-[1.55] text-pretty sm:text-[19px]"
              style={{ "--rd": "0.18s" } as CSSProperties}
            >
              Start free. Upgrade when you want more applications filled and more resumes tailored
              each day.
            </p>
          </div>

          <div className={cn(CONTAINER, "mt-12 sm:mt-14")}>
            <PlanBoard />
            <p className="text-ink-meta mt-6 text-center text-sm">
              Daily limits reset at midnight UTC.
            </p>
          </div>
        </div>
      </section>

      {/* The home page's FAQ: the heading comes into focus and the questions
          rise in one after another once the list is on screen. */}
      <section className="py-20 sm:py-28">
        <div className={CONTAINER}>
          <FocusIn>
            <SectionHeading eyebrow="FAQ" title="Billing, answered." />
          </FocusIn>
          <FocusIn>
            <FaqList items={billingFaqs} className="faq-rise mt-12" />
          </FocusIn>
        </div>
      </section>

      {/* Closing call to action, in the hero's colours. */}
      <section className={cn(PANEL_INSET, "mb-2 sm:mb-6")}>
        <div
          className={cn(PANEL, "py-20 text-center sm:py-24")}
          style={{ background: CLOSING_BACKDROP }}
        >
          {/* Its headline, line and button rise in, a little apart. */}
          <FocusIn>
            <div className={CONTAINER}>
              <h2 className="text-ink mx-auto max-w-2xl text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
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
          </FocusIn>
        </div>
      </section>
    </main>
  );
}

/**
 * The board. From xl up it is one grid: a glass panel for the paid plans
 * (the intro and switch, then Plus and Pro heading their columns), a grey
 * panel for Free on the right (the basic tier, so no violet), and a feature row across all three, each row
 * a subgrid so its cells line up under the plans. Below xl the same markup
 * stacks: the plans as cards (a row of three from md), then each feature
 * with a box per plan; the 14rem plan columns need xl's width.
 *
 * The panels and Plus's strip are absolutely placed grid children: with no
 * row set, they span the grid's full height, and they never take a cell
 * from auto-placement. They sit at -z-10 inside the `isolate` grid.
 */
function PlanBoard() {
  return (
    <div className="group/pricing relative isolate mx-auto grid max-w-md grid-cols-1 gap-6 md:max-w-3xl md:grid-cols-3 md:gap-4 xl:max-w-none xl:grid-cols-[2rem_minmax(0,1fr)_14rem_14rem_1.5rem_1.5rem_14rem] xl:gap-0 xl:py-8">
      {/* The panels settle in, each on itself: the glass may fade, but
          nothing above it may. Plus's strip grows down from the top. */}
      <div
        className="price-panel glass-card absolute inset-0 -z-10 hidden rounded-[2rem] xl:col-[1/6] xl:block"
        style={{ "--d": "0.22s" } as CSSProperties}
      />
      <div
        className="price-panel bg-canvas ring-border absolute inset-0 -z-10 hidden rounded-[2rem] ring-1 ring-inset xl:col-[7/8] xl:block"
        style={{ "--d": "0.3s" } as CSSProperties}
      />
      <div className="price-strip bg-landing-brand-100/80 absolute inset-x-1 inset-y-5 -z-10 hidden rounded-[1.5rem] xl:col-[3/4] xl:block" />
      <RowArrival />

      <div
        className="hero-rise text-center md:col-span-3 md:mb-4 xl:col-[2] xl:row-[1] xl:mb-0 xl:pr-8 xl:pb-8 xl:text-left"
        style={{ "--rd": "0.3s" } as CSSProperties}
      >
        <h2 className="text-ink text-2xl font-semibold tracking-tight">Choose your plan</h2>
        <p className="text-ink-meta mt-2 text-sm text-pretty">
          Every plan includes every feature. Paid plans raise the daily limits.
        </p>
        <BillingSwitch />
      </div>

      {/* The cards rise in one after another, in board order. */}
      <PlanHeader
        plan={plans.plus}
        delay={0.38}
        className="xl:col-[3] xl:row-[1] xl:mx-2 xl:mb-8"
      />
      <PlanHeader plan={plans.pro} delay={0.48} className="xl:col-[4] xl:row-[1] xl:mx-2 xl:mb-8" />
      <PlanHeader plan={plans.free} delay={0.58} className="xl:col-[7] xl:row-[1]" />

      <h2
        data-row
        className="price-cell text-ink mt-6 text-lg font-semibold md:col-span-3 xl:col-[2/5] xl:row-[2] xl:mt-0 xl:pb-3"
        style={{ "--i": 0 } as CSSProperties}
      >
        What each plan includes
      </h2>
      <ul role="list" className="md:col-span-3 xl:contents">
        {/* Each row rises in, its feature first and then each plan's cell
            (`--i`, `--j`); a row below the screen waits for it. */}
        {features.map((row, i) => (
          <li
            key={row.feature}
            data-row
            className="border-landing-brand-950/10 border-t pt-5 xl:col-span-full xl:grid xl:grid-cols-subgrid xl:border-0 xl:pt-0"
            style={{ "--i": i + 1 } as CSSProperties}
          >
            <div className="price-cell xl:border-landing-brand-950/8 xl:col-[2] xl:border-t xl:py-4 xl:pr-6">
              <p className="text-ink font-semibold">{row.feature}</p>
              <p className="text-ink-meta mt-0.5 text-sm">{row.detail}</p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 xl:contents">
              {COLUMNS.map(({ id, className }, j) => (
                <div
                  key={id}
                  className={cn(
                    "price-cell ring-landing-brand-950/5 xl:border-landing-brand-950/8 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-white/60 px-2 py-2.5 text-center ring-1 xl:rounded-none xl:border-t xl:bg-transparent xl:py-4 xl:ring-0",
                    className,
                  )}
                  style={{ "--j": j + 1 } as CSSProperties}
                >
                  <span className="text-ink-meta text-[11px] font-semibold tracking-wide uppercase xl:sr-only">
                    {plans[id].name}
                  </span>
                  <Value cell={row.cells[id]} plan={id} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The plan columns from xl up, in board order: the paid plans, then Free in
 *  its own panel past the gap. */
const COLUMNS: { id: PlanId; className: string }[] = [
  { id: "plus", className: "xl:col-[3]" },
  { id: "pro", className: "xl:col-[4]" },
  { id: "free", className: "bg-canvas ring-border xl:col-[7]" },
];

/** What a plan gives for one feature. Plus's limits are solid violet pills on
 *  its strip, Pro's tinted ones, Free's plain text and grey checks, after
 *  Jobright's board. */
function Value({ cell, plan }: { cell: Cell; plan: PlanId }) {
  if (cell === "included") {
    return (
      <span
        className={cn(
          "price-check inline-flex size-6 items-center justify-center rounded-full text-white",
          plan === "free" ? "bg-ink-meta" : "bg-landing-brand-600",
        )}
      >
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        <span className="sr-only">Included</span>
      </span>
    );
  }
  if (cell === "soon") {
    return (
      <span className="text-ink-meta ring-landing-brand-950/10 rounded-full bg-white/80 px-2.5 py-1 text-xs whitespace-nowrap ring-1">
        Coming soon
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-sm font-semibold whitespace-nowrap",
        plan === "plus" && "bg-landing-brand-600 rounded-full px-3 py-1 text-white shadow-sm",
        plan === "pro" && "bg-landing-brand-100 text-landing-brand-800 rounded-full px-3 py-1",
        plan === "free" && "text-ink",
      )}
    >
      {cell} a day
    </span>
  );
}

/** Soft violet blobs under the board, over white fading to the brand tint.
 *  Violet only and the same on both sides, so the glass reads alike: a
 *  magenta blob once turned the Pro card pink. */
const HERO_BACKDROP = [
  "radial-gradient(42% 32% at 12% 72%, color-mix(in oklab, var(--color-landing-brand-400) 38%, transparent), transparent)",
  "radial-gradient(42% 32% at 88% 72%, color-mix(in oklab, var(--color-landing-brand-400) 38%, transparent), transparent)",
  "radial-gradient(45% 28% at 52% 96%, color-mix(in oklab, var(--color-landing-brand-300) 50%, transparent), transparent)",
  "linear-gradient(180deg, #ffffff 0%, #ffffff 28%, var(--color-brand-tint) 100%)",
].join(", ");

const CLOSING_BACKDROP = [
  "radial-gradient(50% 70% at 15% 100%, color-mix(in oklab, var(--color-landing-brand-400) 30%, transparent), transparent)",
  "radial-gradient(45% 70% at 85% 0%, color-mix(in oklab, var(--color-landing-brand-300) 35%, transparent), transparent)",
  "var(--color-brand-tint)",
].join(", ");

/** The highlighted plan's fill: a soft violet glow at the bottom, over a deep violet gradient that starts at landing-brand-600
 *  where the small type sits (white on it is 6.26:1). */
const FEATURED_FILL = [
  "radial-gradient(80% 45% at 0% 100%, color-mix(in oklab, var(--color-landing-brand-400) 30%, transparent), transparent)",
  "linear-gradient(165deg, var(--color-landing-brand-600), var(--color-landing-brand-800) 60%, var(--color-landing-brand-900))",
].join(", ");

/** One term's price shows, the other's hides: the board is `group/pricing`,
 *  and it holds the switch's radios. Each rolls in as it shows
 *  (`.price-swap`: a CSS animation starts again each time its element is
 *  shown), so a switched price slides up into place with no script; an
 *  inline block, since a transform does nothing to an inline box. */
const ON_MONTHLY = "price-swap inline-block group-has-[#billing-quarterly:checked]/pricing:hidden";
const ON_QUARTERLY =
  "price-swap hidden group-has-[#billing-quarterly:checked]/pricing:inline-block";

/** Monthly or 3 months: two native radios drawn as a segmented control, so
 *  Tab reaches it and the arrow keys switch it with no script. */
function BillingSwitch() {
  return (
    <fieldset className="ring-landing-brand-950/10 mx-auto mt-5 flex w-fit rounded-full bg-white/80 p-1 shadow-sm ring-1 xl:mx-0">
      <legend className="sr-only">Billing period</legend>
      {billing.map((term, index) => (
        // The checked option's pill grows into place behind its label, a
        // layer of its own so it can scale; no script.
        <label
          key={term.id}
          className="text-ink-meta has-checked:text-ink has-focus-visible:outline-landing-brand-500 before:bg-landing-brand-100 relative isolate flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors select-none before:absolute before:inset-0 before:-z-10 before:scale-75 before:rounded-full before:opacity-0 before:transition-[opacity,scale] before:duration-300 before:ease-[var(--ease-glide)] has-checked:before:scale-100 has-checked:before:opacity-100 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 motion-reduce:before:transition-none"
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
            <span className="bg-landing-brand-600 rounded-full px-2 py-0.5 text-xs text-white">
              {term.note}
            </span>
          )}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A plan at the head of its column: the price and the button. Plus is filled
 * violet with a tilted badge over its top edge, so nothing here may take
 * `overflow-hidden`. Free is grey, the basic tier; from xl up it sits in its
 * own grey panel, so there it drops its card and reaches the panel's top.
 */
function PlanHeader({
  plan,
  className,
  delay,
}: {
  plan: Plan;
  className: string;
  /** When it rises in, in s (`.price-card`). */
  delay: number;
}) {
  const featured = plan.highlighted;
  const free = plan.id === "free";
  // Until billing ships, a paid plan's button leads to the free sign-up and
  // says so: "Get Plus" would sell a plan nobody can buy yet.
  const label = free
    ? "Get started for free"
    : PAID_PLANS_ON_SALE
      ? `Get ${plan.name}`
      : `Start free, then ${plan.name}`;
  const meta = featured ? "text-white/80" : "text-ink-meta";

  return (
    <div
      className={cn(
        "price-card relative isolate flex flex-col rounded-[1.75rem] p-6 text-left md:p-5",
        featured &&
          "text-white shadow-[0_24px_48px_-20px_rgb(58_30_124/0.7)] ring-1 ring-white/25 ring-inset",
        plan.id === "pro" && "text-ink ring-landing-brand-950/10 bg-white/80 shadow-sm ring-1",
        free &&
          "text-ink bg-canvas ring-border ring-1 xl:-mt-8 xl:rounded-t-[2rem] xl:rounded-b-none xl:bg-transparent xl:px-5 xl:pt-13 xl:pb-13 xl:ring-0",
        className,
      )}
      style={
        {
          ...(featured ? { background: FEATURED_FILL } : {}),
          "--d": `${delay}s`,
        } as CSSProperties
      }
    >
      {featured && (
        <>
          {/* A light sweeps once across the card after it lands, clipped to
              the card by this layer, never by the card: the pill hangs over
              its edge. Behind the text. */}
          <span
            aria-hidden="true"
            className="price-sheen pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[1.75rem]"
          >
            <span className="absolute inset-y-0 left-0 w-1/2 bg-linear-to-r from-transparent via-white/25 to-transparent" />
          </span>
          {/* Straight, centred on the top edge, popping on once the card has
              landed: the team found a tilted "Recommended" out of place. */}
          <span className="price-badge text-landing-brand-800 ring-landing-brand-950/10 absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] uppercase shadow-[0_8px_20px_-6px_rgb(34_17_75/0.55)] ring-1">
            Popular
          </span>
        </>
      )}

      <h3 className="text-xl font-semibold">{plan.name}</h3>
      <p className={cn("mt-1.5 text-sm xl:min-h-15", meta)}>{plan.pitch}</p>

      <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-4xl font-semibold tracking-tight">
          <span className={ON_MONTHLY}>${plan.price.monthly}</span>
          <span className={ON_QUARTERLY}>${plan.price.quarterly}</span>
        </span>
        {!free && (
          <span className={cn(ON_QUARTERLY, "text-lg", meta)}>
            <span className="sr-only">instead of </span>
            {/* Its strike draws across, left to right (`.price-strike`). */}
            <s className="price-strike">${plan.price.monthly}</s>
          </span>
        )}
        <span className={cn("text-sm", meta)}>/ month</span>
      </p>
      <p className={cn("mt-1 text-xs", meta)}>
        {free ? (
          "No card needed"
        ) : (
          <>
            <span className={ON_MONTHLY}>Billed monthly</span>
            <span className={ON_QUARTERLY}>${plan.price.quarterly * 3} billed every 3 months</span>
          </>
        )}
      </p>

      <div className="mt-auto pt-5">
        {free ? (
          <Link
            href="/signup"
            className="text-ink hover:bg-surface ring-ink/15 inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-sm font-semibold shadow-sm ring-1 transition-colors ring-inset"
          >
            {label}
          </Link>
        ) : featured ? (
          <Link
            href="/signup"
            className="text-landing-brand-900 hover:bg-landing-brand-50 inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-sm font-semibold shadow-[0_10px_24px_-10px_rgb(34_17_75/0.7)] transition-colors focus-visible:outline-white!"
          >
            {label}
          </Link>
        ) : (
          <GlassButton href="/signup" label={label} className="h-11 w-full rounded-full" />
        )}
      </div>
    </div>
  );
}
