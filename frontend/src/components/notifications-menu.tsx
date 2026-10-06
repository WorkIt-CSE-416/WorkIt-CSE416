"use client";

import type { ReactNode } from "react";

import { BellIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

/**
 * The top bar's bell, shared by both shells. Nothing feeds it yet, so it
 * opens on an empty state that says what will arrive there, rather than
 * being a control that does nothing when clicked. `children` is that line,
 * since a seeker and a company wait for different news.
 *
 * A 32px circle with a 16px glyph and the hover fill, unless the shell passes
 * its own circle: the seeker bar fills it light grey with no border, at 40px,
 * matching its phone search magnifier and the account photo. It steps out
 * below sm in both shells, where the bar's room goes to the toggle, the logo
 * and the account.
 *
 * The popup is named "Notifications" with aria-label, because Base UI names
 * it only from a Popover.Title and this one has none; without it a screen
 * reader announces a bare "dialog".
 *
 * A client component because PopoverTrigger has to clone the IconButton
 * itself. Written in a server layout, the IconButton would arrive already
 * rendered as its Tooltip, and the trigger's click and ref would land on that
 * rather than on the button, so the popover would never open.
 */
export function NotificationsMenu({
  children,
  className,
}: {
  children: ReactNode;
  /** The seeker bar draws it as a grey-filled 40px circle (see
   *  (seeker)/bar.ts);
   *  the company bar keeps the bare 32px glyph. */
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton
            label="Notifications"
            className={cn("hover:bg-hover hidden size-8 rounded-full sm:inline-flex", className)}
          >
            <BellIcon className="size-4" />
          </IconButton>
        }
      />
      <PopoverContent align="end" sideOffset={8} aria-label="Notifications" className="w-72 p-0">
        <EmptyState Icon={BellIcon} title="You're All Caught Up" className="border-0">
          {children}
        </EmptyState>
      </PopoverContent>
    </Popover>
  );
}
