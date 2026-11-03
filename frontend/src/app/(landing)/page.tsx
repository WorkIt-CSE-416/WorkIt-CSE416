import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";
import { SHARE_DEFAULTS, SHARE_IMAGE } from "@/lib/share-card";

import { ClosingCta } from "./closing-cta";
import {
  Applications,
  Bridge,
  HiringSystemsSection,
  ProductTour,
  Statement,
} from "./deferred-sections";
import { closing, faqs, hero, site, testimonial } from "./data";
import { FaqList } from "./faq-list";
import { FocusIn } from "./focus-in";
import { GrowIn } from "./grow-in";
import { HeroCity } from "./hero-city";
import { HeroTitle } from "./hero-title";
import { backdrop } from "./features/catalog";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "./layout-parts";
import { EmailSignUpLink, SocialSignUpButton } from "./social-sign-up";
import { Testimonial } from "./testimonial";

/** The home page's link preview has room for the whole tagline. */
const shareTitle = `${site.name}: ${site.tagline}`;

export const metadata: Metadata = {
  title: { absolute: `${site.name} · ${site.tabTitle}` },
  description: hero.subtitle,
  alternates: { canonical: "/" },
  openGraph: { ...SHARE_DEFAULTS, url: "/", title: shareTitle, description: hero.subtitle },
  twitter: {
    card: "summary_large_image",
    title: shareTitle,
    description: hero.subtitle,
    images: [SHARE_IMAGE],
  },
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
            {/* Below lg the headline keeps the room of the most lines any
                phrase takes at that width, and centres in it, so the subtitle
                does not jump on each swap: four, three or two lines, set by
                measuring every phrase. Four at every width left 129px of
                blank space round a two-line headline on a tablet. */}
            <h1 className="text-ink mx-auto min-h-[4.32em] max-w-6xl text-[2.4rem] leading-[1.08] font-semibold tracking-[-0.035em] max-lg:flex max-lg:flex-col max-lg:justify-center min-[27.5rem]:min-h-[3.24em] min-[33.125rem]:min-h-[2.16em] sm:min-h-[4.32em] sm:text-6xl min-[45rem]:min-h-[3.24em] min-[52.5rem]:min-h-[2.16em] lg:min-h-0 lg:text-[clamp(3.25rem,5.1vw,4.25rem)]">
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
              className="hero-rise mt-[34px] flex flex-col flex-wrap items-center justify-center gap-3 sm:flex-row"
              style={{ "--rd": ".65s" } as CSSProperties}
            >
              <SocialSignUpButton provider="google" />
              <SocialSignUpButton provider="linkedin_oidc" />
              <div className="w-full text-center sm:basis-full">
                <EmailSignUpLink />
              </div>
            </div>
          </div>
          {/* Below lg the city is scaled to the panel and sits under the
                text; from lg up it is full size and its edge towers rise
                beside the text. */}
          <div
            aria-hidden="true"
            className="h-[70cqw] shrink-0 sm:h-[40cqw] lg:h-[max(245px,17.6cqw)]"
          />
        </div>
      </section>

      {/* From the hero's postings to the tour's four steps: bridge.tsx. */}
      <Bridge />

      {/* Pinned product tour: the four features, one stop each. */}
      <div className="mt-2 sm:mt-4">
        <ProductTour />
      </div>

      {/* Hiring systems: a ring of logo coins that becomes a 3D pipeline
            (hiring-pipeline.tsx). Right after the tour: it is where the
            postings come from, and it names the systems whose filter the
            statement's first beat is. The Features menu's foot row links
            here. */}
      <HiringSystemsSection />

      {/* Why it matters, played on its own: statement.tsx. */}
      <Statement />

      {/* The followed application rides the route to the offer:
          applications.tsx. */}
      <Applications />

      {/* Testimonial, read word by word: testimonial.tsx. Hidden until a
          real quote replaces the placeholder (`testimonial.show`). */}
      {testimonial.show && (
        <section className={cn(PANEL_INSET, "mt-2 sm:mt-6")}>
          <GrowIn className={cn(PANEL, "bg-surface py-20 sm:py-28")}>
            <div className={CONTAINER}>
              <Testimonial />
            </div>
          </GrowIn>
        </section>
      )}

      {/* FAQ: the questions rise in one after another once the list is on
          screen, in time (FocusIn, landing.css). From lg up the heading
          holds on the left while the questions pass on the right, so the
          section after the centred applications heading opens its own way
          (KAN-368). */}
      <section id="faq" className="py-20 sm:py-28">
        <div
          className={cn(
            CONTAINER,
            "lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-16",
          )}
        >
          <div className="lg:sticky lg:top-32">
            <FocusIn>
              <SectionHeading
                align="left"
                className="max-lg:mx-auto max-lg:text-center"
                eyebrow="FAQ"
                title="Questions, answered."
              />
            </FocusIn>
          </div>
          <FocusIn>
            <FaqList items={faqs} className="faq-rise mt-12 lg:mt-0 lg:max-w-none" />
          </FocusIn>
        </div>
      </section>

      {/* The closing call to action, as every feature page has: without it
          the FAQ ran into the footer and the only sign-up buttons were in
          the hero and the header. On the brand's colour. */}
      <ClosingCta
        title={closing.title}
        subtitle={closing.subtitle}
        background={backdrop({
          tint: "var(--color-brand-tint)",
          glow: "var(--color-brand)",
        })}
      />
    </main>
  );
}
