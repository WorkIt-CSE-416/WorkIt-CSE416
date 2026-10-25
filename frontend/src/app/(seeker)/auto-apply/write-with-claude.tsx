"use client";

import { SparkleIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { CLAUDE_START_URL, CLAUDE_TRIGGER } from "@/lib/claude-connector";
import { cn } from "@/lib/cn";

/**
 * Write with Claude, wherever the student is told to start their Claude
 * (Auto Apply's Written Questions Waiting card, Written Answers): a new tab
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
