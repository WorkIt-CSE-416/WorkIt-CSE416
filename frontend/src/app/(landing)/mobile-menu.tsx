"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

/**
 * The phone header's menu: a native popover (open, close, Esc and light
 * dismiss with no JavaScript) that also closes when one of its links is
 * followed. The header stays mounted across the marketing pages, so a
 * popover left open would sit over the next page. It scrolls on its own
 * on a short screen, so it opts out of the page's smooth scroll
 * (`data-lenis-prevent`, smooth-scroll.tsx).
 */
export function MobileMenu({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Back and Forward change the page without a click inside.
  useEffect(() => {
    hide(ref.current);
  }, [pathname]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("a")) hide(event.currentTarget);
  };

  return (
    <div
      ref={ref}
      id={id}
      popover="auto"
      data-lenis-prevent
      onClick={onClick}
      className={className}
    >
      {children}
    </div>
  );
}

function hide(popover: HTMLElement | null) {
  if (popover?.matches(":popover-open")) popover.hidePopover();
}
