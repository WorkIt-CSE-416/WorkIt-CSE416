import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";

import { STAGE_COLOR, STAGE_LABEL } from "../stage-colors";
import { nextEvent, sinceLabel, type Application } from "../tracker";
import { NextStep } from "./next-step";
import { applicationsHref, type ApplicationsQuery } from "./query";

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
 * tracker the only face to show is someone else's, unexplained on one card in
 * twelve.
 *
 * THE BODY IS THE NEXT STEP, not the mockup's labelled progress bar. Progress
 * was fixed per stage (Saved 25%, Applied 50% and so on), so the bar only
 * restated the stage pill under it, in the same colour, and gave a saved job
 * a quarter of a pipeline it has not entered. The next step is the one
 * forward-looking fact an application has, and it is the board card's own
 * block (./next-step.tsx), so the board, the grid and the list describe an
 * application the same way. Below the header the card is the board card's
 * shape too: next step, then a ruled footer of the date and a pill.
 *
 * Every card in a row is the same height, and its parts line up across the
 * row: the header clamps the role at two lines and holds two lines' height
 * once cards sit side by side (`@xl/main`; a lone card on a phone has no
 * neighbour to match, so it would only be a gap), the next step always holds
 * two lines (it says "Nothing scheduled" rather than leaving a gap), and the
 * footer sits on the card's floor.
 *
 * Two substitutions it does not make. Its cards show no logo; this one keeps the
 * company tile, because the tile is how an employer is identified on every other
 * WorkIt screen and the grid would be the one place it disappeared. And its pill
 * counts down weeks remaining, which only an offer has here. Ungrouping the
 * board throws away the column headings, so the pill names the stage instead,
 * which is the thing the grid would otherwise stop telling you.
 *
 * Like a board card, the whole card opens the application's detail panel:
 * the role is the link, stretched over the card.
 */
function GridCard({ item, href, now }: { item: Application; href: string; now: Date }) {
  const { Icon, stage } = item;

  return (
    <Card
      as="li"
      padding="none"
      className="hover:border-brand/40 relative flex flex-col overflow-hidden transition-colors"
    >
      <div className="bg-well border-border-subtle flex items-start gap-2 border-b p-3">
        <CompanyTile Icon={Icon} size="sm" tone="outline" />
        <div className="min-w-0 flex-1 @xl/main:min-h-15">
          <h2 className="text-subtitle text-ink line-clamp-2 leading-5">
            <Link
              href={href}
              scroll={false}
              className="after:rounded-card focus-visible:after:ring-brand-ring after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
            >
              {item.role}
            </Link>
          </h2>
          <p className="text-note text-ink-meta mt-1 truncate">{item.company}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <NextStep next={nextEvent(item, now)} />

        {/* mt-auto rather than a fixed margin, so every footer in a row sits on
            one line even if a label above it wraps. */}
        <div className="border-border-subtle mt-auto flex items-center justify-between gap-2 border-t pt-2.5">
          <p className="text-note text-ink-meta min-w-0 truncate">{sinceLabel(item)}</p>
          <Badge tone={STAGE_COLOR[stage].tone}>{STAGE_LABEL[stage]}</Badge>
        </div>
      </div>
    </Card>
  );
}

export function ApplicationsGrid({
  applications,
  query,
  now,
}: {
  applications: Application[];
  query: ApplicationsQuery;
  now: Date;
}) {
  return (
    <ul className="mt-4 grid gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-3 @5xl/main:grid-cols-4">
      {applications.map((item) => (
        <GridCard
          key={item.id}
          item={item}
          href={applicationsHref(query, { app: item.id })}
          now={now}
        />
      ))}
    </ul>
  );
}
