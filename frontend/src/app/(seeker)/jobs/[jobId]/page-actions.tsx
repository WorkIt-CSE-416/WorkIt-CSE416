"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";

import { cameFrom, restoreScrollOn } from "../../scroll-memory";

/** The page a job's page was last opened from this session: the feed,
 *  filters and all, the Auto Apply page, the Resumes page, or Home
 *  (its Top Matches). */
const FEED_KEY = "workit:feed";
/** Where /jobs itself was last seen, for clearing a search (rememberedJobs). */
const JOBS_KEY = "workit:jobs";

/**
 * Remembers the list's URL (/jobs or /search, with its filters and query, or
 * /auto-apply, whose rows open job pages too) for the session, so a job's
 * page can go back to exactly that list; the last one visited wins. Also
 * keeps /jobs's own on its own, so clearing a search can go back to the list
 * from before it. Rendered by those pages; draws nothing. sessionStorage can
 * be off (a private window), so a failure just leaves both at plain /jobs.
 */
export function RememberFeed() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    const href = query ? `${pathname}?${query}` : pathname;
    try {
      sessionStorage.setItem(FEED_KEY, href);
      if (pathname === "/jobs") sessionStorage.setItem(JOBS_KEY, href);
    } catch {
      /* the back link falls back to /jobs */
    }
  }, [pathname, query]);
  return null;
}

/**
 * Remembers `href` as where a job's page goes Back to, from a link that
 * opens a job's page from a page that is not a list: a tailored resume's
 * card on /resumes (KAN-268), or a Top Matches row on Home
 * (KAN-342). Set on the click, not on the visit, as
 * RememberFeed does for lists: a visit to /resumes followed by a job opened
 * from elsewhere would otherwise go Back to /resumes.
 */
export function rememberReturnTo(href: string) {
  try {
    sessionStorage.setItem(FEED_KEY, href);
  } catch {
    /* the back link falls back to /jobs */
  }
}

/** /jobs as the seeker last saw it this session, filters and all; plain /jobs
 *  if they haven't been there. */
export function rememberedJobs(): string {
  try {
    const jobs = sessionStorage.getItem(JOBS_KEY);
    if (jobs && /^\/jobs(\?|$)/.test(jobs)) return jobs;
  } catch {
    /* storage off: plain /jobs */
  }
  return "/jobs";
}

/** The URL remembered this session, if it is one of those pages; /jobs
 *  otherwise. */
function rememberedFeed(): string {
  try {
    const feed = sessionStorage.getItem(FEED_KEY);
    if (feed && /^\/(jobs|search|auto-apply|resumes|home)(\?|$)/.test(feed)) return feed;
  } catch {
    /* storage off: plain /jobs */
  }
  return "/jobs";
}

const noSubscription = () => () => {};

/** "Back", to the page the seeker came from: the feed with its filters still
 *  applied, or the Auto Apply page (RememberFeed), or the Resumes page or the
 *  Home (rememberReturnTo), else /jobs, scrolled back to where they left it
 *  (restoreScrollOn, ../../scroll-memory). The server renders /jobs and the
 *  browser swaps in the remembered list after hydration (useSyncExternalStore,
 *  as PostedDate does), so the two never disagree; the label is one word for
 *  every list, so nothing visible changes in the swap. Its arrow leans back the
 *  way it goes while hovered.
 *
 *  When the seeker came straight from that list (cameFrom), it goes back in
 *  history, as the browser's Back does, rather than following the link. The
 *  router keeps the list from when they left it for that, and draws it at
 *  once; the link is a fresh visit, which asks the API for the whole feed
 *  again, and Best Match scores every job again: slow enough that
 *  the list seemed stuck on its skeleton (reported 2026-10-19). */
export function BackToJobs({ className }: { className?: string }) {
  const href = useSyncExternalStore(noSubscription, rememberedFeed, () => "/jobs");
  const router = useRouter();
  return (
    <ButtonLink
      href={href}
      onClick={(e) => {
        // A modified click opens another tab; this one isn't going back.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (cameFrom() === href) {
          e.preventDefault();
          router.back();
          return;
        }
        restoreScrollOn(href);
      }}
      variant="secondary"
      size="sm"
      className={className ?? "group/back mb-3"}
    >
      <ArrowLeftIcon className="ease-glide size-3.5 transition-transform duration-200 group-hover/back:-translate-x-0.5" />
      Back
    </ButtonLink>
  );
}

/**
 * "You applied on Oct 17, 2026" (KAN-242): the signed-in applicant's own
 * record that they applied, under the header beside "You sent …" rather than a
 * button in the row, where a misclick marked a job applied and took it off the
 * feed. Apply Now's dialog asks once the seeker leaves for the employer's
 * posting (../apply-button). The day is the viewer's own: the server renders
 * the UTC day and the browser swaps in its local one, as SentNote does.
 */
export function AppliedNote({ at }: { at: string }) {
  const day = useSyncExternalStore(
    noSubscription,
    () =>
      new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    () => formatDate(at),
  );
  return (
    <p className="text-note text-ink-meta mt-3">
      You applied on <time dateTime={at}>{day}</time>.
    </p>
  );
}
