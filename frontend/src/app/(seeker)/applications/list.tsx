import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";

import { STAGE_COLOR } from "../stage-colors";
import { APPLICATIONS, type StagedApplication } from "./data";
import { ProgressBar } from "./progress-bar";

/**
 * The applications as rows.
 *
 * NO MOCKUP EXISTS FOR THIS VIEW. The switcher in the grid mockup offers grid
 * and list, so shipping the switcher without a list would leave a third of it
 * dead. Rather than invent a layout, this row carries exactly the fields the
 * grid card carries, in the order the grid stacks them, using the row shape the
 * search results already established. Treat it as a placeholder holding the
 * right data, not as a design.
 *
 * The middle columns drop out below `@xl/main` and `@3xl/main` (the page's
 * own width, not the window's) rather than wrapping: a row that reflows onto
 * three lines has stopped being a row, and role, company and stage are the
 * three things a narrow screen still needs. The stage badge sits in a fixed
 * 96px slot, wide enough for Interviewing, so the progress and date columns
 * start at the same x on every row instead of stepping with the badge.
 */
function ListRow({ item }: { item: StagedApplication }) {
  const { Icon, stage } = item;

  return (
    <Card as="li" padding="sm" className="flex items-center gap-3">
      <CompanyTile Icon={Icon} size="sm" tone="outline" />

      <div className="min-w-0 flex-[2]">
        <h2 className="text-subtitle text-ink truncate leading-5">{item.role}</h2>
        <p className="text-note text-ink-meta truncate">{item.company}</p>
      </div>

      <div className="hidden min-w-0 flex-1 @xl/main:block">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-meta text-ink-meta">Progress</span>
          <span className="text-meta text-ink font-semibold">{stage.progress}%</span>
        </div>
        <ProgressBar value={stage.progress} stage={stage.stage} className="mt-1" />
      </div>

      <p className="text-meta text-ink-meta hidden w-44 shrink-0 truncate @3xl/main:block">
        {item.meta.text}
      </p>

      <span className="flex w-24 shrink-0 justify-end">
        <Badge tone={STAGE_COLOR[stage.stage].tone}>{stage.title}</Badge>
      </span>
    </Card>
  );
}

export function ApplicationsList() {
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {APPLICATIONS.map((item) => (
        <ListRow key={`${item.company}-${item.role}`} item={item} />
      ))}
    </ul>
  );
}
