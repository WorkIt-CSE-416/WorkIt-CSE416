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
import { allEvents, sortKey, timelineOf } from "../tracker";
import { CalendarView } from "./calendar-view";
import { sampleWeek } from "./demo";
import { calendarHref, parseCalendarQuery } from "./query";

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
 * An entry opens its own card (./event-card.tsx), and the card's View
 * Application opens the application's detail panel, the same one
 * Applications opens, here over the calendar, with a way across to
 * Applications.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const query = parseCalendarQuery(await searchParams);
  const applications = await getApplications();
  const open = query.app ? applications.find((app) => app.id === query.app) : undefined;

  return (
    // THE PAGE IS THE SCREEN UNDER THE BAR (KAN-429), as Google Calendar's
    // is: the calendar's toolbar on top and the view taking every pixel
    // under it, so the page itself never scrolls; the Month's weeks share
    // that height and Week, Day and Agenda scroll inside their own box. A
    // window too short for that (under 32rem) lets the page scroll. The
    // visible heading and subtitle went: the toolbar's span title says
    // where you are, and they cost the grid a row.
    <div
      className={cn(
        "max-w-dashboard mx-auto flex h-[calc(100svh-4rem)] min-h-[32rem] w-full flex-col py-4",
        SEEKER_GUTTER,
      )}
    >
      <h1 className="sr-only">Calendar</h1>

      <CalendarView
        applications={applications.map(({ id, role, company, logoUrl, stage, appliedOn }) => ({
          id,
          role,
          company,
          logoUrl,
          stage,
          appliedOn,
        }))}
        events={
          // The sample week, in local development only (./demo.ts).
          query.demo && process.env.NODE_ENV === "development"
            ? [...allEvents(applications), ...sampleWeek(applications, getNow())].sort(
                (a, b) => sortKey(a.at) - sortKey(b.at),
              )
            : allEvents(applications)
        }
      />

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
          closeHref={calendarHref({ view: query.view, date: query.date, demo: query.demo })}
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
