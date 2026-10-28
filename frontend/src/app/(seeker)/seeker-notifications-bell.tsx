"use client";

import { useEffect, useState } from "react";

import { NotificationsMenu, type NotificationItem } from "@/components/notifications-menu";
import { getNotifications, markNotificationsRead } from "@/lib/notification-actions";

/**
 * The seeker bar's bell, fed for the first time (KAN-298) — the one caller
 * of NotificationsMenu's items/unreadCount/onOpenChange props; the company
 * bar still renders the shared component bare, so its own "nothing feeds it
 * yet" behavior is untouched.
 *
 * Fetched on mount, not lazily on first open: the unread badge has to show
 * without the student opening the bell first, or it could never earn the
 * click that would reveal it. Opening the popover marks everything read —
 * the bell's own copy already treats that as "caught up" — and the badge
 * clears optimistically rather than waiting on the round trip.
 */
export function SeekerNotificationsBell({ className }: { className?: string }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getNotifications().then(({ items, unreadCount }) => {
      if (!cancelled) {
        setItems(items);
        setUnreadCount(unreadCount);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleOpenChange(open: boolean) {
    if (!open || unreadCount === 0) return;
    setUnreadCount(0);
    setItems((current) => current.map((item) => ({ ...item, unread: false })));
    markNotificationsRead();
  }

  return (
    <NotificationsMenu
      className={className}
      items={items}
      unreadCount={unreadCount}
      onOpenChange={handleOpenChange}
    >
      New matches and replies from employers will show up here.
    </NotificationsMenu>
  );
}
