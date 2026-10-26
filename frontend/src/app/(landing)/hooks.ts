import { useEffect, useState, type RefObject } from "react";

/**
 * Whether a CSS media query matches. Null in the server-rendered HTML and
 * until the component mounts, so the first client render matches the server's.
 */
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * True while the page is in a background tab or minimized window. The
 * animations use it to pause timers and loops nobody can see.
 */
export function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/**
 * Whether `ref` has come up into view: true once it is well on screen
 * (inside `margin`, with `threshold` of it showing), and false again only
 * once it is wholly below the screen, so a reveal plays again after the
 * reader scrolls back above it, never as they scroll on past it or back a
 * little. Two observers: one leaving at the arrival line undid reveals in
 * full view (the footer wordmark emptied after one notch back up). A
 * reveal that plays in time, not scrubbed by the scroll, so it never rests
 * half done (scene-time.ts). Always true when not `enabled`: the still
 * versions show the finished frame.
 */
export function useArrived(
  ref: RefObject<Element | null>,
  enabled: boolean,
  { margin = "0px 0px -15% 0px", threshold = 0 }: { margin?: string; threshold?: number } = {},
): boolean {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const arrive = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= threshold) setArrived(true);
      },
      { rootMargin: margin, threshold },
    );
    const leave = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && entry.boundingClientRect.top > 0) setArrived(false);
    });
    arrive.observe(el);
    leave.observe(el);
    return () => {
      arrive.disconnect();
      leave.disconnect();
    };
  }, [ref, enabled, margin, threshold]);
  return !enabled || arrived;
}
