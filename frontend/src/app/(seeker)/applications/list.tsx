import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";

import { STAGE_COLOR } from "../stage-colors";
import { APPLICATIONS, type StagedApplication } from "./data";
import { NextStep } from "./next-step";

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
 * The next step is the board and grid's own block (./next-step.tsx), held to
 * one line each for the label and the date so a long one cannot make its row
 * taller than the rest. The date beside it is the same 12px grey as the
 * next step's date, so the two read as one kind of text.
 *
 * Only the role flexes. The next step (192px, room for the longest label
 * with the glyph), the date (128px) and the stage badge (96px, wide enough
 * for Interviewing) are fixed slots, so every column starts at the same x on
 * every row, and a narrow page takes its width from the role rather than
 * cutting the next step to "Next: Appli…" as a shared flex ratio did.
 *
 * The middle columns drop out below `@2xl/main` and `@4xl/main` (the page's
 * own width, not the window's) rather than wrapping: a row that reflows onto
 * three lines has stopped being a row, and role, company and stage are the
 * three things a narrow screen still needs. Of the two, the next step stays
 * longer, since it is the one thing on the row still to happen.
 */
function ListRow({ item }: { item: StagedApplication }) {
  const { Icon, stage } = item;

  return (
    <Card as="li" padding="sm" className="flex items-center gap-3">
      <CompanyTile Icon={Icon} size="sm" tone="outline" />

      <div className="min-w-0 flex-1">
        <h2 className="text-subtitle text-ink truncate leading-5">{item.role}</h2>
        <p className="text-note text-ink-meta truncate">{item.company}</p>
      </div>

      <NextStep next={item.next} truncate className="hidden w-48 shrink-0 @2xl/main:flex" />

      <p className="text-note text-ink-meta hidden w-32 shrink-0 truncate @4xl/main:block">
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
