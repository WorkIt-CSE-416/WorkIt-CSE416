"use client";

import { Share2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

import { restoreScrollOn } from "../../scroll-memory";

/** Where the feed was last seen this session, filters and all. */
const FEED_KEY = "workit:feed";

/**
 * Remembers the feed's URL (/jobs or /search, with its filters and query) for
 * the session, so a job's page can go back to exactly that list. Rendered by
 * the feed pages; draws nothing. sessionStorage can be off (a private
 * window), so a failure just leaves "Back to Jobs" at plain /jobs.
 */
export function RememberFeed() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    try {
      sessionStorage.setItem(FEED_KEY, query ? `${pathname}?${query}` : pathname);
    } catch {
      /* the back link falls back to /jobs */
    }
  }, [pathname, query]);
  return null;
}

/** The feed URL remembered this session, if it is one; /jobs otherwise. */
function rememberedFeed(): string {
  try {
    const feed = sessionStorage.getItem(FEED_KEY);
    if (feed && /^\/(jobs|search)(\?|$)/.test(feed)) return feed;
  } catch {
    /* storage off: plain /jobs */
  }
  return "/jobs";
}

const noSubscription = () => () => {};

/** "Back to Jobs", to the feed the seeker came from with its filters still
 *  applied (RememberFeed), else /jobs, scrolled back to where they left it
 *  (restoreScrollOn, ../../scroll-memory). The server renders /jobs and the
 *  browser swaps in the remembered list after hydration (useSyncExternalStore,
 *  as PostedDate does), so the two never disagree. Its arrow leans back the
 *  way it goes while hovered. */
export function BackToJobs({ className }: { className?: string }) {
  const href = useSyncExternalStore(noSubscription, rememberedFeed, () => "/jobs");
  return (
    <ButtonLink
      href={href}
      onClick={() => restoreScrollOn(href)}
      variant="secondary"
      size="sm"
      className={className ?? "group/back mb-3"}
    >
      <ArrowLeftIcon className="ease-glide size-3.5 transition-transform duration-200 group-hover/back:-translate-x-0.5" />
      Back to Jobs
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
      className="size-8 shrink-0"
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
