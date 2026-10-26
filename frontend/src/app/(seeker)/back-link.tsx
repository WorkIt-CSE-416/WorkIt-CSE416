"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore, type MouseEvent } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";

import { cameFrom, openerOf, restoreScrollOn, subscribeOpener } from "./scroll-memory";

/** The seeker pages a Back link can name, by path: the sidebar's names,
 *  and the detail pages by what they show. A page not listed is never a
 *  Back link's target; the link goes to its own page's parent instead. */
const PAGES: [RegExp, string][] = [
  [/^\/dashboard$/, "Dashboard"],
  [/^\/jobs$/, "Jobs"],
  [/^\/jobs\/[^/]+$/, "Job Posting"],
  [/^\/jobs\/[^/]+\/tailor$/, "Tailor"],
  [/^\/search$/, "Search"],
  [/^\/auto-apply$/, "Auto Apply"],
  [/^\/applications$/, "Applications Tracker"],
  [/^\/applications\/[^/]+$/, "Application"],
  [/^\/calendar$/, "Calendar"],
  [/^\/resumes$/, "Resumes"],
  [/^\/resumes\/uploaded\/[^/]+$/, "Uploaded Resume"],
  [/^\/resumes\/[^/]+$/, "Resume Editor"],
  [/^\/bank$/, "Experiences"],
  [/^\/profile$/, "My Profile"],
  [/^\/settings$/, "Settings"],
  [/^\/help$/, "Help"],
];

function pageName(address: string): string | null {
  const path = address.split("?")[0];
  return PAGES.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

const noOpener = () => null;

/**
 * Where a page's Back goes: the page that opened it in this tab (the
 * scroll memory's `openerOf`), else `parent`, its place in the app, for a
 * direct visit or a reload into a new tab. When the opener is also the
 * page before this one in history (`cameFrom`), it goes back in history,
 * as the browser's Back does, so the page comes back as it was left, from
 * the router's cache and scrolled where it was; otherwise it links there,
 * and the scroll memory still scrolls it back (`restoreScrollOn`).
 *
 * Every Back named its parent page until KAN-363: an application opened from
 * the Calendar went Back to the Applications Tracker, and a resume opened
 * from Experiences went Back to Resumes. The job posting page keeps its own
 * (`BackToJobs`): the rail opens job after job, and its Back skips them to
 * the list they came from.
 */
export function useBack(parent: { href: string; name: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const opener = useSyncExternalStore(subscribeOpener, () => openerOf(pathname), noOpener);
  const name = opener ? pageName(opener) : null;
  const href = opener && name ? opener : parent.href;

  function onClick(event: MouseEvent) {
    // A modified click opens another tab; this one isn't going back.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (cameFrom() === href) {
      event.preventDefault();
      router.back();
      return;
    }
    restoreScrollOn(href);
  }

  return { href, label: `Back to ${name ?? parent.name}`, onClick };
}

/**
 * A page's Back button, drawn as every seeker Back is: a small secondary
 * button, its arrow leaning back while hovered. `named` spells out where it
 * goes ("Back to Calendar"); otherwise it reads "Back" and says where in its
 * accessible name.
 */
export function BackLink({
  parent,
  named = false,
  className = "group/back mb-3",
}: {
  parent: { href: string; name: string };
  named?: boolean;
  className?: string;
}) {
  const back = useBack(parent);
  return (
    <ButtonLink
      href={back.href}
      aria-label={named ? undefined : back.label}
      onClick={back.onClick}
      variant="secondary"
      size="sm"
      className={className}
    >
      <ArrowLeftIcon className="ease-glide size-3.5 transition-transform duration-200 group-hover/back:-translate-x-0.5" />
      {named ? back.label : "Back"}
    </ButtonLink>
  );
}
