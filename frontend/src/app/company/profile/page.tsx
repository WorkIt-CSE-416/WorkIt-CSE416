import type { Metadata } from "next";

import { PencilIcon, PinIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextLink } from "@/components/ui/text-link";

import { BuildingIcon } from "../icons";
import { COMPANY, OVERVIEW } from "./data";
import { ChartIcon, InfoIcon } from "./icons";

export const metadata: Metadata = {
  title: "Company Profile",
  description: "The page applicants see when they open a posting.",
};

/**
 * /company/profile — the company's public page, edited from the inside.
 *
 * This is the route that made the /company prefix necessary: the seeker shell
 * already owns /profile, and two route groups cannot both define the same path.
 * It is also why the nav row says "Company Profile" — the page is about the
 * company, not about the recruiter signed in to edit it.
 *
 * Edit Profile is inert, like the seeker profile's two edit affordances and
 * every other write on the signed-in screens. There is no backend; a control
 * that pretends to save is worse than one that visibly does not.
 *
 * No <main>: the company shell's SidebarInset is the landmark for every screen
 * under /company. See the note in ../placeholder.tsx.
 */
export default function CompanyProfilePage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-heading text-ink">Company Profile</h1>

        <Button variant="outline">
          <PencilIcon className="size-3.5" />
          Edit Profile
        </Button>
      </header>

      <Hero />

      {/* items-start so the two cards keep their own heights rather than the
          shorter one stretching to match the taller. */}
      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card as="section" padding="md" aria-labelledby="about-us">
          <SectionHeading as="h2" id="about-us" className="flex items-center gap-2">
            <InfoIcon className="text-brand size-4.5 shrink-0" />
            About Us
          </SectionHeading>

          <div className="mt-4 flex flex-col gap-3">
            {COMPANY.about.map((paragraph) => (
              <p key={paragraph} className="text-body text-ink-muted">
                {paragraph}
              </p>
            ))}
          </div>

          <hr className="border-border-subtle my-5" />

          <h3 className="text-subtitle text-ink">Our Mission</h3>

          {/* border-l-2 with border-l-brand rather than a bare border-brand:
              width and colour are separate utility groups, so a shorthand
              colour beside a one-sided width would paint all four edges and
              only the left would have a width to show it. Naming the side on
              both is what keeps the rule to one edge — the same trap ui/card.tsx
              works around for its accent. */}
          <blockquote className="border-l-brand mt-3 border-l-2 pl-4">
            <p className="text-body text-ink-muted">&ldquo;{COMPANY.mission}&rdquo;</p>
          </blockquote>
        </Card>

        <Card as="section" padding="md" aria-labelledby="overview">
          <SectionHeading as="h2" id="overview" className="flex items-center gap-2">
            <ChartIcon className="text-brand size-4.5 shrink-0" />
            Overview
          </SectionHeading>

          {/* A <dl>, because every row is a term and its value. The wrapper
              div per row is what lets each pair be one flex line: dt and dd are
              siblings under dl, so without it the rules would run between every
              element rather than between every fact. */}
          <dl className="mt-2">
            {OVERVIEW.map(({ label, value, href }) => (
              <div
                key={label}
                className="border-border-subtle flex items-baseline justify-between gap-4 border-b py-3 last:border-b-0 last:pb-0"
              >
                <dt className="text-note text-ink-meta shrink-0">{label}</dt>
                <dd className="text-label text-ink text-right font-semibold">
                  {href ? <TextLink href={href}>{value}</TextLink> : value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}

/**
 * The cover band, with the company's identity laid over its foot.
 *
 * THE COVER IS A GRADIENT, NOT A PHOTOGRAPH. The mockup shows an office shot
 * and the repo ships no image for one — the same gap ui/company-tile.tsx
 * describes for employer logos, one element larger. A flat band would read as
 * unfinished and a stock photo would be a lie about whose office it is, so the
 * space is held by something that looks deliberate and is obviously not a
 * building. It becomes a <next/image fill> over the same box the day a cover
 * upload exists; the scrim and everything above it stay exactly as they are,
 * which is the point of layering them separately.
 *
 * The scrim is not decoration either. White text over an uploaded photo is only
 * legible by luck — a bright sky behind the company name would wash it out — so
 * the dark wash under the text is what makes the contrast independent of
 * whatever gets uploaded.
 *
 * The height is a three-step ramp rather than an aspect ratio. A ratio would be
 * right if the cover were the content, but the identity laid over its foot is —
 * and on a phone a 39%-of-width band is most of the first screen, spent on
 * something nobody came to read.
 */
function Hero() {
  return (
    <div className="rounded-card border-border-subtle shadow-panel relative isolate mt-4 flex h-56 items-end overflow-hidden border sm:h-72 lg:h-80">
      <div
        aria-hidden="true"
        className="from-ink via-ink to-brand absolute inset-0 -z-10 bg-gradient-to-br"
      />
      <div
        aria-hidden="true"
        className="from-ink/90 via-ink/40 absolute inset-0 -z-10 bg-gradient-to-t to-transparent"
      />

      <div className="flex w-full items-end gap-4 p-5 sm:gap-5 sm:p-6">
        {/* tone="outline" paints the tile as a bordered white square, which is
            what the mockup draws and what keeps the mark readable against a
            cover nobody has chosen yet. */}
        <CompanyTile Icon={BuildingIcon} size="xl" tone="outline" className="shadow-panel" />

        <div className="min-w-0 flex-1 pb-1">
          <h2 className="text-display text-on-brand truncate">{COMPANY.name}</h2>

          {/* Not <Fact>: that one is text-note in ink-meta, which is a grey for
              a card. This sits on a dark cover and has to be light. */}
          <p className="text-body text-on-brand/85 mt-1 flex items-center gap-1.5">
            <PinIcon className="size-3.5 shrink-0" />
            <span className="truncate">{COMPANY.location}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
