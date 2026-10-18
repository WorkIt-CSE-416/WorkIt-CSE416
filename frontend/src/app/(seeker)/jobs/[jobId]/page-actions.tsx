"use client";

import { Share2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

import { restoreScrollOn } from "../../scroll-memory";
import { markApplied } from "../actions";

/** The list a job's page was last opened from this session: the feed, filters
 *  and all, or the Auto Apply page. */
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

/** The list URL remembered this session, if it is one; /jobs otherwise. */
function rememberedFeed(): string {
  try {
    const feed = sessionStorage.getItem(FEED_KEY);
    if (feed && /^\/(jobs|search|auto-apply)(\?|$)/.test(feed)) return feed;
  } catch {
    /* storage off: plain /jobs */
  }
  return "/jobs";
}

const noSubscription = () => () => {};

/** "Back", to the list the seeker came from: the feed with its filters still
 *  applied, or the Auto Apply page (RememberFeed), else /jobs, scrolled back to where they left it
 *  (restoreScrollOn, ../../scroll-memory). The server renders /jobs and the
 *  browser swaps in the remembered list after hydration (useSyncExternalStore,
 *  as PostedDate does), so the two never disagree; the label is one word for
 *  every list, so nothing visible changes in the swap. Its arrow leans back the
 *  way it goes while hovered. */
export function BackToJobs({ className }: { className?: string }) {
  const href = useSyncExternalStore(noSubscription, rememberedFeed, () => "/jobs");
  return (
    <ButtonLink
      href={href}
      onClick={(e) => {
        // A modified click opens another tab; this one isn't going back.
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) restoreScrollOn(href);
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

/** Share: copies this page's link, and says so in its tooltip for a moment.
 *  A clipboard the browser refuses (an insecure origin, a denied
 *  permission) says that instead. */
export function ShareButton({ title }: { title: string }) {
  const [said, setSaid] = useState<"Link copied" | "Couldn't copy the link" | null>(null);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), 2000);
    return () => clearTimeout(timer);
  }, [said]);
  return (
    <IconButton
      label={`Copy a link to ${title}`}
      tooltip={said ?? "Copy link"}
      variant="outline"
      className="size-9 shrink-0"
      onClick={() =>
        // Inside a promise, so a missing clipboard (an http address on a
        // phone, where navigator.clipboard is undefined) lands in the catch.
        Promise.resolve()
          .then(() => navigator.clipboard.writeText(window.location.href))
          .then(() => setSaid("Link copied"))
          .catch(() => setSaid("Couldn't copy the link"))
      }
    >
      <Share2 className="size-4" />
    </IconButton>
  );
}

/** "10/15/2026" for a saved instant. */
const DAY: Intl.DateTimeFormatOptions = { month: "2-digit", day: "2-digit", year: "numeric" };

/** "Applied at 10/15/2026", on the viewer's own calendar. The server (UTC)
 *  prints its UTC day and the browser swaps in its own after hydration, as
 *  ClosesOn does (frontend/CLAUDE.md on timestamps). */
function AppliedOn({ iso }: { iso: string }) {
  const day = useSyncExternalStore(
    noSubscription,
    () => new Date(iso).toLocaleDateString("en-US", DAY),
    () => new Date(iso).toLocaleDateString("en-US", { ...DAY, timeZone: "UTC" }),
  );
  return <p className="text-label text-ink-meta shrink-0 whitespace-nowrap">Applied at {day}</p>;
}

/** Applied: marks this job as applied for the signed-in applicant (KAN-232),
 *  which takes it off their Jobs page, search and matches. Once marked it is
 *  the date instead, and stays so: there is no undo yet. A failure keeps the
 *  button and says why beside it. */
export function AppliedButton({
  jobId,
  appliedAt: saved,
}: {
  jobId: string;
  appliedAt: string | null;
}) {
  const [appliedAt, setAppliedAt] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (appliedAt) return <AppliedOn iso={appliedAt} />;
  return (
    <>
      {error && (
        <p role="alert" className="text-note text-ink-meta">
          {error}
        </p>
      )}
      <Button
        variant="secondary"
        size="lg"
        className="shrink-0"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markApplied(jobId);
            setError(result.error);
            if (result.appliedAt) setAppliedAt(result.appliedAt);
          })
        }
      >
        Applied
      </Button>
    </>
  );
}
