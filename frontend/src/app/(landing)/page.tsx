import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";
import { signInWithOAuth, type OAuthProvider } from "@/lib/oauth-actions";

import ApplicationBoard from "./application-board";
import { faqs, hero, hiringSystemsSection, journeySection, site, testimonial } from "./data";
import { HeroCity } from "./hero-city";
import { HiringSystems } from "./hiring-systems";
import { Journey } from "./journey";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "./layout-parts";
import { ProductTour } from "./product-tour";
import { StageTimeline } from "./stage-timeline";

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
            <h1
              data-hero-text
              className="hero-rise from-ink to-landing-brand-800 mx-auto max-w-5xl bg-linear-to-b from-40% bg-clip-text text-[2.75rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-transparent sm:text-6xl lg:text-7xl"
              style={{ "--rd": ".08s" } as CSSProperties}
            >
              {hero.titleLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p
              data-hero-text
              className="hero-rise text-ink-muted mx-auto mt-[22px] max-w-[640px] text-lg leading-[1.55] text-pretty sm:text-[19px]"
              style={{ "--rd": ".16s" } as CSSProperties}
            >
              {hero.subtitle}
            </p>
            <div
              data-hero-box
              className="hero-rise mt-[34px] flex flex-col items-center justify-center gap-3 sm:flex-row"
              style={{ "--rd": ".24s" } as CSSProperties}
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

      {/* Pinned product tour: the four features, one stop each. */}
      <div className="mt-2 sm:mt-4">
        <ProductTour />
      </div>

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

      {/* Hiring systems, in a rounded panel. */}
      <section className={PANEL_INSET}>
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
          <div className="divide-border border-border mx-auto mt-12 max-w-3xl divide-y border-y">
            {faqs.map((item) => (
              // A shared name, so opening one question closes the others.
              <details key={item.question} name="faq" className="group py-5">
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
        </div>
      </section>
    </main>
  );
}

/**
 * "Sign up with Google / LinkedIn", following Google's sign-in branding
 * guidelines (light theme): white fill, 1px #747775 inside stroke, #1F1F1F
 * Google Sans Medium 14/20 text, standard full-colour logos (never
 * recoloured). LinkedIn uses the same treatment so the pair matches. Each
 * posts to the same OAuth action as the buttons on /signup.
 * https://developers.google.com/identity/branding-guidelines
 */
function SocialSignUpButton({ provider }: { provider: OAuthProvider }) {
  const google = provider === "google";
  return (
    <form action={signInWithOAuth.bind(null, provider)} className="w-full max-w-72 sm:w-auto">
      <button
        type="submit"
        className="font-google inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-full bg-white px-3 text-sm/5 font-medium whitespace-nowrap text-[#1F1F1F] ring-1 ring-[#747775] transition-shadow ring-inset hover:shadow-md"
      >
        {google ? (
          <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
            <path
              fill="#0A66C2"
              d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
            />
          </svg>
        )}
        <span>{google ? "Sign up with Google" : "Sign up with LinkedIn"}</span>
      </button>
    </form>
  );
}
