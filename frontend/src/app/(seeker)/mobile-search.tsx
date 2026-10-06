"use client";

import Form from "next/form";
import { useState } from "react";

import { SearchIcon } from "@/components/icons";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/shadcn/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";

/**
 * Job search on a phone. Below md the bar is the toggle, the logo and the
 * account, with no room for the 320px field, so a magnifier stands in for it
 * before the bell and drops the same field down from the top in a sheet. The
 * form is the bar's own: a GET to /search with the query as ?q.
 *
 * A 32px circle with a 16px glyph and the bell's hover fill, so the two read
 * as one pair beside the avatar.
 *
 * The sheet is controlled so a search closes it. next/form navigates on the
 * client and this shell stays mounted across the move, so an uncontrolled
 * sheet would sit open over the results. Cancel is the visible way out on a
 * phone, where there is no Escape key; shadcn's corner close is turned off
 * because it would sit on top of the field.
 *
 * A client component because the sheet keeps open state, and because
 * SheetTrigger has to clone the IconButton itself: rendered from a server
 * file, the IconButton would arrive already rendered as its Tooltip, and the
 * trigger's handlers would land on that instead of the button.
 */
export function MobileSearch() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <IconButton label="Search jobs" className="hover:bg-hover size-8 rounded-full md:hidden">
            <SearchIcon className="size-4" />
          </IconButton>
        }
      />
      <SheetContent side="top" showCloseButton={false} className="flex-row items-center gap-2 p-4">
        <SheetTitle className="sr-only">Search jobs</SheetTitle>
        <Form
          action="/search"
          role="search"
          onSubmit={() => setOpen(false)}
          className="min-w-0 flex-1"
        >
          <SearchField
            id="job-search-mobile"
            label="Search jobs"
            name="q"
            placeholder="Search jobs"
            enterKeyHint="search"
            autoFocus
          />
        </Form>
        <SheetClose
          render={
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          }
        />
      </SheetContent>
    </Sheet>
  );
}
