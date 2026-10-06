import { cn } from "@/lib/cn";

import { DayLink, When } from "../local-time";
import { KIND_STAGE, STAGE_COLOR, STAGE_ICON } from "../stage-colors";
import type { UpNextItem } from "./data";
import { SectionHeader } from "./section-header";

/**
 * The rest of what needs the seeker next — the top item is the violet card
 * above (./next-up-hero.tsx). The seeker's version of the company dashboard's
 * "Needs your attention", and the same shape: the commitment first, whose it
 * is second, when last.
 *
 * Open on the page, not in a card: a short list of rows with round glyphs
 * reads as a list without a box around it, and the page has the hero to
 * carry its colour.
 *
 * EACH ROW WEARS ITS STAGE, from ../stage-colors.ts: the same fill and the
 * same white glyph as that stage's board column header.
 * A kind wears one stage (KIND_STAGE in ../stage-colors.ts), so an interview
 * is Interviewing's amber calendar, an offer is Offer's green award, a closing
 * application is a saved job (grey bookmark) and a follow-up is Applied's
 * violet briefcase. The detail panel's timeline uses the same map. Its own tones here once painted an interview
 * violet and a deadline in Interviewing's amber, contradicting the board. Not danger red for a deadline: red means rejected.
 */
export function UpNext({ items }: { items: UpNextItem[] }) {
  return (
    <section aria-labelledby="up-next" className="@container/upnext">
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
        {items.map((item) => {
          const key = KIND_STAGE[item.kind];
          const Icon = STAGE_ICON[key];

          return (
            <li
              key={item.id}
              className="border-border-subtle relative flex items-center gap-3 border-b py-3 last:border-b-0"
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-white",
                  STAGE_COLOR[key].fill,
                )}
              >
                <Icon className="size-4" />
              </span>
              {/* The date sits at the row's end once the list itself is wide
                  enough (@md/upnext, 448px of list) and drops under the role
                  below that. Keyed to the list, not the page: in the 2fr
                  column a page-wide breakpoint put the date beside a role and
                  company cut to "TechNova I…". */}
              <div className="min-w-0 flex-1 @md/upnext:flex @md/upnext:items-center @md/upnext:gap-3">
                <div className="min-w-0 @md/upnext:flex-1">
                  {/* The row opens its day in the Calendar's Agenda: the title
                      is the link, stretched over the row. */}
                  <DayLink
                    at={item.at}
                    view="agenda"
                    className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {item.title}
                  </DayLink>
                  <p className="text-note text-ink-meta truncate">
                    {item.role} · {item.company}
                  </p>
                </div>
                <p className="text-note text-ink-muted mt-0.5 @md/upnext:mt-0 @md/upnext:shrink-0 @md/upnext:text-right">
                  <When at={item.at} />
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
