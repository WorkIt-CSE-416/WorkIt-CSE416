"use client";

import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { BellIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

/** One row the bell can show — kept generic (never ATS- or job-alert-
 *  specific) so a company's own future notification type fits the same
 *  shape. `href` is the whole row's link, since every notification this
 *  feature has today points somewhere. */
export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  href: string;
  unread: boolean;
  createdAt: string;
};

/**
 * The top bar's bell, shared by both shells. The company shell still
 * passes nothing but `children` (the empty-state line) — nothing feeds its
 * bell yet, so it behaves exactly as before. The seeker shell
 * ((seeker)/seeker-notifications-bell.tsx) is the one caller that passes
 * `items`/`unreadCount`/`onOpenChange` (KAN-298), fetched there rather
 * than in this shared component, which stays presentational.
 *
 * A 32px circle with a 16px glyph and the hover fill, unless the shell passes
 * its own circle: the seeker bar fills it light grey with no border, at 40px,
 * matching its phone search magnifier and the account photo. It shows at
 * every width in both shells (KAN-570): hidden below sm, a phone could never
 * read a notification, so the seeker's phone bar dropped its logo mark for
 * the room instead.
 *
 * The popup is named "Notifications" with aria-label, because Base UI names
 * it only from a Popover.Title and this one has none; without it a screen
 * reader announces a bare "dialog".
 *
 * Each item is a `Link` with IconButton's focus ring (inset, since the list
 * clips what reaches past it) and its time ("5 minutes ago") beside the
 * title. It was a plain `<a>` with no ring and no time, so a keyboard user
 * could not see which item was focused and a click loaded the whole app
 * again. The popover is held open here so a click on an item can close it:
 * a client navigation leaves the bar, and the popover with it, in place.
 * The time is worked out in render, which is safe because the seeker bell
 * fetches its items in an effect, after hydration.
 *
 * A client component because PopoverTrigger has to clone the IconButton
 * itself. Written in a server layout, the IconButton would arrive already
 * rendered as its Tooltip, and the trigger's click and ref would land on that
 * rather than on the button, so the popover would never open.
 */
export function NotificationsMenu({
  children,
  className,
  items = [],
  unreadCount = 0,
  onOpenChange,
}: {
  children: ReactNode;
  /** The seeker bar draws it as a grey-filled 40px circle (see
   *  (seeker)/bar.ts);
   *  the company bar keeps the bare 32px glyph. */
  className?: string;
  items?: NotificationItem[];
  unreadCount?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  function changeOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <IconButton
            label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            className={cn("group/bell hover:bg-hover relative size-8 rounded-full", className)}
          >
            {/* Swings on its hook once as the pointer arrives. 24px, the sidebar
                icons' size: with no circle round it, 16px read as too small. */}
            <BellIcon className="group-hover/bell:animate-swing size-6 origin-[50%_15%]" />
            {unreadCount > 0 && (
              <span
                aria-hidden
                className="bg-brand ring-surface absolute top-1.5 right-1.5 size-2 rounded-full ring-2"
              />
            )}
          </IconButton>
        }
      />
      <PopoverContent align="end" sideOffset={8} aria-label="Notifications" className="w-72 p-0">
        {items.length === 0 ? (
          <EmptyState Icon={BellIcon} title="You're All Caught Up" className="border-0">
            {children}
          </EmptyState>
        ) : (
          <ul className="divide-border-subtle max-h-80 divide-y overflow-y-auto py-1">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => changeOpen(false)}
                  className={cn(
                    "hover:bg-hover focus-visible:ring-brand-ring flex flex-col gap-0.5 px-3 py-2.5 no-underline transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                    item.unread && "bg-brand/5",
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-label text-ink font-medium">{item.title}</span>
                    <Badge variant="tag" tone="inert">
                      {formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}
                    </Badge>
                  </span>
                  <span className="text-note text-ink-muted">{item.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
