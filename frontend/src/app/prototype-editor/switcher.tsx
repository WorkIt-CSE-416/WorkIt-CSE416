"use client";

// PROTOTYPE (KAN-195), throwaway. Floating bar: ←/→ cycle ?variant=.
// Hidden in production builds.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: { key: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const i = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  function go(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.replace(`${path}?${next}`, { scroll: false });
  }
  const step = (d: number) =>
    go({ variant: variants[(i + d + variants.length) % variants.length].key });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/90 p-1 text-white shadow-lg">
      <button
        aria-label="Previous variant"
        onClick={() => step(-1)}
        className="rounded-full p-1.5 hover:bg-white/15"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="text-label text-center whitespace-nowrap">
        {variants[i].key} ({variants[i].name})
      </span>
      <button
        aria-label="Next variant"
        onClick={() => step(1)}
        className="rounded-full p-1.5 hover:bg-white/15"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
