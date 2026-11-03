"use client";

import type { ReactNode } from "react";

import { SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { askScoutAbout, SCOUT_LAUNCHER_ID, setScoutOpen, useScout } from "./scout-store";

/** Whether Ask Scout works. Off (2026-11-02) while it does not: every Ask Scout
 *  button stays in its place, greyed out and not clickable, and the panel's
 *  hint to use it is hidden. A job's button is `soon` (KAN-569), so its
 *  tooltip says "Coming Soon"; disabled, it showed no tooltip and nothing said
 *  why. Set it to true to bring them back at once. */
export const ASK_SCOUT_LIVE = false;

/** A job's "Ask Scout": opens the panel and asks about that role. An outlined
 *  icon beside Save (KAN-519), 36px as Save is, or `quiet`, a bare glyph as on
 *  the job's own card. Its tooltip says what the click will do, since the mark
 *  alone does not say what Scout will be asked. */
export function AskScoutButton({
  quiet = false,
  ...job
}: {
  id: string;
  title: string;
  company: string;
  quiet?: boolean;
}) {
  return (
    <IconButton
      label={`Ask Scout about ${job.title}`}
      tooltip="Ask Scout whether this role fits you"
      variant={quiet ? "quiet" : "outline"}
      className={quiet ? undefined : "size-9 shrink-0"}
      soon={!ASK_SCOUT_LIVE}
      onClick={() => askScoutAbout(job)}
    >
      <SparkleIcon className="size-4" />
    </IconButton>
  );
}

/** A page's own way into the panel, for a page that has taken it over
 *  (scout-takeover.tsx) and wants the way in on the page too. Opens only. */
export function OpenScoutButton({ children }: { children: ReactNode }) {
  return (
    <Button size="sm" onClick={() => setScoutOpen(true)}>
      <SparkleIcon className="size-4" />
      {children}
    </Button>
  );
}

/** The top bar's way in, for a question that isn't about one job. It toggles,
 *  so it also puts the panel away, and while the panel is open it shows as
 *  pressed, in the brand tint, so the bar says Scout is open. The panel hands
 *  focus back here when it closes (SCOUT_LAUNCHER_ID). */
export function ScoutLauncher({ className }: { className?: string }) {
  const { open, takeover } = useScout();
  // A page showing something else in the panel: Scout is what this opens
  const showing = open && !takeover?.away;
  return (
    <IconButton
      id={SCOUT_LAUNCHER_ID}
      label={showing ? "Close Scout" : "Open Scout"}
      aria-pressed={showing}
      className={cn(className, showing && "bg-brand-tint hover:bg-brand-tint")}
      onClick={() => (open && takeover?.away ? takeover.away() : setScoutOpen(!open))}
    >
      <SparkleIcon className="text-brand size-4" />
    </IconButton>
  );
}
