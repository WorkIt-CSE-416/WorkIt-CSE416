"use client";

import { useState, type FormEvent } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { FIELD_CONTROL, FIELD_LABEL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { saveSkills, type BankSkill } from "@/lib/experience-actions";

/**
 * The bank's skills as the resume prints them: one line per category,
 * "Languages: Python, Java". Edited as that text, since that is the shape the
 * applicant is aiming for, and saved as one list (PUT .../experience/skills).
 * A line with no colon is uncategorised, printed under "Skills".
 */
function toLines(skills: BankSkill[]): string {
  const groups = new Map<string, string[]>();
  for (const s of skills) {
    const key = s.category ?? "";
    groups.set(key, [...(groups.get(key) ?? []), s.name]);
  }
  return [...groups]
    .map(([category, names]) => (category ? `${category}: ${names.join(", ")}` : names.join(", ")))
    .join("\n");
}

function fromLines(text: string): BankSkill[] {
  return text.split("\n").flatMap((line) => {
    const [head, ...rest] = line.split(":");
    const category = rest.length ? head.trim() || null : null;
    const names = (rest.length ? rest.join(":") : head).split(",");
    return names
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ name, category }));
  });
}

export function SkillsEditor({
  open,
  onOpenChange,
  skills,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: BankSkill[];
  onSaved: () => void;
}) {
  const [text, setText] = useState(() => toLines(skills));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: err } = await saveSkills(fromLines(text));
    setSaving(false);
    if (err != null) {
      setError(err);
      return;
    }
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Edit Skills</DialogTitle>
          <DialogDescription>One line per group, as your resume will show it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="skills-text" className={FIELD_LABEL}>
              Skills
            </label>
            <textarea
              id="skills-text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "Languages: Python, Java, SQL\nFrameworks: React, Flask\nTools: Git, Docker"
              }
              className={cn(FIELD_CONTROL, "px-3.5 py-2.5 font-mono")}
            />
          </div>
          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
