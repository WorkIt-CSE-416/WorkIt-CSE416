"use client";

import type { ReactNode } from "react";

import { BellIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
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
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <IconButton
            label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            className={cn(
              "group/bell hover:bg-hover relative hidden size-8 rounded-full sm:inline-flex",
              className,
            )}
          >
            {/* Swings on its hook once as the pointer arrives. */}
            <BellIcon className="group-hover/bell:animate-swing size-4 origin-[50%_15%]" />
            {unreadCount > 0 && (
              <span
                aria-hidden
                className="bg-brand ring-surface absolute top-1 right-1 size-2 rounded-full ring-2"
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
                <a
                  href={item.href}
                  className={cn(
                    "hover:bg-hover flex flex-col gap-0.5 px-3 py-2.5 no-underline",
                    item.unread && "bg-brand/5",
                  )}
                >
                  <span className="text-label text-ink font-medium">{item.title}</span>
                  <span className="text-meta text-ink-muted">{item.body}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
