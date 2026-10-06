"use client";

import type { ReactNode } from "react";

import { BellIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";

/**
 * The top bar's bell, shared by both shells. Nothing feeds it yet, so it
 * opens on an empty state that says what will arrive there, rather than
 * being a control that does nothing when clicked. `children` is that line,
 * since a seeker and a company wait for different news.
 *
 * A 32px circle with a 16px glyph and the hover fill the avatar's pill uses
 * from xl, the same as the seeker's phone search magnifier. It steps out
 * below sm in both shells, where the avatar's menu is the one control in the
 * cluster a phone cannot do without.
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
export function NotificationsMenu({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton
            label="Notifications"
            className="hover:bg-hover hidden size-8 rounded-full sm:inline-flex"
          >
            <BellIcon className="size-4" />
          </IconButton>
        }
      />
      <PopoverContent align="end" sideOffset={8} aria-label="Notifications" className="w-72 p-0">
        <EmptyState Icon={BellIcon} title="You're all caught up" className="border-0">
          {children}
        </EmptyState>
      </PopoverContent>
    </Popover>
  );
}
