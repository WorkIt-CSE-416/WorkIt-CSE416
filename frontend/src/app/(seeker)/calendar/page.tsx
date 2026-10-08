import type { Metadata } from "next";
import Link from "next/link";

import { ArrowRightIcon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { CompanyTile } from "@/components/ui/company-tile";
import { SegmentedLinks } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";

import { getApplications, getNow } from "../applications/data";
import { DetailPanel } from "../applications/detail-panel";
import { SEEKER_GUTTER } from "../gutter";
import { allEvents, timelineOf } from "../tracker";
import { CalendarView } from "./calendar-view";
import { CALENDAR_VIEWS, calendarHref, parseCalendarQuery, VIEW_LABEL } from "./query";

export const metadata: Metadata = {
  title: "Calendar",
  description: "Every date in your search, from the day you applied to the offer deadline.",
};

/**
 * /calendar — every dated thing in the seeker's search on one calendar: the
 * day each application went in, every interview, offers and their deadlines,
 * closing dates and follow-ups, each in its kind's stage colour.
 *
 * Month, Week or Agenda, picked like the Dashboard's range
 * (ui/segmented-control.tsx), and anchored with ?date= (./query.ts). The views render in the
 * browser (./calendar-view.tsx); this page passes them every entry from the
 * tracker fixture and draws the parts that need no zone.
 *
 * An entry opens its application's detail panel, the same one Applications
 * opens, here over the calendar, with a way across to Applications.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const query = parseCalendarQuery(await searchParams);
  const applications = getApplications();
  const open = query.app ? applications.find((app) => app.id === query.app) : undefined;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-heading text-ink">Calendar</h1>
          <p className="text-body text-ink-meta mt-1">
            Every date in your search, from the day you applied to the offer deadline.
          </p>
        </div>

        <SegmentedLinks
          label="Calendar View"
          value={query.view}
          options={CALENDAR_VIEWS.map((view) => ({
            value: view,
            label: VIEW_LABEL[view],
            href: calendarHref({ view, date: query.date }),
          }))}
        />
      </div>

      <CalendarView view={query.view} date={query.date} events={allEvents(applications)} />

      {open && (
        <DetailPanel
          application={{
            id: open.id,
            role: open.role,
            company: open.company,
            stage: open.stage,
            status: open.status,
            summary: open.summary,
            match: open.match,
          }}
          tile={<CompanyTile Icon={open.Icon} size="md" tone="outline" />}
          steps={timelineOf(open, getNow())}
          closeHref={calendarHref({ view: query.view, date: query.date })}
          footer={
            <Link
              href={`/applications?app=${open.id}`}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Open in Applications
              <ArrowRightIcon className="size-3.5" />
            </Link>
          }
        />
      )}
    </div>
  );
}
