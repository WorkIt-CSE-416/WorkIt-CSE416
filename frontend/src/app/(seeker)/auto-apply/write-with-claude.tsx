"use client";

import { ClaudeIcon, SparkleIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { CLAUDE_START_URL, CLAUDE_TRIGGER } from "@/lib/claude-connector";
import { cn } from "@/lib/cn";

/**
 * Write with Claude, wherever the student is told to start their Claude
 * (Written Answers, once their Claude is connected): a new tab
 * on a claude.ai chat with the trigger in its box, and a copy of the
 * trigger for when the box comes up empty. The student presses Enter.
 * A secondary button with the sparkle, the AI mark.
 */
export function WriteWithClaude({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 @md/main:items-end", className)}>
      <ButtonLink
        href={CLAUDE_START_URL}
        target="_blank"
        rel="noreferrer"
        variant="secondary"
        size="sm"
        onClick={() => void navigator.clipboard?.writeText(CLAUDE_TRIGGER).catch(() => {})}
      >
        <SparkleIcon className="size-4" />
        Write with Claude
      </ButtonLink>
      <p className="text-meta text-ink-meta">Press Enter in Claude (or paste)</p>
    </div>
  );
}

/**
 * Connect Claude, in Write with Claude's place while the student's Claude
 * doesn't hold the WorkIt connector (Written Answers): Claude's Add Custom
 * Connector dialog in a new tab, filled in for WorkIt (`link`, from
 * lib/claude-connector.ts, read on the server). Optional: the student can
 * write every answer themselves below.
 */
export function ConnectClaude({ link, className }: { link: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 @md/main:items-end", className)}>
      <ButtonLink href={link} target="_blank" rel="noreferrer" variant="secondary" size="sm">
        <ClaudeIcon className="size-4" />
        Connect Claude
      </ButtonLink>
      <p className="text-meta text-ink-meta">Optional: lets your Claude write these</p>
    </div>
  );
}
