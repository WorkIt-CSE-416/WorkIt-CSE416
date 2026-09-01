import type { Metadata } from "next";

export const metadata: Metadata = {
  /**
   * Spelled out in full, unlike every other page. The root layout's
   * title.template only applies to *child* route segments, and this page shares
   * a segment with that layout, so it never sees the template — setting "Home"
   * alone renders a tab reading "Home" with no brand. Verified in the output,
   * not assumed. Keep the suffix here if you rename this.
   */
  title: "Home · WorkIt",
};

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">WorkIt</h1>
      <p className="max-w-prose text-sm text-balance opacity-70 sm:text-base">
        CSE 416 final project. Edit{" "}
        <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/10">
          src/app/page.tsx
        </code>{" "}
        to get started.
      </p>
    </main>
  );
}
