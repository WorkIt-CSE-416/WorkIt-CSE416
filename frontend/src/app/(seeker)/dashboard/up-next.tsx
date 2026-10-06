import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_ICON, type StageKey } from "../stage-colors";
import type { UpNextItem, UpNextKind } from "./data";
import { SectionHeader } from "./section-header";

/**
 * The rest of what needs the seeker next — the top item is the violet card
 * above (./next-up-hero.tsx). The seeker's version of the company dashboard's
 * "Needs your attention", and the same shape: the commitment first, whose it
 * is second, when last.
 *
 * Open on the page, not in a card: a short list of rows with round glyphs
 * reads as a list without a box around it, and the page has the hero and the
 * pipeline band to carry its colour.
 *
 * EACH ROW WEARS ITS STAGE, from ../stage-colors.ts: the same fill and the
 * same white glyph as that stage's pipeline badge below and its board column.
 * A kind is the board column its card sits in (data.ts, KIND_BY_COLUMN), so
 * an interview is Interviewing's amber calendar, an offer is Offer's green
 * award, a closing application is a saved job (grey bookmark) and a follow-up
 * is Applied's violet briefcase. Its own tones here once painted an interview
 * violet and a deadline in Interviewing's amber, contradicting the legend a
 * screen below. Not danger red for a deadline: red means rejected.
 */
const STAGE_BY_KIND: Record<UpNextKind, StageKey> = {
  interview: "interviewing",
  offer: "offer",
  deadline: "saved",
  "follow-up": "applied",
};

export function UpNext({ items }: { items: UpNextItem[] }) {
  return (
    <section aria-labelledby="up-next" className="@container/upnext">
      <SectionHeader
        id="up-next"
        title="Up Next"
        link={{ href: "/applications", text: "View All", label: "View All Applications" }}
      />

      <ul className="mt-3 flex flex-col">
        {items.map((item) => {
          const key = STAGE_BY_KIND[item.kind];
          const Icon = STAGE_ICON[key];

          return (
            <li
              key={`${item.company}-${item.title}`}
              className="border-border-subtle flex items-center gap-3 border-b py-3 last:border-b-0"
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
                  <p className="text-label text-ink truncate font-semibold">{item.title}</p>
                  <p className="text-note text-ink-meta truncate">
                    {item.role} · {item.company}
                  </p>
                </div>
                <p className="text-note text-ink-muted mt-0.5 @md/upnext:mt-0 @md/upnext:shrink-0 @md/upnext:text-right">
                  {item.when}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
