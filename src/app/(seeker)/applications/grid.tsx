import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";

import { Avatar } from "@/components/avatar";
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
 * and a footer pairing a face with a status pill.
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
        <CompanyTile Icon={Icon} size="sm" tone={item.tone ?? "brand"} />
        <div className="min-w-0 flex-1">
          <h3 className="text-subtitle text-ink leading-5">{item.role}</h3>
          <p className="text-note text-ink-meta mt-0.5">{item.company}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <p className="text-meta text-ink-meta truncate">{item.meta.text}</p>

        <div className="mt-2.5 flex items-baseline justify-between gap-2">
          <span className="text-note text-ink-meta">Progress</span>
          <span className="text-note text-ink font-semibold">{stage.progress}%</span>
        </div>
        <ProgressBar value={stage.progress} accent={stage.accent} className="mt-1.5" />

        {/* mt-auto rather than a fixed margin: some titles wrap to two lines and
            some do not, and this keeps every footer in a row on one line. */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {item.owner ? (
            <Avatar name={item.owner} className="size-6 text-[0.625rem]" />
          ) : (
            <span aria-hidden="true" />
          )}
          <Badge tone={stage.accent === "positive" ? "positive" : "brand"}>{stage.title}</Badge>
        </div>
      </div>
    </Card>
  );
}

export function ApplicationsGrid() {
  return (
    <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {APPLICATIONS.map((item) => (
        <GridCard key={`${item.company}-${item.role}`} item={item} />
      ))}
    </ul>
  );
}
