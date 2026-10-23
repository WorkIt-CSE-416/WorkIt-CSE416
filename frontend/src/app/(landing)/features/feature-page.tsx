import { CheckIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";

import { cn } from "@/lib/cn";

import { ClosingCta } from "../closing-cta";
import { FaqList } from "../faq-list";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "../layout-parts";
import { SocialSignUpButton } from "../social-sign-up";
import { backdrop, featurePages, type Feature } from "./catalog";
import { featureContent } from "./content";
import { FeatureIcon } from "./feature-icon";
import { FeatureMotion, FeatureStage } from "./feature-stage";
import type { FeatureSection } from "./types";

/**
 * The one template every feature page draws with, from its entry in
 * catalog.ts (name, icon, colour) and its own file in content/ (the copy
 * and visuals). Top to bottom: the hero and the feature's animation from
 * the home tour, the deep dives, How it works, the other feature pages,
 * the FAQ and a closing call to action. Every visual sits on the feature's
 * own ground, the tour's backdrop in its colour.
 */
export function FeaturePage({ feature }: { feature: Feature }) {
  const content = featureContent[feature.slug];
  const ground = backdrop(feature);
  const Animation = content.animation;
  const steps = content.howItWorks.steps;

  return (
    <FeatureMotion>
      <main id="main" className="flex-1">
        <section className={PANEL_INSET}>
          <div className={cn(PANEL, "overflow-hidden")} style={{ background: ground }}>
            <div className={cn(CONTAINER, "pt-16 text-center sm:pt-20 lg:pt-24")}>
              <p className="glass-card text-ink inline-flex items-center gap-2 rounded-full py-1 pr-3.5 pl-1 text-sm font-medium">
                <FeatureIcon feature={feature} className="rounded-full" />
                {feature.name}
              </p>
              <h1 className="text-ink mx-auto mt-6 max-w-3xl text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
                {content.hero.title}
              </h1>
              <p className="text-ink-muted mx-auto mt-5 max-w-2xl text-lg leading-[1.55] text-pretty">
                {content.hero.subtitle}
              </p>
              <SignUpButtons className="mt-8" />
            </div>

            <div className="mx-auto mt-10 max-w-5xl px-2 pb-2 sm:mt-14 sm:px-6 sm:pb-6">
              <div className="rounded-[1.5rem] bg-white/30 ring-1 ring-white/60 lg:rounded-[2rem]">
                {Animation ? (
                  <FeatureStage>
                    <Animation />
                  </FeatureStage>
                ) : (
                  <Placeholder feature={feature} className="h-[20rem] sm:h-[28rem]" />
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className={cn(CONTAINER, "grid gap-20 sm:gap-28")}>
            {content.sections.map((section, i) => (
              <DeepDive
                key={section.title}
                section={section}
                feature={feature}
                ground={ground}
                flip={i % 2 === 1}
              />
            ))}
          </div>
        </section>

        <section className={PANEL_INSET}>
          <div className={cn(PANEL, "bg-surface py-20 sm:py-28")}>
            <div className={CONTAINER}>
              <SectionHeading eyebrow="How it works" title={content.howItWorks.title} />
              <ol
                className={cn(
                  "mt-12 grid gap-3 sm:mt-16 sm:grid-cols-2",
                  steps.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
                )}
              >
                {steps.map((step, i) => (
                  <li key={step.title} className="rounded-2xl bg-white p-6 ring-1 ring-slate-900/5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 items-center justify-center rounded-full text-sm font-semibold text-white tabular-nums"
                      style={{ background: feature.glow }}
                    >
                      {i + 1}
                    </span>
                    <h3 className="text-ink mt-5 text-lg font-semibold">{step.title}</h3>
                    <p className="text-ink-meta mt-1.5 text-sm/6">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className={CONTAINER}>
            <SectionHeading eyebrow="More from WorkIt" title="One app for the whole search" />
            <ul className="mt-12 grid gap-3 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
              {featurePages
                .filter((page) => page.slug !== feature.slug)
                .map((page) => (
                  <li key={page.slug}>
                    <Link
                      href={page.href}
                      className="group ease-glide hover:shadow-lift flex h-full flex-col rounded-2xl bg-white p-6 ring-1 ring-slate-900/5 transition-[translate,box-shadow] duration-200 hover:-translate-y-0.5 active:translate-y-0"
                    >
                      <FeatureIcon feature={page} size="md" />
                      <h3 className="text-ink mt-4 font-semibold">{page.name}</h3>
                      <p className="text-ink-meta mt-1 text-sm/6">
                        {featureContent[page.slug].line}
                      </p>
                      <span className="text-ink mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-medium">
                        Learn more
                        <span
                          aria-hidden="true"
                          className="transition-transform duration-200 group-hover:translate-x-0.5"
                        >
                          →
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        </section>

        <section className="pb-20 sm:pb-28">
          <div className={CONTAINER}>
            <SectionHeading eyebrow="FAQ" title="Questions, answered." />
            <FaqList items={content.faqs} className="mt-12" />
          </div>
        </section>

        <ClosingCta title={content.cta.title} subtitle={content.cta.subtitle} background={ground} />
      </main>
    </FeatureMotion>
  );
}

/** A deep dive: the text on one side, the visual slot on the other. */
function DeepDive({
  section,
  feature,
  ground,
  flip,
}: {
  section: FeatureSection;
  feature: Feature;
  ground: string;
  flip: boolean;
}) {
  const Visual = section.visual;
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
      <div className={cn(flip && "lg:order-last")}>
        <SectionHeading
          align="left"
          eyebrow={section.eyebrow}
          title={section.title}
          subtitle={section.body}
        />
        {section.points && (
          <ul className="mt-6 grid gap-3">
            {section.points.map((point) => (
              <li key={point} className="text-ink-muted flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ background: feature.glow }}
                >
                  <CheckIcon aria-hidden className="size-3" weight="bold" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[2rem] p-6"
        style={{ background: ground }}
      >
        {Visual ? <Visual /> : <Placeholder feature={feature} />}
      </div>
    </div>
  );
}

/** Stands in for a visual not drawn yet: the feature's icon on a glass
 *  tile, over the feature's ground. */
function Placeholder({ feature, className }: { feature: Feature; className?: string }) {
  const { icon: Icon, glow } = feature;
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <span
        aria-hidden="true"
        className="glass-card flex size-24 items-center justify-center rounded-3xl"
        style={{ color: glow }}
      >
        <Icon aria-hidden className="size-10" />
      </span>
    </div>
  );
}

/** The hero's sign-up pair, the same as the home page's. */
function SignUpButtons({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 sm:flex-row", className)}>
      <SocialSignUpButton provider="google" />
      <SocialSignUpButton provider="linkedin_oidc" />
    </div>
  );
}
