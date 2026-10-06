import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";

import { STAGE_COLOR } from "../stage-colors";
import { APPLICATIONS, type StagedApplication } from "./data";
import { ProgressBar } from "./progress-bar";

/**
 * The applications as a grid of cards, one card per application.
 *
 * Adapted from the "Projects" mockup rather than copied from it. That mockup
 * comes from a different design language — a pure-white page, a black primary
 * button, a different accent colour per card — and dropping it in whole would
 * leave WorkIt with two visual systems on one route. What carries over is its
 * structure, which is the part actually being proposed: a tinted header block
 * naming the thing, then a body holding a date, a labelled progress row, a bar,
 * and a footer with a status pill. The mockup's footer also pairs a face with
 * the pill; that is left off, since in the seeker's own tracker the only face
 * to show is someone else's, unexplained on one card in twelve.
 *
 * The header clamps the role at two lines and always holds two lines' height,
 * so every header band in a row is the same depth and the date, bar and pill
 * below line up across the row.
 *
 * Two substitutions it does not make. Its cards show no logo; this one keeps the
 * company tile, because the tile is how an employer is identified on every other
 * WorkIt screen and the grid would be the one place it disappeared. And its pill
 * counts down weeks remaining, which only an offer has here — ungrouping the
 * board throws away the column headings, so the pill names the stage instead,
 * which is the thing the grid would otherwise stop telling you.
 */
function GridCard({ item }: { item: StagedApplication }) {
  const { Icon, stage } = item;

  return (
    <Card as="li" padding="none" className="flex flex-col overflow-hidden">
      <div className="bg-well border-border-subtle flex items-start gap-2 border-b p-3">
        <CompanyTile Icon={Icon} size="sm" tone="outline" />
        <div className="min-h-15 min-w-0 flex-1">
          <h2 className="text-subtitle text-ink line-clamp-2 leading-5">{item.role}</h2>
          <p className="text-note text-ink-meta mt-1 truncate">{item.company}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <p className="text-meta text-ink-meta truncate">{item.meta.text}</p>

        <div className="mt-2.5 flex items-baseline justify-between gap-2">
          <span className="text-note text-ink-meta">Progress</span>
          <span className="text-note text-ink font-semibold">{stage.progress}%</span>
        </div>
        <ProgressBar value={stage.progress} stage={stage.stage} className="mt-1.5" />

        {/* mt-auto rather than a fixed margin, so every footer in a row sits on
            one line even if the body above it ever differs in height. */}
        <div className="mt-auto flex items-center justify-end pt-3">
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
