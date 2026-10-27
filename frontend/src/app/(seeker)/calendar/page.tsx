import type { Metadata } from "next";
import Link from "next/link";

import { ArrowRightIcon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { ApplicationTile } from "../applications/application-tile";
import { getApplications, getNow } from "../applications/data";
import { DetailPanel } from "../applications/detail-panel";
import { applicationHref } from "../applications/query";
import { SEEKER_GUTTER } from "../gutter";
import { allEvents, timelineOf } from "../tracker";
import { CalendarView } from "./calendar-view";
import { calendarHref, parseCalendarQuery } from "./query";
import { CalendarViewSwitch } from "./view-switch";

export const metadata: Metadata = {
  title: "Calendar",
  description: "Every date in your search, from the day you applied to the offer deadline.",
};

/**
 * /calendar — every dated thing in the seeker's search on one calendar: the
 * day each application went in, every interview, offers and their deadlines,
 * closing dates and follow-ups, each in its kind's stage colour.
 *
 * Month, Week or Agenda, picked like Home's range
 * (ui/segmented-control.tsx), and anchored with ?date= (./query.ts). The views
 * render in the browser (./calendar-view.tsx) and read the view and the day
 * from the URL themselves, so changing either moves the URL in place and
 * never comes back here; this page passes them every entry from the tracker
 * (../applications/data.ts) and draws the parts that need no zone.
 *
 * An entry opens its application's detail panel, the same one Applications
 * opens, here over the calendar, with a way across to Applications.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const query = parseCalendarQuery(await searchParams);
  const applications = await getApplications();
  const open = query.app ? applications.find((app) => app.id === query.app) : undefined;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* The view switch stays top right wherever the title can keep 300px
          beside it (512px of content), the subtitle wrapping before the
          switch moves; narrower, it sits under the title. */}
      <div className="flex flex-col items-start gap-4 @[36rem]/main:flex-row @[36rem]/main:justify-between">
        <div className="min-w-0">
          <h1 className="text-heading text-ink">Calendar</h1>
          <p className="text-body text-ink-meta mt-1">
            Every date in your search, from the day you applied to the offer deadline.
          </p>
        </div>

        <CalendarViewSwitch />
      </div>

      <CalendarView events={allEvents(applications)} />

      {open && (
        <DetailPanel
          application={{
            id: open.id,
            role: open.role,
            company: open.company,
            stage: open.stage,
            status: open.status,
            match: open.match,
          }}
          tile={<ApplicationTile application={open} size="md" />}
          steps={timelineOf(open, getNow())}
          closeHref={calendarHref({ view: query.view, date: query.date })}
          footer={
            <Link
              href={applicationHref(open.id)}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Open in Applications Tracker
              <ArrowRightIcon className="size-3.5" />
            </Link>
          }
        />
      )}
    </div>
  );
}
