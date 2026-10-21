"use server";

import type { NotificationItem } from "@/components/notifications-menu";
import { applicantCall } from "@/lib/applicant-call";

type DigestJob = { job_id: string; title: string; company: string; match: number };

type NotificationResponse = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: DigestJob[];
  read_at: string | null;
  created_at: string;
};

type NotificationList = { notifications: NotificationResponse[]; unread_count: number };

/** One row's link. A job_alert digest is several jobs, not one, so the row
 *  points at the Jobs page's own Best Match sort rather than guessing which
 *  job the student meant to click — the same sort the digest itself scored
 *  by. Any other future notification type falls back to the Jobs page too,
 *  until it has a real destination of its own. */
function hrefFor(notification: NotificationResponse): string {
  if (notification.type === "job_alert") return "/jobs?sort=match";
  return "/jobs";
}

/** The bell's data: its rows, newest first, and the unread badge's count.
 *  A failed read shows the bell's existing empty state rather than an
 *  error — notifications are not worth a broken bar over. */
export async function getNotifications(): Promise<{
  items: NotificationItem[];
  unreadCount: number;
}> {
  const { data } = await applicantCall<NotificationList>("/notifications?limit=20");
  if (!data) return { items: [], unreadCount: 0 };
  return {
    items: data.notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      href: hrefFor(n),
      unread: n.read_at === null,
      createdAt: n.created_at,
    })),
    unreadCount: data.unread_count,
  };
}

/** Marks every unread notification read — the bell's own "You're All
 *  Caught Up" copy already treats opening it as being caught up. */
export async function markNotificationsRead(): Promise<void> {
  await applicantCall<NotificationList>("/notifications/read", { method: "POST" });
}
