"use client";

import { SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

import { askScoutAbout, setScoutOpen, useScout } from "./scout-store";

/** A job card's "Ask Scout": opens the panel and asks about that role.
 *  Secondary, not primary: asking about a job is the step before applying to
 *  it, and only one control on a card can be the one being pointed at. */
export function AskScoutButton(job: { id: string; title: string; company: string }) {
  return (
    <Button variant="secondary" size="sm" onClick={() => askScoutAbout(job)}>
      <SparkleIcon className="size-4" />
      Ask Scout
    </Button>
  );
}

/** The top bar's way in, for a question that isn't about one job. It toggles,
 *  so it also puts the panel away. */
export function ScoutLauncher({ className }: { className?: string }) {
  const { open } = useScout();
  return (
    <IconButton
      label={open ? "Close Scout" : "Open Scout"}
      className={className}
      onClick={() => setScoutOpen(!open)}
    >
      <SparkleIcon className="text-brand size-4" />
    </IconButton>
  );
}
