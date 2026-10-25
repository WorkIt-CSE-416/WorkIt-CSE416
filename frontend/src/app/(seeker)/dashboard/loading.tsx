import { DashboardFrame, HeadingSkeleton } from "./frame";
import { HeadlineSkeleton } from "./headline";
import { StreakSkeleton } from "./streak";
import { TopMatchesSkeleton } from "./top-matches";

/**
 * The Dashboard while it loads (KAN-368): its own frame (./frame.tsx) with
 * the skeletons the page streams behind, so the page that replaces it moves
 * nothing. The greeting is a bar until the account arrives; everything else
 * is the page's own fallback.
 *
 * WHY A loading.tsx, AND WHY HERE. Every seeker route is dynamic (the shell
 * calls connection()), and Next prefetches a dynamic route only down to its
 * first loading boundary: with none, a sidebar click sent a request and
 * changed nothing on screen until the page's reads were done. With this
 * one, the router holds this state from the prefetch and draws it in the
 * click's next frame. It is worth it only where a page waits on slow reads:
 * React keeps a fallback it has shown for at least 300ms, so on a page that
 * draws in 150ms a skeleton only makes it slower (no loading.tsx on the
 * Experiences, Resumes, My Profile, Help or Search pages for that reason).
 *
 * The page-enter motion ((seeker)/template.tsx) now plays on this skeleton,
 * and the page then replaces it without a transition of its own.
 */
export default function DashboardLoading() {
  return (
    <DashboardFrame
      heading={<HeadingSkeleton />}
      tiles={<HeadlineSkeleton />}
      topMatches={<TopMatchesSkeleton className="mt-4" />}
      activity={<StreakSkeleton className="mt-4" />}
    />
  );
}
