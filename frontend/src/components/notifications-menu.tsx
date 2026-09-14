"use client";

import Link from "next/link";

import { BellIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

/**
 * The bell's dropdown — updates for either audience, applicant-side or
 * business-side, rendered from the same shape.
 *
 * `items` is a prop for the same reason it is on @/components/account-menu:
 * each shell points it at its own fixture (company/notifications-data.ts,
 * (seeker)/notifications-data.ts) today, and at its own endpoint once the
 * backend has one. Nothing in this file assumes which.
 *
 * `href` is optional because not every notification names a screen to land
 * on — a plain status update has nowhere to go, and forcing a link would mean
 * inventing one. Present, it renders the row as a Link the way
 * @/components/account-menu's rows do; absent, the row is inert but still
 * reachable by keyboard, which a real backend's "mark as read" can hang off
 * of later.
 */
export type Notification = {
  id: string;
  title: string;
  body: string;
  /** Already display-ready ("2h ago") — there is no clock to format against
   *  yet, and a live feed can hand over pre-formatted text as easily as a raw
   *  timestamp. */
  time: string;
  href?: string;
  unread?: boolean;
};

type NotificationsMenuProps = { items: readonly Notification[] };

export function NotificationsMenu({ items }: NotificationsMenuProps) {
  const hasUnread = items.some((item) => item.unread);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton label="Notifications" className="relative">
            <BellIcon className="size-5" />
            {hasUnread && (
              <span
                aria-hidden="true"
                className="bg-brand border-panel absolute top-0.5 right-0.5 size-2 rounded-full border"
              />
            )}
          </IconButton>
        }
      />

      <DropdownMenuContent align="end" sideOffset={8} className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>

          {items.length === 0 ? (
            <p className="text-ink-meta px-1.5 py-3 text-sm">You&apos;re all caught up.</p>
          ) : (
            items.map(({ id, title, body, time, href, unread }) => (
              <DropdownMenuItem
                key={id}
                render={href ? <Link href={href} /> : undefined}
                className="items-start gap-2 py-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    unread ? "bg-brand" : "bg-transparent",
                  )}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-ink truncate font-medium">{title}</span>
                    <span className="text-ink-faint shrink-0 text-xs">{time}</span>
                  </span>
                  <span className="text-ink-meta line-clamp-2 text-sm">{body}</span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
