"use client";

import { useSyncExternalStore, type ReactNode } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/**
 * The landing header's outer element. It marks itself `data-scrolled` once
 * the page leaves the top, so header.tsx can turn the bar into a floating
 * rounded panel with `group-data-scrolled:` classes. Server render and first
 * paint are unscrolled.
 */
export function FloatingHeader({ children }: { children: ReactNode }) {
  const scrolled = useSyncExternalStore(
    subscribe,
    () => window.scrollY > 8,
    () => false,
  );
  return (
    <header
      data-scrolled={scrolled || undefined}
      className="group sticky top-0 z-40 px-2 pt-2 sm:px-6 sm:pt-3"
    >
      {children}
    </header>
  );
}
