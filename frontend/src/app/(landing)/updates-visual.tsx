import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import {
  CalendarCheck,
  Eye,
  Handshake,
  MessageCircle,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { updatesFeature, type RecruiterUpdate } from "./feature-data";
import { cn } from "@/lib/cn";
import { usePageHidden } from "./hooks";

/**
 * Feature carousel visual for recruiter updates: a live feed where a new update
 * slides in on top every few seconds and the rest move down. It pauses while
 * hovered, while off screen, and for visitors who prefer reduced motion.
 * Rendered by the product tour, whose MotionConfig makes transforms instant for
 * visitors who prefer reduced motion.
 */

const INTERVAL_MS = 2800;
// Updates kept in the feed; the last one is mostly faded out at the bottom.
const FEED_LENGTH = 4;
// Shown by position, newest first.
const TIMES = ["Just now", "2m", "14m", "1h"];

const kindBadge: Record<RecruiterUpdate["kind"], { icon: LucideIcon; tone: string }> = {
  viewed: { icon: Eye, tone: "bg-landing-brand-100 text-landing-brand-700" },
  screen: { icon: CalendarCheck, tone: "bg-landing-brand-100 text-landing-brand-700" },
  interview: { icon: MessagesSquare, tone: "bg-amber-100 text-amber-700" },
  message: { icon: MessageCircle, tone: "bg-landing-brand-100 text-landing-brand-700" },
  offer: { icon: Handshake, tone: "bg-emerald-100 text-emerald-700" },
};

interface FeedItem {
  key: number;
  update: RecruiterUpdate;
}

export default function UpdatesVisual() {
  const { updates } = updatesFeature;
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = React.useState(false);
  const pageHidden = usePageHidden();

  // Newest first. Updates arrive in data order, looping; `next` counts
  // arrivals and doubles as each item's key. The feed starts with the first
  // few already in, so the visible window is always consecutive arrivals (no
  // repeats while there are more updates than feed slots).
  const [feed, setFeed] = React.useState<{ items: FeedItem[]; next: number }>(() => ({
    items: updates
      .slice(0, FEED_LENGTH - 1)
      .map((update, index) => ({ key: index, update }))
      .reverse(),
    next: FEED_LENGTH - 1,
  }));

  const paused = hovered || !inView || pageHidden || Boolean(reduceMotion);

  React.useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setFeed(({ items, next }) => ({
        items: [{ key: next, update: updates[next % updates.length] }, ...items].slice(
          0,
          FEED_LENGTH,
        ),
        next: next + 1,
      }));
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paused, updates]);

  return (
    <div
      ref={ref}
      className="flex h-80 w-full max-w-sm flex-col gap-3"
      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className="text-ink-meta flex items-center justify-between px-1 text-[11px] font-medium">
        <span>Updates</span>
        <span className="flex items-center gap-1.5">
          <span className="relative flex size-2">
            {!paused && (
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
            )}
            <span
              className={cn(
                "relative size-2 rounded-full transition-colors",
                hovered ? "bg-slate-300" : "bg-emerald-500",
              )}
            />
          </span>
          {hovered ? "Paused" : "Live"}
        </span>
      </div>

      {/* Feed. It's absolutely positioned so new updates never change the
              visual's height, and opted out of scroll anchoring so the browser
              never pins the page to an update that's about to move (either
              would shift the whole page). The bottom fades out so it reads as
              a longer list. */}
      <div className="relative min-h-0 flex-1 [overflow-anchor:none]">
        <ul className="absolute inset-0 flex flex-col gap-2 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]">
          <AnimatePresence initial={false} mode="popLayout">
            {feed.items.map((item, index) => (
              <motion.li
                key={item.key}
                layout
                initial={{ opacity: 0, y: -18, scale: 0.96, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              >
                <UpdateRow update={item.update} time={TIMES[index] ?? ""} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}

function UpdateRow({ update, time }: { update: RecruiterUpdate; time: string }) {
  const Logo = update.logo;
  const { icon: KindIcon, tone } = kindBadge[update.kind];

  return (
    <div className="flex gap-3 rounded-xl bg-white/90 p-2.5 shadow-sm ring-1 ring-slate-900/5">
      <span
        className={cn(
          "relative grid size-9 shrink-0 place-items-center rounded-lg",
          update.logoTone,
        )}
      >
        <Logo className="size-4" />
        <span
          className={cn(
            "absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full ring-2 ring-white",
            tone,
          )}
        >
          <KindIcon className="size-2.5" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs/4 text-slate-700">
          <span className="text-ink font-semibold">{update.company}</span> {update.action}
        </p>
        <p className="text-ink-meta mt-0.5 truncate text-[11px]">{update.detail}</p>
      </div>
      <span className="text-ink-meta shrink-0 text-[10px]">{time}</span>
    </div>
  );
}
