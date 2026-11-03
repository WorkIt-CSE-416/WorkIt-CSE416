"use client";

import { usePathname } from "next/navigation";

import { BAR_TITLE } from "../(seeker)/bar";

/** Each section's title, the first match of a page's path. A nested path sits
 *  before its parent, and the Overview last, since every path starts with it.
 *  A new company section joins this list. */
const TITLES = [
  ["/company/jobs/new", "Post a Job"],
  ["/company/jobs", "Job Postings"],
  ["/company/applicants", "Applicants"],
  ["/company/profile", "Company Profile"],
  ["/company/settings", "Settings"],
  ["/company", "Hiring Overview"],
] as const;

/**
 * The page's title in the company bar, as the seeker bar has it
 * ((seeker)/bar-title.tsx, 2026-11-02): pages draw no heading or description
 * of their own under the bar (`docs/design.md`, The two shells).
 *
 * Read from the address, so it shows before the page streams in. It is the
 * page's h1 on a section's own page; a page under it (a job, the editor, an
 * applicant) has its own h1, and here the section's name is a plain line.
 */
export function CompanyBarTitle() {
  const pathname = usePathname();

  const found = TITLES.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  if (!found) return null;
  const [path, title] = found;
  const Tag = pathname === path ? "h1" : "p";
  return <Tag className={BAR_TITLE}>{title}</Tag>;
}
