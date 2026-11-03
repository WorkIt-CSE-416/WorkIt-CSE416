"use client";

import { format, parseISO } from "date-fns";

import { ShallowLink } from "@/components/shallow-routing";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/shadcn/sheet";
import { buttonClasses } from "@/components/ui/button";

import type { TrackerEvent } from "../tracker";
import { AgendaEntry } from "./agenda";

/**
 * A day's entries in a sheet from the screen's foot (KAN-578), opened by a
 * tap on a day of the narrow Month (./month.tsx). There a day has room for
 * coloured dots only, so the colour was the only thing a student could
 * read, and a screen reader heard a count. The sheet lists each entry as
 * the Agenda does (its time, its kind's glyph, its title and company), and
 * each opens its event card. Open Week goes on to the days around it.
 */
export function DaySheet({
  day,
  open,
  onOpenChange,
  entries,
  openHref,
  weekHref,
}: {
  /** The day shown, "YYYY-MM-DD". Kept after a close, so the sheet keeps
   *  its words while it slides away. */
  day: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: TrackerEvent[];
  openHref: (applicationId: string) => string;
  weekHref: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-shell max-h-[80svh] gap-0">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-subtitle text-ink font-semibold">
            {format(parseISO(day), "EEEE, MMMM d")}
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4">
          {entries.length ? (
            <ul className="flex flex-col gap-1.5">
              {entries.map((event) => (
                <li key={event.id}>
                  <AgendaEntry event={event} openHref={openHref} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-ink-meta">Nothing on this day.</p>
          )}
        </div>
        <div className="flex justify-end p-4">
          <ShallowLink
            href={weekHref}
            onClick={() => onOpenChange(false)}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Open Week
          </ShallowLink>
        </div>
      </SheetContent>
    </Sheet>
  );
}
