"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { BAR_TITLE } from "./bar";

/** Each section's title, the first match of a page's path. A nested path sits
 *  before its parent. A new seeker section joins this list. */
const TITLES = [
  ["/jobs", "Jobs"],
  ["/auto-apply/answers", "Written Answers"],
  ["/auto-apply/info", "Application Info"],
  ["/auto-apply", "Auto Apply"],
  ["/applications", "Applications Tracker"],
  ["/resumes", "Resumes"],
  ["/experiences", "Experiences"],
  ["/calendar", "Calendar"],
  ["/profile", "My Profile"],
  ["/inbox", "Inbox"],
  ["/help", "Help"],
  ["/settings", "Settings"],
] as const;

/**
 * The page's title in the top bar (2026-11-02), with no line under it: each
 * page had its own heading and description, about 60px on every screen.
 *
 * Read from the address, not sent up by the page, so the title is there before
 * the page streams in and stays put while a job's page swaps beside the rail.
 *
 * It is the page's h1 on a section's own page. A page under it (a job, a
 * resume, an application) has its own h1, and here the section's name is a
 * plain line. Settings is a modal with its own title, so it is a plain line
 * too. `home` is Home's greeting, which the layout reads on the server.
 */
export function BarTitle({ home }: { home: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/home") return home;
  if (pathname === "/search") {
    return (
      <Suspense fallback={<h1 className={BAR_TITLE}>Search Jobs</h1>}>
        <SearchTitle />
      </Suspense>
    );
  }

  const found = TITLES.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  if (!found) return null;
  const [path, title] = found;
  const Tag = pathname === path && path !== "/settings" ? "h1" : "p";
  return <Tag className={BAR_TITLE}>{title}</Tag>;
}

/** Apart from the rest because useSearchParams suspends on a prerendered route
 *  (./search/query-field.tsx). */
function SearchTitle() {
  const query = useSearchParams().get("q")?.trim();
  const title = query ? `Results for “${query}”` : "Search Jobs";
  return (
    <h1 title={title} className={BAR_TITLE}>
      {title}
    </h1>
  );
}
