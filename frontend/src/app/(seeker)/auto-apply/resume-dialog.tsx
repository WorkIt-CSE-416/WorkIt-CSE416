"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";

import { firstChoice, loadChoices, ResumeLists, type Choice } from "../jobs/resume-picker";
import { chooseResume } from "./actions";

/**
 * Up Next's resume picker (KAN-359): which resume one queued job goes out
 * with. The Apply dialog's own resume table (../jobs/resume-picker.tsx:
 * Generated or Uploaded, a search, loadChoices for this job), so a job's
 * resume is picked the same way wherever it is picked. It opens on the
 * resume the row shows (`current`, as "built:<id>" or "uploaded:<id>"),
 * else the list's first pick. Save sends the pick (chooseResume), which the
 * API keeps as the application's sent resume, and redraws the page.
 *
 * It picks from the resumes there are, and links nowhere else: a Tailor
 * for This Job and a Build a New Resume link under the lists were taken out
 * (KAN-360), since the job row and the header's Manage Resumes reach both.
 */
export function ResumeDialog({
  jobId,
  role,
  company,
  current,
  open,
  onOpenChange,
}: {
  jobId: string;
  role: string;
  company: string;
  current: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Mounted fresh for each row (./up-next.tsx keys it by job), so the
    // state starts empty with no reset here.
    let live = true;
    loadChoices(jobId).then((result) => {
      if (!live) return;
      if (result.error) setError(result.error);
      setChoices(result.choices);
      const known = result.choices.find((choice) => choice.key === current);
      setPicked((known ?? firstChoice(result.choices))?.key ?? null);
    });
    return () => {
      live = false;
    };
  }, [open, jobId, current]);

  async function save() {
    const choice = choices?.find((c) => c.key === picked);
    if (!choice) return;
    setBusy(true);
    const result = await chooseResume(jobId, choice.source);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Choose a Resume</DialogTitle>
          <DialogDescription>
            The resume Auto Apply attaches to {role} at {company}.
          </DialogDescription>
        </DialogHeader>
        {choices == null ? (
          <p className="text-note text-ink-muted">Loading your resumes…</p>
        ) : (
          <ResumeLists
            name={`resume-for-${jobId}`}
            choices={choices}
            emptyBuilt="None yet. Build one on Resumes & Experiences."
            emptyUploaded="None yet. Upload one on Resumes & Experiences."
            picked={picked}
            onPick={setPicked}
          />
        )}
        {error && <p className="text-meta text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || picked == null}>
            {busy ? "Saving…" : "Use This Resume"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
