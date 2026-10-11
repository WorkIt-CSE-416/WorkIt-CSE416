import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

import { DayLink, When } from "../local-time";
import { KIND_STAGE, STAGE_COLOR, STAGE_ICON } from "../stage-colors";
import type { UpNextItem } from "./data";
import { SectionHeader } from "./section-header";
import { SectionCard } from "./section-card";

/**
 * The rest of what needs the seeker next — the top item is the Next Up tile
 * beside it (./next-up-hero.tsx). The seeker's version of the company dashboard's
 * "Needs your attention", and the same shape: the commitment first, whose it
 * is second, when last.
 *
 * A tile like every Dashboard section (./section-card.tsx), down the
 * Dashboard's right-hand column.
 *
 * EACH ROW WEARS ITS STAGE, from ../stage-colors.ts: the same fill and the
 * same white glyph as that stage's board column header.
 * A kind wears one stage (KIND_STAGE in ../stage-colors.ts), so an interview
 * is Interviewing's amber calendar, an offer is Offer's green award, a closing
 * application is a saved job (grey bookmark) and a follow-up is Applied's
 * violet briefcase. The detail panel's timeline uses the same map. Its own tones here once painted an interview
 * violet and a deadline in Interviewing's amber, contradicting the board. Not danger red for a deadline: red means rejected.
 */
export function UpNext({ items, className }: { items: UpNextItem[]; className?: string }) {
  return (
    <SectionCard aria-labelledby="up-next" className={cn("@container/upnext", className)}>
      <SectionHeader
        id="up-next"
        title="Up Next"
        link={{
          href: "/calendar?view=agenda",
          text: "View All",
          label: "View All in the Calendar Agenda",
        }}
      />

      <ul className="mt-3 flex flex-col">
        {items.map((item, i) => {
          const key = KIND_STAGE[item.kind];
          const Icon = STAGE_ICON[key];

          return (
            <li
              key={item.id}
              // The rows rise in one after another as the page arrives.
              style={{ animationDelay: `${i * 40}ms` }}
              className="group/up-next border-border-subtle animate-rise relative flex items-center gap-3 border-b py-3 last:border-b-0"
            >
              <span
                className={cn(
                  // The disc swells a touch when its row is pointed at, and
                  // presses in with it.
                  "ease-glide flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-transform duration-200 group-hover/up-next:scale-105 group-active/up-next:scale-95",
                  STAGE_COLOR[key].fill,
                )}
              >
                <Icon className="size-4" />
              </span>
              {/* The date sits at the row's end once the list itself is wide
                  enough (@md/upnext, 448px of list) and drops under the role
                  below that. Keyed to the list, not the page: in a narrow
                  column a page-wide breakpoint put the date beside a role and
                  company cut to "TechNova I…". */}
              <div className="min-w-0 flex-1 @md/upnext:flex @md/upnext:items-center @md/upnext:gap-3">
                <div className="min-w-0 @md/upnext:flex-1">
                  {/* The row opens its day in the Calendar's Agenda: the title
                      is the link, stretched over the row. */}
                  <DayLink
                    at={item.at}
                    view="agenda"
                    className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {item.title}
                  </DayLink>
                  {/* Two lines in a narrow column rather than an ellipsis
                      ("Design Systems Lead · Ve…"); one beside the date. */}
                  <p className="text-note text-ink-meta line-clamp-2 @md/upnext:line-clamp-1">
                    {item.role} · {item.company}
                  </p>
                </div>
                {/* The date in a pill: as plain grey text it was the
                    faintest thing on the row and the one a seeker looks for. */}
                <div className="mt-1.5 @md/upnext:mt-0 @md/upnext:shrink-0">
                  <Badge variant="tag" pill>
                    <When at={item.at} />
                  </Badge>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
