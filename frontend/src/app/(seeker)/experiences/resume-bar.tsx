"use client";

import { StackIcon } from "@phosphor-icons/react/ssr";
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
import type { BankResume } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { pickRowClasses, ResumeLists, type Choice } from "../jobs/resume-picker";
import { ALL, type Pick } from "./holdings";

const TYPE = { uploaded: "Uploaded", base: "Base", tailored: "Tailored" } as const;

/** What All Experiences holds, under its name on the card and in the dialog. */
const ALL_NOTE = "Everything from your resumes and what you added, with copies shown once";

/** The card's name, stretched over the card (`after:inset-0`) so the whole
 *  card is its target, as a Resumes row's is; the star and Change Resume
 *  sit above it. */
const NAME =
  "text-label text-ink after:rounded-card focus-visible:after:ring-brand-ring block w-full cursor-pointer truncate text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2";

/** The bank's resumes as the shared list's cards. */
function choicesOf(resumes: BankResume[]): Choice[] {
  return resumes.map((r) => ({
    key: keyOf(r),
    label: r.name,
    type: TYPE[r.kind],
    forThisJob: false,
    tailoredFor: r.posting,
    at: r.edited_at,
    madeAt: r.kind === "uploaded" ? null : r.created_at,
    source: r.kind === "uploaded" ? { uploadedResumeId: r.id } : { builtResumeId: r.id },
    isDefault: r.primary,
  }));
}

const keyOf = (r: BankResume) => `${r.kind === "uploaded" ? "uploaded" : "built"}:${r.id}`;

/**
 * The Experiences view's resume control (KAN-361, KAN-363): a card that
 * names the pick, drawn as the Resumes page draws a resume
 * (`components/resume-row.tsx`: the file mark, the name, the meta line, the
 * primary star), with Change Resume inside it. The whole card opens the
 * resume, as a row there does: a built resume in the editor, an upload on
 * its own page (KAN-366). The rest of a row's actions (Rename,
 * Download, the star's Make Primary, Delete) stay on the Resumes view: this
 * card says what the page shows, and a delete from it would leave the page
 * on a resume that is gone. Change Resume opens the
 * resume list every resume dialog shares (../jobs/resume-picker, KAN-406),
 * All Experiences (KAN-440) is the page's opening view, so the card is a
 * filter: Show All returns to it from any resume, and it is a pick of its own
 * above the table.
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
  onChange,
}: {
  resumes: BankResume[];
  value: Pick;
  onChange: (pick: Pick) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const picked = resumes.find((r) => r.id === value) ?? null;
  const all = !picked;
  const name = picked?.name ?? "All Experiences";

  return (
    <div className="flex flex-col gap-1.5">
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
          <StackIcon aria-hidden className="text-brand size-5 shrink-0" weight="duotone" />
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
              ? ALL_NOTE
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
        <div className="relative z-10 ml-auto flex items-center gap-2">
          {!all && (
            <Button variant="ghost" size="sm" onClick={() => onChange(ALL)}>
              Show All
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setChoosing(true)}>
            {all ? "Filter by Resume" : "Change Resume"}
          </Button>
        </div>
      </Card>
      {choosing && (
        <ChooseResume
          resumes={resumes}
          value={value}
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
 * Choose a Resume to Show: the shared list, mounted only while open, so
 * each opening starts on the current pick. All Experiences sits over the
 * list, in the same radio group, since it is no resume and the shared list
 * holds resumes only. A click or the arrow keys move the pick; nothing changes
 * on the page until Show Resume, so Cancel leaves it as it was.
 * The resume editor's Experiences picker opens this same dialog: a student
 * picks a resume here, never from a dropdown (KAN-361).
 */
export function ChooseResume({
  resumes,
  value,
  onShow,
  onCancel,
}: {
  resumes: BankResume[];
  value: Pick;
  onShow: (pick: Pick) => void;
  onCancel: () => void;
}) {
  const choices = choicesOf(resumes);
  const current = resumes.find((r) => r.id === value);
  const start = current ?? resumes.find((r) => r.primary) ?? resumes[0];
  const [picked, setPicked] = useState<string | null>(
    value === ALL ? ALL : start ? keyOf(start) : null,
  );
  const choice = choices.find((c) => c.key === picked);
  const all = picked === ALL;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      {/* A column, so the footer stays put and the middle scrolls: the
          whole dialog scrolled, and the All Experiences row over the shared
          list's fixed height pushed Cancel and Show past the window */}
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Choose a Resume to Show</DialogTitle>
          <DialogDescription>
            Experiences shows the entries and skills this resume holds.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
          {/* Drawn as the list's cards are: a pick in the same radio group. */}
          <label className={cn(pickRowClasses(all), "mt-0")}>
            <input
              type="radio"
              name="bank-resume"
              value={ALL}
              checked={all}
              onChange={() => setPicked(ALL)}
              className="accent-brand shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="text-label text-ink block">All Experiences</span>
              <span className="text-note text-ink-meta block">{ALL_NOTE}</span>
            </span>
          </label>
          <ResumeLists
            name="bank-resume"
            choices={choices}
            empty="None yet. Generate or upload one on Resumes."
            picked={picked}
            onPick={setPicked}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              all
                ? onShow(ALL)
                : choice &&
                  onShow(
                    "builtResumeId" in choice.source
                      ? choice.source.builtResumeId
                      : choice.source.uploadedResumeId,
                  )
            }
            disabled={!choice && !all}
          >
            {all ? "Show All" : "Show Resume"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
