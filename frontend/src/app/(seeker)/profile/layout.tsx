import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Profile",
  description: "What employers see and what WorkIt fills in for you.",
};

/**
 * Exists only to carry the tab title. The profile page is a client component,
 * and a client page cannot export metadata, so without this the tab read just
 * "WorkIt" while every sibling screen reads "Name · WorkIt".
 */
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
