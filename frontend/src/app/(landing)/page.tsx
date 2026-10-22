import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

import { Applications } from "./applications";
import { Bridge } from "./bridge";
import { faqs, hero, site } from "./data";
import { FaqList } from "./faq-list";
import { FocusIn } from "./focus-in";
import { GrowIn } from "./grow-in";
import { HeroCity } from "./hero-city";
import { HeroTitle } from "./hero-title";
import { HiringSystemsSection } from "./hiring-pipeline";
import { Journey } from "./journey";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "./layout-parts";
import { ProductTour } from "./product-tour";
import { SocialSignUpButton } from "./social-sign-up";
import { Statement } from "./statement";
import { Testimonial } from "./testimonial";

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

      {/* The followed application crosses the board: applications.tsx. */}
      <Applications />

      {/* How it works: a deck of four cards that fans and flips: journey.tsx. */}
      <Journey />

      {/* Hiring systems: a ring of logo coins that becomes a 3D pipeline
            (hiring-pipeline.tsx). The Features menu's foot row links here. */}
      <HiringSystemsSection />

      {/* Testimonial, read word by word: testimonial.tsx. */}
      <section className={cn(PANEL_INSET, "mt-2 sm:mt-6")}>
        <GrowIn className={cn(PANEL, "bg-surface py-20 sm:py-28")}>
          <div className={CONTAINER}>
            <Testimonial />
          </div>
        </GrowIn>
      </section>

      {/* FAQ: the questions rise in as they scroll in (landing.css). */}
      <section id="faq" className="py-20 sm:py-28">
        <div className={CONTAINER}>
          <FocusIn>
            <SectionHeading eyebrow="FAQ" title="Questions, answered." />
          </FocusIn>
          <FaqList items={faqs} className="faq-rise mt-12" />
        </div>
      </section>
    </main>
  );
}
