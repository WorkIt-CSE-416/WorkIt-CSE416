import { SparkleIcon as Sparkle } from "@phosphor-icons/react/ssr";

/** Scout and every AI action, the one mark for both (KAN-257): the top bar's
 *  launcher, the panel's header, Scout's mark in the chat, Ask Scout, Tailor's
 *  own run and Read It Again with AI. It was a filled sparkle drawn by hand
 *  in the bar and the panel, beside an outlined one in the chat and on every
 *  AI button, so the assistant wore two marks. Use this, never Phosphor's
 *  `SparkleIcon` directly.
 *
 *  Its own module, which icons.tsx re-exports, so a light page can draw it
 *  without icons.tsx: the bundler takes that module whole, all its glyphs,
 *  about 40 KB compressed, and the feature pages' Resumes and Auto Apply
 *  animations paid that for this one mark (frontend/CLAUDE.md, Icons). */
export function SparkleIcon({ className }: { className?: string }) {
  return <Sparkle aria-hidden className={className} />;
}
