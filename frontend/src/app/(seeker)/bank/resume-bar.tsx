"use client";

import { NotePencilIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useState } from "react";

import { PdfIcon } from "@/components/icons";
import { PrimaryStar } from "@/components/resume-row";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FIELD_LABEL } from "@/components/ui/text-field";
import type { BankResume } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { ResumeLists, type Choice } from "../jobs/resume-picker";
import { NONE, type Pick } from "./holdings";

const TYPE = { uploaded: "Uploaded", base: "Base", tailored: "Tailored" } as const;

/** What Not From an Upload holds, under its name on the card and in the dialog. */
const NONE_NOTE = "What you added yourself, or what came from several uploads";

/** The card's name, stretched over the card (`after:inset-0`) so the whole
 *  card is its target, as a Resumes row's is; the star and Change Resume
 *  sit above it. */
const NAME =
  "text-label text-ink after:rounded-card focus-visible:after:ring-brand-ring block w-full cursor-pointer truncate text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2";

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
 * The Experiences view's resume control (KAN-361, KAN-363): "Showing" over
 * a card that names the pick, drawn as the Resumes page draws a resume
 * (`components/resume-row.tsx`: the file mark, the name, the meta line, the
 * primary star), with Change Resume inside it. The whole card opens the
 * resume, as a row there does: a built resume in the editor, an upload on
 * its own page (KAN-366). The rest of a row's actions (Rename,
 * Download, the star's Make Primary, Delete) stay on the Resumes view: this
 * card says what the page shows, and a delete from it would leave the page
 * on a resume that is gone. Change Resume opens the
 * resume table every resume dialog shares (../jobs/resume-picker, KAN-360),
 * and Not From an Upload is a row of its own under that table while
 * anything no upload owns exists.
 *
 * It was loose text with Change Resume at the far edge of the page and Not
 * From an Upload as a link under it (KAN-361), which looked like no resume
 * anywhere else in the app. Before that, a dropdown put uploads, built
 * resumes and Not From an Upload in one flat list with no search, cut long
 * names short and grew with every tailored resume.
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
  const name = picked?.name ?? "Not From an Upload";

  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL}>Showing</span>
      {/* Change Resume wraps to a line of its own on a phone: beside the
          name, it left "The Allen In…" of a tailored resume's name. */}
      <Card
        padding="sm"
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2",
          picked &&
            "hover:border-brand/40 hover:shadow-lift ease-glide relative transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]",
        )}
      >
        {picked ? (
          <PdfIcon className="size-5 shrink-0" />
        ) : (
          <NotePencilIcon aria-hidden className="text-ink-meta size-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1 basis-40">
          {!picked ? (
            <p className="text-label text-ink truncate">{name}</p>
          ) : (
            <Link
              href={
                picked.kind === "uploaded"
                  ? `/resumes/uploaded/${encodeURIComponent(picked.id)}`
                  : `/resumes/${encodeURIComponent(picked.id)}`
              }
              aria-label={`Open ${name}`}
              title={name}
              className={NAME}
            >
              {name}
            </Link>
          )}
          <p className="text-note text-ink-meta truncate" title={picked?.posting ?? undefined}>
            {!picked
              ? NONE_NOTE
              : picked.posting
                ? `Tailored for ${picked.posting}`
                : `${TYPE[picked.kind]} resume`}
          </p>
        </div>
        {picked?.primary && (
          <span className="relative z-10">
            <PrimaryStar name={picked.name} primary />
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="relative z-10 ml-auto"
          onClick={() => setChoosing(true)}
        >
          Change Resume
        </Button>
      </Card>
      {choosing && (
        <ChooseResume
          resumes={resumes}
          value={value}
          unowned={unowned}
          onShow={(pick) => {
            setChoosing(false);
            onChange(pick);
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
 * the first). Not From an Upload is a row under the table, in the same
 * radio group, since it is no resume and the shared table holds resumes
 * only. A click or the arrow keys move the pick; nothing changes on the
 * page until Show Resume, so Cancel leaves it as it was.
 */
function ChooseResume({
  resumes,
  value,
  unowned,
  onShow,
  onCancel,
}: {
  resumes: BankResume[];
  value: Pick;
  unowned: number;
  onShow: (pick: Pick) => void;
  onCancel: () => void;
}) {
  const choices = choicesOf(resumes);
  const current = resumes.find((r) => r.id === value);
  const start = current ?? resumes.find((r) => r.primary) ?? resumes[0];
  const [picked, setPicked] = useState<string | null>(
    value === NONE ? NONE : start ? keyOf(start) : null,
  );
  const choice = choices.find((c) => c.key === picked);
  const none = picked === NONE;

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
        {/* Shown while anything no upload owns exists, or while it is the
            pick, so the dialog can always show it again. Every item must
            show under some pick (holdings.ts). */}
        {(unowned > 0 || value === NONE) && (
          <label
            className={cn(
              "border-border-subtle rounded-card flex cursor-pointer items-center gap-3 border px-3 py-2.5 transition-colors duration-150",
              none ? "bg-brand-tint" : "hover:bg-hover",
            )}
          >
            <input
              type="radio"
              name="bank-resume"
              value={NONE}
              checked={none}
              onChange={() => setPicked(NONE)}
              className="accent-brand shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="text-note text-ink block">Not From an Upload</span>
              <span className="text-note text-ink-meta block">{NONE_NOTE}</span>
            </span>
            <span className="text-note text-ink-meta shrink-0">
              {unowned} {unowned === 1 ? "item" : "items"}
            </span>
          </label>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              none
                ? onShow(NONE)
                : choice &&
                  onShow(
                    "builtResumeId" in choice.source
                      ? choice.source.builtResumeId
                      : choice.source.uploadedResumeId,
                  )
            }
            disabled={!choice && !none}
          >
            Show Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
