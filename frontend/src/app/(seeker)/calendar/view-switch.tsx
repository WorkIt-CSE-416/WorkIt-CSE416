"use client";

import { useShallowParams } from "@/components/shallow-routing";
import { SegmentedLinks } from "@/components/ui/segmented-control";

import { CALENDAR_VIEWS, calendarHref, parseCalendarQuery, VIEW_LABEL } from "./query";

/**
 * The Calendar's choices as the page is showing them. The view switch, the
 * arrows, Today and a day's number all move the query in place
 * (components/shallow-routing.tsx), and the views redraw from it without
 * asking the server, which renders nothing that depends on them.
 */
export function useCalendarQuery() {
  return parseCalendarQuery(Object.fromEntries(useShallowParams()));
}

/**
 * Month, Week or Agenda on the shared segmented control, keeping the day in
 * view. In place (`shallow`), so the new view draws with the thumb.
 */
export function CalendarViewSwitch() {
  const { view, date } = useCalendarQuery();

  return (
    <SegmentedLinks
      shallow
      label="Calendar View"
      value={view}
      options={CALENDAR_VIEWS.map((option) => ({
        value: option,
        label: VIEW_LABEL[option],
        href: calendarHref({ view: option, date }),
      }))}
    />
  );
}
