import Link from "next/link";
import type { ComponentType } from "react";

import { ArrowRightIcon, AwardIcon, CalendarIcon, MailIcon } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { UP_NEXT, type UpNextKind } from "./data";

/**
 * What needs the seeker next — the Dashboard's lead card, because "what do I
 * do today" is worth more to a student than any total. The seeker's version
 * of the company dashboard's "Needs your attention", and the same shape: one
 * row a commitment, the commitment first, whose it is second, when last.
 *
 * Each kind wears its own tone so the list sorts itself at a glance: an
 * interview or an offer is someone waiting on you (brand, positive), a
 * closing application is a clock (warning), a follow-up is a nudge (quiet).
 */
const KIND: Record<UpNextKind, { Icon: ComponentType<{ className?: string }>; tile: string }> = {
  interview: { Icon: CalendarIcon, tile: "bg-brand-tint text-brand" },
  offer: { Icon: AwardIcon, tile: "bg-positive-tint text-positive-ink" },
  deadline: { Icon: CalendarIcon, tile: "bg-warning-tint text-warning" },
  "follow-up": { Icon: MailIcon, tile: "bg-hover text-ink-meta" },
};

export function UpNext() {
  return (
    <Card padding="md" className="flex flex-col">
      <SectionHeading
        as="h2"
        action={
          <Link
            href="/applications"
            className="text-label text-brand-ink focus-visible:ring-brand-ring inline-flex items-center gap-1 rounded-xs hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            All applications
            <ArrowRightIcon className="size-3.5" />
          </Link>
        }
      >
        Up next
      </SectionHeading>
      <p className="text-note text-ink-meta mt-1">
        Interviews, offers and deadlines, soonest first.
      </p>

      <ul className="mt-4 flex flex-1 flex-col gap-2">
        {UP_NEXT.map((item) => {
          const { Icon, tile } = KIND[item.kind];

          return (
            <li
              key={`${item.company}-${item.title}`}
              className="border-border-subtle rounded-control flex items-center gap-3 border p-3"
            >
              <span
                className={cn(
                  "rounded-control flex size-9 shrink-0 items-center justify-center",
                  tile,
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
                  <p className="text-label text-ink truncate">{item.title}</p>
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
    </Card>
  );
}
