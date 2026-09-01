import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";

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
 * The middle columns drop out below `sm` and `md` rather than wrapping: a row
 * that reflows onto three lines has stopped being a row, and role, company and
 * stage are the three things a narrow screen still needs.
 */
function ListRow({ item }: { item: StagedApplication }) {
  const { Icon, stage } = item;

  return (
    <Card as="li" padding="sm" className="flex items-center gap-3">
      <CompanyTile Icon={Icon} size="sm" tone={item.tone ?? "brand"} />

      <div className="min-w-0 flex-[2]">
        <h3 className="text-subtitle text-ink truncate leading-5">{item.role}</h3>
        <p className="text-note text-ink-meta truncate">{item.company}</p>
      </div>

      <div className="hidden min-w-0 flex-1 sm:block">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-meta text-ink-meta">Progress</span>
          <span className="text-meta text-ink font-semibold">{stage.progress}%</span>
        </div>
        <ProgressBar value={stage.progress} accent={stage.accent} className="mt-1" />
      </div>

      <p className="text-meta text-ink-meta hidden w-44 shrink-0 truncate md:block">
        {item.meta.text}
      </p>

      <Badge tone={stage.accent === "positive" ? "positive" : "brand"}>{stage.title}</Badge>
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
