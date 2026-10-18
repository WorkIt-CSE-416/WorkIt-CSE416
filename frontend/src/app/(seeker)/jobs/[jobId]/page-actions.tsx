"use client";

import { Flag, Link2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { ArrowLeftIcon, EllipsisIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { formatDate } from "@/lib/format-date";

import { restoreScrollOn } from "../../scroll-memory";

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

/**
 * The header's "…" menu (KAN-250): the job's less used actions, so the row
 * keeps only what a seeker acts on (Save, Ask Scout, Auto Apply, Tailor My
 * Resume, Apply Now). Eight buttons in one row pushed into the company line,
 * cut off the posted date and squeezed the title to a word a line (KAN-246).
 *
 * Copy Link copies this page's link, and a note under the trigger says so for
 * a moment: the menu has closed by then, so it cannot say it itself. The note
 * floats rather than sitting in the row, which shifted every button after it
 * for two seconds. A
 * clipboard the browser refuses (an insecure origin, a denied permission) says
 * that instead. Report is still inert, as it was as its own button.
 */
export function MoreActions({ title }: { title: string }) {
  const [said, setSaid] = useState<"Link copied" | "Couldn't copy the link" | null>(null);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), 2000);
    return () => clearTimeout(timer);
  }, [said]);

  return (
    <span className="relative flex shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              label={`More actions for ${title}`}
              tooltip="More actions"
              variant="outline"
              className="size-9 shrink-0"
            >
              <EllipsisIcon className="size-4" />
            </IconButton>
          }
        />
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem
            onClick={() =>
              // Inside a promise, so a missing clipboard (an http address on a
              // phone, where navigator.clipboard is undefined) lands in the catch.
              Promise.resolve()
                .then(() => navigator.clipboard.writeText(window.location.href))
                .then(() => setSaid("Link copied"))
                .catch(() => setSaid("Couldn't copy the link"))
            }
          >
            <Link2 className="text-ink-meta size-4" />
            Copy Link
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Flag className="text-ink-meta size-4" />
            Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span
        role="status"
        className="text-note text-ink-meta pointer-events-none absolute top-full left-0 mt-1 whitespace-nowrap"
      >
        {said}
      </span>
    </span>
  );
}

/**
 * "You applied on Oct 17, 2026" (KAN-242): the signed-in applicant's own
 * record that they applied, under the header beside "You sent …" rather than a
 * button in the row, where a misclick marked a job applied and took it off the
 * feed. Apply Now's dialog asks once the seeker leaves for the employer's
 * posting (./apply-button). The day is the viewer's own: the server renders
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
