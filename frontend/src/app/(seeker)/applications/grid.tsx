import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { STAGE_COLOR, STAGE_LABEL } from "../stage-colors";
import { LocalDate } from "../local-time";
import { sinceOf, type Application } from "../tracker";
import { ApplicationTile } from "./application-tile";
import { MatchBadge } from "@/components/match-badge";
import { applicationHref } from "./query";
import { Reflow } from "@/components/reflow";
import { ViewResumeButton } from "./view-resume";

/**
 * The applications as a grid of cards, one card per application.
 *
 * Adapted from the "Projects" mockup rather than copied from it. That mockup
 * comes from a different design language — a pure-white page, a black primary
 * button, a different accent colour per card — and dropping it in whole would
 * leave WorkIt with two visual systems on one route. What carries over is its
 * structure: a tinted header block naming the thing, a body, and a ruled
 * footer pairing a date with a status pill. The mockup's footer pairs a face
 * with the pill; the date takes that slot here, since in the seeker's own
 * tracker the only face to show is someone else's, unexplained on most
 * cards.
 *
 * NO BODY, only the board card's four facts (KAN-256): the header names the
 * role and company, and a footer gives the day it was saved or sent, the
 * stage and the Jobs page's match score. The mockup's progress bar went
 * first (fixed per stage, it only restated the stage pill), then the next
 * step, which said "Nothing scheduled" on every live card.
 *
 * Every card in a row is the same height, and its parts line up across the
 * row: the header clamps the role at two lines and holds two lines' height
 * once cards sit side by side (`@xl/main`; a lone card on a phone has no
 * neighbour to match, so it would only be a gap), and the footer sits on the
 * card's floor.
 *
 * Two substitutions it does not make. Its cards show no logo; this one keeps the
 * company tile, because the tile is how an employer is identified on every other
 * WorkIt screen and the grid would be the one place it disappeared. And its pill
 * counts down weeks remaining, which only an offer has here. Ungrouping the
 * board throws away the column headings, so the pill names the stage instead,
 * which is the thing the grid would otherwise stop telling you.
 *
 * Like a board card, the whole card opens the application's own page (./[jobId]):
 * the role is the link, stretched over the card. A card with a sent resume
 * adds View Resume above the footer, on a strip that sits over the link.
 */
function GridCard({ item, href, delay }: { item: Application; href: string; delay: number }) {
  const { stage } = item;
  const since = sinceOf(item);

  return (
    <Card
      as="li"
      padding="none"
      // Rises in after the cards before it and lifts under the pointer, as
      // a board card does.
      className="hover:border-brand/40 hover:shadow-lift ease-glide animate-rise relative flex flex-col overflow-hidden transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="bg-well border-border-subtle flex items-start gap-2 border-b p-3">
        <ApplicationTile application={item} size="sm" />
        <div className="min-w-0 flex-1 @xl/main:min-h-15">
          <h2 className="text-subtitle text-ink line-clamp-2 leading-5">
            <Link
              href={href}
              className="after:rounded-card focus-visible:after:ring-brand-ring after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
            >
              {item.role}
            </Link>
          </h2>
          <p className="text-note text-ink-meta mt-1 truncate">{item.company}</p>
        </div>
      </div>

      {/* View Resume (KAN-267) on a strip of its own, above the role's
          stretched link (relative, z-10): a click anywhere on the strip,
          the gap around the button too, stays off the link, so a near miss
          never opens the application. */}
      {item.sentResume && (
        <div className="relative z-10 px-3 pt-3">
          <ViewResumeButton resume={item.sentResume} className="w-full" />
        </div>
      )}

      {/* mt-auto, so every footer in a row sits on the card's floor even
          when a role above it wraps. */}
      <div className="mt-auto flex items-center gap-2 p-3">
        <p className="text-note text-ink-meta min-w-0 flex-1 truncate">
          {since.verb} <LocalDate at={since.at} />
        </p>
        <Badge tone={STAGE_COLOR[stage].tone}>{STAGE_LABEL[stage]}</Badge>
        {item.match != null && <MatchBadge score={item.match} />}
      </div>
    </Card>
  );
}

export function ApplicationsGrid({ applications }: { applications: Application[] }) {
  return (
    <ul className="mt-4 grid gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-3 @5xl/main:grid-cols-4">
      {applications.map((item, i) => (
        <Reflow key={item.id}>
          <GridCard
            item={item}
            href={applicationHref(item.id)}
            // 30ms apart, capped at the eighth card so a long grid never waits.
            delay={Math.min(i, 8) * 30}
          />
        </Reflow>
      ))}
    </ul>
  );
}
