"use client";

import * as React from "react";

/**
 * A section that hydrates only once it comes near the screen. The server's
 * HTML is on the page from the start, so its text, links, anchors and height
 * are all there; its JavaScript loads, and React hydrates it, when its wrapper
 * comes within `margin` of the screen. Until then React leaves the server's
 * HTML as it is (a lazy component inside Suspense, which hydration waits for).
 *
 * Hydrating the whole home page at once was one long task: at a 4x CPU
 * slowdown it froze the page for 1.6 s and pushed the hero city to 4.4 s
 * (KAN-540). Each section now hydrates on its own, and only when wanted.
 *
 * The component must take no props, and its parent must not re-render it
 * before it hydrates: React would then drop the server's HTML and render it
 * afresh.
 */
export function hydrateNear(
  load: () => Promise<React.ComponentType>,
  margin = "100% 0px",
): React.ComponentType {
  let open: () => void = () => {};
  // Open at once on the server, which must render the section's HTML: waiting
  // there for a scroll that never comes hung the prerender.
  const near =
    typeof window === "undefined"
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          open = resolve;
        });
  const Lazy = React.lazy(() => near.then(load).then((Component) => ({ default: Component })));

  function Near() {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            open();
            observer.disconnect();
          }
        },
        { rootMargin: margin },
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, []);
    return (
      <div ref={ref}>
        <React.Suspense fallback={null}>
          <Lazy />
        </React.Suspense>
      </div>
    );
  }
  return Near;
}
