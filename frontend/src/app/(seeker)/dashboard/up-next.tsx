import type { ComponentType } from "react";

import { AwardIcon, CalendarIcon, MailIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

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
 * pipeline band to carry its colour. Each kind wears its own tone so the list
 * sorts itself at a glance: an interview or an offer is someone waiting on
 * you (brand, positive), a closing application is a clock (warning), a
 * follow-up is a nudge (quiet).
 */
const KIND: Record<UpNextKind, { Icon: ComponentType<{ className?: string }>; tone: string }> = {
  interview: { Icon: CalendarIcon, tone: "bg-brand-tint text-brand" },
  offer: { Icon: AwardIcon, tone: "bg-positive-tint text-positive-ink" },
  deadline: { Icon: CalendarIcon, tone: "bg-warning-tint text-warning" },
  "follow-up": { Icon: MailIcon, tone: "bg-hover text-ink-meta" },
};

export function UpNext({ items }: { items: UpNextItem[] }) {
  return (
    <section aria-labelledby="up-next">
      <SectionHeader
        id="up-next"
        title="Up next"
        link={{ href: "/applications", text: "View all", label: "View all applications" }}
      />

      <ul className="mt-3 flex flex-col">
        {items.map((item) => {
          const { Icon, tone } = KIND[item.kind];

          return (
            <li
              key={`${item.company}-${item.title}`}
              className="border-border-subtle flex items-center gap-3 border-b py-3 last:border-b-0"
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full",
                  tone,
                )}
              >
                <Icon className="size-4" />
              </span>
              {/* The date sits at the row's end once the page is wide enough
                  (@xl/main, 576px of page) and drops under the role below
                  that, where sharing a line squeezed the title to three
                  letters and an ellipsis. */}
              <div className="min-w-0 flex-1 @xl/main:flex @xl/main:items-center @xl/main:gap-3">
                <div className="min-w-0 @xl/main:flex-1">
                  <p className="text-label text-ink truncate font-semibold">{item.title}</p>
                  <p className="text-note text-ink-meta truncate">
                    {item.role} · {item.company}
                  </p>
                </div>
                <p className="text-note text-ink-muted mt-0.5 @xl/main:mt-0 @xl/main:shrink-0 @xl/main:text-right">
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
