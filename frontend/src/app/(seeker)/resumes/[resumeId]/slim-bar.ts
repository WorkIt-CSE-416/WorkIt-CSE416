import { cn } from "@/lib/cn";

/** The slim bar's box: a quiet white row, not the brand-tinted bar. The
 *  editor's toolbar (`SlimBar`, ./editor.tsx) and an upload's page
 *  (../uploaded/[id]/viewer.tsx) both draw it, so like bars look alike
 *  (KAN-576). Every button on the bar reads muted, but for its real actions
 *  (`data-bar-action`), which keep their own colour: a filled button's words
 *  would be grey on purple. */
export const SLIM_BAR = cn(
  "bg-panel/95 ring-border-subtle sticky top-2 z-20 flex min-h-10 flex-wrap items-center gap-2 rounded-xl px-2 py-1 ring-1 backdrop-blur",
  "[&_button:not([aria-pressed=true]):not([data-bar-action])]:text-ink-muted [&_button:not([aria-pressed=true]):not([data-bar-action]):hover]:text-ink",
);
