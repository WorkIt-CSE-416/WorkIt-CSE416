import { ViewTransition, type ReactNode } from "react";

/**
 * The page inside the seeker shell, re-made on every move between sections:
 * a template remounts when its child segment changes (/dashboard to /jobs),
 * while the layout around it (the panel, the bar) stays put. Wrapping it in
 * a <ViewTransition> turns that remount into an exit and an enter, so the
 * old page fades out fast and the new one rises in (`page-exit` and
 * `page-enter` in globals.css), and the panel and bar stay still.
 *
 * Search params do not remount a template, so a change of view or filter
 * inside a page is left to that page's own transition; `default="none"`
 * keeps this one out of it.
 */
export default function SeekerTemplate({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
