import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

import ApplicationBoard from "./application-board";
import { Bridge } from "./bridge";
import { faqs, hero, hiringSystemsSection, journeySection, site, testimonial } from "./data";
import { FaqList } from "./faq-list";
import { HeroCity } from "./hero-city";
import { HeroTitle } from "./hero-title";
import { HiringSystems } from "./hiring-systems";
import { Journey } from "./journey";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "./layout-parts";
import { ProductTour } from "./product-tour";
import { SocialSignUpButton } from "./social-sign-up";
import { StageTimeline } from "./stage-timeline";
import { Statement } from "./statement";

export const metadata: Metadata = {
  title: { absolute: `${site.name} · ${site.tagline}` },
  description: hero.subtitle,
};

/**
 * The page at /: the team's marketing site's home page, its components
 * unchanged except for colour (the violet landing-brand-* scale) and the
 * WorkIt logo. Every call to action leads into the app's own sign-up,
 * log-in or OAuth flow.
 */
export default function LandingPage() {
  return (
    <main id="main" className="flex-1">
      {/* Hero, in a rounded panel inset from the window, like every
            full-width band on this page. The city is pinned to the panel's
            bottom; the spacer under the text leaves it room (hero-city.tsx). */}
      <section className={PANEL_INSET}>
        <div
          className={cn(
            PANEL,
            "hero-panel @container relative isolate flex flex-col overflow-hidden lg:min-h-[max(700px,48.6vw)]",
          )}
        >
          <HeroCity />
          <div className={cn(CONTAINER, "relative pt-20 text-center sm:pt-24 lg:pt-[128px]")}>
            {/* Sized so "Stop filling out applications" fits one line from
                lg up; the hero's text-measuring mark is inside, on the
                moving copy (hero-title.tsx). */}
            <h1 className="text-ink mx-auto max-w-6xl text-[2.4rem] leading-[1.08] font-semibold tracking-[-0.035em] sm:text-6xl lg:text-[clamp(3.25rem,5.1vw,4.25rem)]">
              <HeroTitle />
            </h1>
            <p
              data-hero-text
              className="hero-rise text-ink-muted mx-auto mt-[22px] max-w-[640px] text-lg leading-[1.55] text-pretty sm:text-[19px]"
              style={{ "--rd": ".55s" } as CSSProperties}
            >
              {hero.subtitle}
            </p>
            <div
              data-hero-box
              className="hero-rise mt-[34px] flex flex-col items-center justify-center gap-3 sm:flex-row"
              style={{ "--rd": ".65s" } as CSSProperties}
            >
              <SocialSignUpButton provider="google" />
              <SocialSignUpButton provider="linkedin_oidc" />
            </div>
          </div>
          {/* Below lg the city is scaled to the panel and sits under the
                text; from lg up it is full size and its edge towers rise
                beside the text. */}
          <div aria-hidden="true" className="h-[40cqw] shrink-0 lg:h-[max(245px,17.6cqw)]" />
        </div>
      </section>

      {/* From the hero's postings to the tour's four steps: bridge.tsx. */}
      <Bridge />

      {/* Pinned product tour: the four features, one stop each. */}
      <div className="mt-2 sm:mt-4">
        <ProductTour />
      </div>

      {/* Why it matters, read by scrolling: statement.tsx. */}
      <Statement />

      {/* Applicant tracking showcase */}
      <section id="applications" className="pt-20 pb-10 sm:pt-28 sm:pb-16">
        <div
          className={cn(
            CONTAINER,
            "grid grid-cols-1 items-center gap-4 sm:gap-6 lg:grid-cols-5 lg:gap-12",
          )}
        >
          <div className="lg:col-span-2">
            <SectionHeading
              align="left"
              eyebrow="For applicants"
              title="Every application, from saved to signed."
              subtitle="Keep every role you're pursuing on one board, with the next step and the deadline right on each card."
            />
            <StageTimeline />
          </div>
          <div className="lg:col-span-3">
            <ApplicationBoard />
          </div>
        </div>
      </section>

      {/* How it works: the search end to end, as an expanding card row. */}
      <section className="py-20 sm:py-28">
        <div className={CONTAINER}>
          <SectionHeading
            eyebrow={journeySection.eyebrow}
            title={journeySection.title}
            subtitle={journeySection.subtitle}
          />
          <div className="mt-12 sm:mt-16">
            <Journey />
          </div>
        </div>
      </section>

      {/* Hiring systems, in a rounded panel. The Features menu's foot row
            links here. */}
      <section id="hiring-systems" className={PANEL_INSET}>
        <div className={cn(PANEL, "bg-surface py-20 sm:py-28")}>
          <div className={CONTAINER}>
            <SectionHeading
              eyebrow={hiringSystemsSection.eyebrow}
              title={hiringSystemsSection.title}
              subtitle={hiringSystemsSection.subtitle}
            />
            <HiringSystems />
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className={cn(PANEL_INSET, "mt-2 sm:mt-6")}>
        <div className={cn(PANEL, "bg-surface py-20 sm:py-28")}>
          <div className={CONTAINER}>
            <figure className="mx-auto max-w-3xl text-center">
              <blockquote className="text-ink text-2xl font-medium tracking-tight text-balance sm:text-3xl">
                <p>“{testimonial.quote}”</p>
              </blockquote>
              <figcaption className="mt-8">
                <p className="text-ink font-semibold">{testimonial.name}</p>
                <p className="text-ink-meta text-sm">{testimonial.role}</p>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 sm:py-28">
        <div className={CONTAINER}>
          <SectionHeading eyebrow="FAQ" title="Questions, answered." />
          <FaqList items={faqs} className="mt-12" />
        </div>
      </section>
    </main>
  );
}
