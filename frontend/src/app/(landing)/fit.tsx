"use client";

import { createContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { motion } from "motion/react";

/** The scale `Fit` draws its visual at, for a part of the visual that must
 * stay readable however small the visual is drawn (a story's scene title,
 * story.tsx). */
export const FitScale = createContext(1);

/** How far `Fit` may scale a visual up: the stories are drawn at 520px
 * wide, small type included, so past this their 10px labels read as
 * display type. */
const MAX_FIT = 1.5;

/**
 * Scales a visual to fit: to the height and width of `box` (the pinned tour
 * stop's visual area, or a feature page's stage, minus its padding), up to
 * `MAX_FIT`, or down to its own width when there is no box (the stacked
 * stops). So a tall visual such as the resume card fits a short laptop
 * screen instead of losing its top and bottom to the area's overflow clip,
 * and on a big screen the stories fill their area instead of floating small
 * in the middle of it (the team found them too small at 1x). A transform
 * from the top, with the space it frees or takes evened out by the bottom
 * margin, so the content keeps its own layout. Without a box it never
 * scales up.
 */
export function Fit({
  box,
  children,
}: {
  box?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const area = box?.current ?? el.parentElement;
    if (!area) return;
    const measure = () => {
      const style = getComputedStyle(area);
      const roomW =
        area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const roomH = box
        ? area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        : Infinity;
      // offsetWidth and offsetHeight ignore the transform, so these are the
      // unscaled sizes. The child's width, not the wrapper's: the wrapper
      // stretches to the area, while a wide visual overflows it.
      const child = el.firstElementChild as HTMLElement | null;
      const w = child?.offsetWidth ?? 0;
      const h = el.offsetHeight;
      setHeight(h);
      setFit(w > 0 && h > 0 ? Math.min(box ? MAX_FIT : 1, roomW / w, roomH / h) : 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(area);
    return () => observer.disconnect();
  }, [box]);

  // A motion element, so motion knows its scale: a `layout` move inside a
  // plain scaled div (Matching's Best Match sort) started each card from its
  // old place times the scale, almost a row out at 1.3x.
  return (
    <motion.div
      ref={ref}
      className="flex w-full justify-center"
      style={{ scale: fit, originY: 0, marginBottom: fit === 1 ? 0 : -height * (1 - fit) }}
    >
      <FitScale value={fit}>{children}</FitScale>
    </motion.div>
  );
}
