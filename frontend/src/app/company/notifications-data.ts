import type { Notification } from "@/components/notifications-menu";

/** What the company shell's bell shows. Fixtures — one file to swap for real data. */
export const NOTIFICATIONS: Notification[] = [
  {
    id: "1",
    title: "New applicant: Senior Frontend Engineer",
    body: "Priya Sharma applied 3 minutes ago — 94% match.",
    time: "3m ago",
    href: "/company/applicants",
    unread: true,
  },
  {
    id: "2",
    title: "Feedback overdue",
    body: "Marcus Lee has been in Interview for 9 days with no notes logged.",
    time: "1h ago",
    href: "/company/applicants",
    unread: true,
  },
  {
    id: "3",
    title: "Offer accepted",
    body: "Dana Okafor accepted the offer for Product Designer.",
    time: "Yesterday",
    href: "/company/applicants",
  },
];
