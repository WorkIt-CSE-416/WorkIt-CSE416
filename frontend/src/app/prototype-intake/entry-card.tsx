"use client";

// PROTOTYPE (KAN-193), throwaway. The one entry editor (KAN-186) as a stub:
// every variant shows it, only where it sits changes.

import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { entryLabel, MAX_FOLLOW_UPS, type Intake } from "./model";

const INPUT =
  "text-body text-ink placeholder:text-ink-meta bg-app focus:bg-panel focus:ring-brand-ring w-full rounded-lg px-2.5 py-1.5 outline-none focus:ring-2";

export function EntryCard({ intake, dense = false }: { intake: Intake; dense?: boolean }) {
  const { draft, setDraft, followUps, duplicate } = intake;
  if (!draft) return null;

  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant="tag">{draft.section}</Badge>
        {draft.ready ? (
          <Badge tone="positive">Ready to Save</Badge>
        ) : (
          <Badge tone="inert">
            Drafting · {followUps}/{MAX_FOLLOW_UPS} Follow-Ups
          </Badge>
        )}
      </div>

      <div className={cn("grid gap-2", !dense && "@xl/main:grid-cols-2")}>
        <input
          className={INPUT}
          placeholder="Title"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <input
          className={INPUT}
          placeholder="Organization"
          value={draft.organization}
          onChange={(e) => set({ organization: e.target.value })}
        />
        <input
          className={INPUT}
          placeholder="Start"
          value={draft.start}
          onChange={(e) => set({ start: e.target.value })}
        />
        <input
          className={INPUT}
          placeholder="End"
          value={draft.end}
          onChange={(e) => set({ end: e.target.value })}
        />
      </div>

      {draft.details.map((d) => (
        <p key={d.label} className="text-note text-ink-muted">
          <span className="text-ink font-semibold">{d.label}:</span> {d.value}
        </p>
      ))}

      {draft.bullets.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {draft.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="text-ink-meta mt-1.5">•</span>
              <textarea
                rows={2}
                className={cn(INPUT, "resize-none")}
                value={b}
                onChange={(e) =>
                  set({ bullets: draft.bullets.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              <button
                aria-label="Remove bullet"
                className="text-ink-meta hover:text-ink mt-1.5"
                onClick={() => set({ bullets: draft.bullets.filter((_, j) => j !== i) })}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft.skills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-meta text-ink-meta">Skills</span>
          {draft.skills.map((s) => (
            <span
              key={s}
              className="bg-brand-tint text-brand text-note flex items-center gap-1 rounded-md px-2 py-0.5"
            >
              {s}
              <button
                aria-label={`Remove ${s}`}
                onClick={() => set({ skills: draft.skills.filter((x) => x !== s) })}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {duplicate ? (
        <DuplicateWarning intake={intake} />
      ) : (
        <div className="flex items-center gap-2">
          <Button onClick={intake.save} disabled={!draft.title}>
            Save Entry
          </Button>
          {intake.walk && (
            <Button variant="ghost" onClick={intake.skip}>
              Skip {draft.section}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function DuplicateWarning({ intake }: { intake: Intake }) {
  if (!intake.duplicate) return null;
  return (
    <div role="alert" className="bg-warning-tint text-warning flex flex-col gap-2 rounded-xl p-3">
      <p className="text-body">
        This looks like <strong>{entryLabel(intake.duplicate)}</strong>, already in your bank.
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={intake.saveAsNew}>
          Save as New
        </Button>
        <Button variant="ghost" onClick={intake.cancelDuplicate}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
