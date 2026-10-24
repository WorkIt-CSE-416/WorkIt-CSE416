"use client";

import { StarIcon } from "@phosphor-icons/react/ssr";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { FIELD_LABEL } from "@/components/ui/text-field";
import type { BankResume } from "@/lib/bank-actions";

import { ResumeLists, type Choice } from "../jobs/resume-picker";
import { NONE, type Pick } from "./holdings";

const TYPE = { uploaded: "Uploaded", base: "Base", tailored: "Tailored" } as const;

/** The bank's resumes as the shared table's rows, in the API's order. */
function choicesOf(resumes: BankResume[]): Choice[] {
  return resumes.map((r) => ({
    key: keyOf(r),
    label: r.name,
    type: TYPE[r.kind],
    forThisJob: false,
    tailoredFor: r.posting,
    at: r.edited_at,
    source: r.kind === "uploaded" ? { uploadedResumeId: r.id } : { builtResumeId: r.id },
    isDefault: r.primary,
  }));
}

const keyOf = (r: BankResume) => `${r.kind === "uploaded" ? "uploaded" : "built"}:${r.id}`;

/**
 * The Experiences view's resume control (KAN-361): a Showing bar that names
 * the pick, with Change Resume to open the resume table every resume dialog
 * shares (../jobs/resume-picker, KAN-360), and Not From an Upload as a link
 * of its own while anything no upload owns exists. It replaced a dropdown
 * that put uploads, built resumes and Not From an Upload in one flat list
 * with no search, cut long names short and grew with every tailored resume.
 * Not From an Upload is no resume, so it stays out of the table.
 */
export function ResumeBar({
  resumes,
  value,
  unowned,
  onChange,
}: {
  resumes: BankResume[];
  value: Pick;
  /** How many entries and skills no upload owns. */
  unowned: number;
  onChange: (pick: Pick) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const picked = resumes.find((r) => r.id === value) ?? null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={FIELD_LABEL}>Showing</span>
        <div className="flex min-w-0 flex-1 basis-56 flex-col">
          <span
            className="text-body text-ink truncate font-medium"
            title={picked?.name ?? undefined}
          >
            {picked?.name ?? "Not From an Upload"}
          </span>
          <span className="text-note text-ink-meta flex min-w-0 items-center gap-1.5">
            {picked ? (
              <>
                {picked.primary && (
                  <span className="text-brand inline-flex shrink-0 items-center gap-1">
                    <StarIcon aria-hidden weight="fill" className="size-3.5" />
                    Primary
                  </span>
                )}
                <span className="truncate" title={picked.posting ?? undefined}>
                  {picked.posting
                    ? `Tailored for ${picked.posting}`
                    : `${TYPE[picked.kind]} resume`}
                </span>
              </>
            ) : (
              "What you added yourself, or what came from several uploads"
            )}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setChoosing(true)}>
          Change Resume
        </Button>
      </div>
      {unowned > 0 && value !== NONE && (
        <div>
          <Button variant="link" onClick={() => onChange(NONE)}>
            Not From an Upload ({unowned})
          </Button>
        </div>
      )}
      {choosing && (
        <ChooseResume
          resumes={resumes}
          current={picked}
          onShow={(id) => {
            setChoosing(false);
            onChange(id);
          }}
          onCancel={() => setChoosing(false)}
        />
      )}
    </div>
  );
}

/**
 * Choose a Resume to Show: the shared table, mounted only while open, so
 * each opening starts on the current pick (else the primary resume, else
 * the first). A click or the arrow keys move the pick; nothing changes on
 * the page until Show Resume, so Cancel leaves it as it was.
 */
function ChooseResume({
  resumes,
  current,
  onShow,
  onCancel,
}: {
  resumes: BankResume[];
  current: BankResume | null;
  onShow: (id: string) => void;
  onCancel: () => void;
}) {
  const choices = choicesOf(resumes);
  const start = current ?? resumes.find((r) => r.primary) ?? resumes[0];
  const [picked, setPicked] = useState<string | null>(start ? keyOf(start) : null);
  const choice = choices.find((c) => c.key === picked);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Choose a Resume to Show</DialogTitle>
          <DialogDescription>
            Experiences shows the entries and skills this resume holds.
          </DialogDescription>
        </DialogHeader>
        <ResumeLists
          name="bank-resume"
          choices={choices}
          emptyBuilt="None yet. Build one on Resumes."
          emptyUploaded="None yet. Upload one on Resumes."
          picked={picked}
          onPick={setPicked}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              choice &&
              onShow(
                "builtResumeId" in choice.source
                  ? choice.source.builtResumeId
                  : choice.source.uploadedResumeId,
              )
            }
            disabled={!choice}
          >
            Show Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
