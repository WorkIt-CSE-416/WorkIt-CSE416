"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Copy Fix Brief: the brief's Markdown to the clipboard, to paste into a coding agent. */
export function CopyBrief({ brief }: { brief: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(brief);
            setSaid("Copied.");
          } catch {
            setSaid("Couldn't copy. Download it instead.");
          }
        }}
      >
        Copy Fix Brief
      </Button>
      {said && <span className="text-body text-ink-muted">{said}</span>}
    </span>
  );
}
