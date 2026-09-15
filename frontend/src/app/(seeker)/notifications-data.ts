import type { Notification } from "@/components/notifications-menu";

/** What the seeker shell's bell shows. Fixtures — one file to swap for real data. */
export const NOTIFICATIONS: Notification[] = [
  {
    id: "1",
    title: "Application viewed",
    body: "Northwind opened your application for Senior Frontend Engineer.",
    time: "2h ago",
    href: "/applications",
    unread: true,
  },
  {
    id: "2",
    title: "Interview scheduled",
    body: "Acme Robotics booked a call for Wednesday at 2:00 PM.",
    time: "5h ago",
    href: "/applications",
    unread: true,
  },
  {
    id: "3",
    title: "New match",
    body: "A Product Designer role at Fenwick Labs matches your profile.",
    time: "Yesterday",
    href: "/jobs",
  },
];
