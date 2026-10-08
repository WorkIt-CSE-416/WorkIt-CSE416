import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";

import { STAGE_COLOR } from "../stage-colors";
import { APPLICATIONS, type StagedApplication } from "./data";
import { NextStep } from "./next-step";

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
 */
function GridCard({ item }: { item: StagedApplication }) {
  const { Icon, stage } = item;

  return (
    <Card as="li" padding="none" className="flex flex-col overflow-hidden">
      <div className="bg-well border-border-subtle flex items-start gap-2 border-b p-3">
        <CompanyTile Icon={Icon} size="sm" tone="outline" />
        <div className="min-w-0 flex-1 @xl/main:min-h-15">
          <h2 className="text-subtitle text-ink line-clamp-2 leading-5">{item.role}</h2>
          <p className="text-note text-ink-meta mt-1 truncate">{item.company}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <NextStep next={item.next} />

        {/* mt-auto rather than a fixed margin, so every footer in a row sits on
            one line even if a label above it wraps. */}
        <div className="border-border-subtle mt-auto flex items-center justify-between gap-2 border-t pt-2.5">
          <p className="text-note text-ink-meta min-w-0 truncate">{item.meta.text}</p>
          <Badge tone={STAGE_COLOR[stage.stage].tone}>{stage.title}</Badge>
        </div>
      </div>
    </Card>
  );
}

export function ApplicationsGrid() {
  return (
    <ul className="mt-4 grid gap-4 @xl/main:grid-cols-2 @3xl/main:grid-cols-3 @5xl/main:grid-cols-4">
      {APPLICATIONS.map((item) => (
        <GridCard key={`${item.company}-${item.role}`} item={item} />
      ))}
    </ul>
  );
}
