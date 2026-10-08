"use client";

import { SparkleIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { askScoutAbout, SCOUT_LAUNCHER_ID, setScoutOpen, useScout } from "./scout-store";

/** A job card's "Ask Scout": opens the panel and asks about that role.
 *  Secondary, not primary: asking about a job is the step before applying to
 *  it, and only one control on a card can be the one being pointed at. Its
 *  tooltip says what the click will do, since "Ask Scout" alone does not say
 *  what Scout will be asked. */
export function AskScoutButton(job: { id: string; title: string; company: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="secondary" size="sm" onClick={() => askScoutAbout(job)}>
            <SparkleIcon className="size-4" />
            Ask Scout
          </Button>
        }
      />
      <TooltipContent>Ask Scout whether this role fits you</TooltipContent>
    </Tooltip>
  );
}

/** The top bar's way in, for a question that isn't about one job. It toggles,
 *  so it also puts the panel away, and while the panel is open it shows as
 *  pressed, in the brand tint, so the bar says Scout is open. The panel hands
 *  focus back here when it closes (SCOUT_LAUNCHER_ID). */
export function ScoutLauncher({ className }: { className?: string }) {
  const { open } = useScout();
  return (
    <IconButton
      id={SCOUT_LAUNCHER_ID}
      label={open ? "Close Scout" : "Open Scout"}
      aria-pressed={open}
      className={cn(className, open && "bg-brand-tint hover:bg-brand-tint")}
      onClick={() => setScoutOpen(!open)}
    >
      <SparkleIcon className="text-brand size-4" />
    </IconButton>
  );
}
