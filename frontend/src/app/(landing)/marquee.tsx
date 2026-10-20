import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

type MarqueeProps = ComponentPropsWithoutRef<"div"> & {
  /** Scroll the other way. */
  reverse?: boolean;
  pauseOnHover?: boolean;
  /** How many copies of the children run end to end, so the loop has no gap. */
  repeat?: number;
  children: ReactNode;
};

/**
 * A column that scrolls its children upward forever, in CSS only, so it
 * renders on the server and ships no JavaScript. Set `--duration` and `--gap`
 * on the instance to change the speed and spacing. The keyframes and the
 * reduced-motion pause are in landing.css.
 */
export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  repeat = 4,
  children,
  ...props
}: MarqueeProps) {
  return (
    <div
      className={cn(
        "group flex flex-col [gap:var(--gap)] overflow-hidden p-2 [--duration:40s] [--gap:1rem]",
        className,
      )}
      {...props}
    >
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          className={cn(
            "landing-marquee flex shrink-0 flex-col justify-around [gap:var(--gap)]",
            pauseOnHover && "group-hover:[animation-play-state:paused]",
            reverse && "[animation-direction:reverse]",
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
