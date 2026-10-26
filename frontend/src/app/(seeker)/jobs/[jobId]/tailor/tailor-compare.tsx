"use client";

import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { FileIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";
import { readTailorSource, type TailorSource } from "@/lib/tailor-actions";

import { Editor } from "../../../resumes/[resumeId]/editor";
import { PageSkeleton, PdfPages } from "../../../resumes/[resumeId]/pdf-pages";
import { useTailorReview } from "../../../resumes/[resumeId]/tailor-review";

/**
 * Tailor's review as a before and after (docs/tailor_resume.md, "Before and
 * after"): the resume the run tailored (the record's `source`) as it
 * prints, read only, beside the tailored resume in the editor, whose marks
 * and Revert work as they do alone.
 *
 * The two columns are the same width and sit in the page's own scroll, so
 * page N of Before stays beside page N of After as the student scrolls,
 * with no scroll syncing; a resume one page longer simply runs on alone.
 * Two columns need more than the page's reading width, so while both show
 * the comparison widens to the shell's (up to 84rem, as the Dashboard's
 * cap). Below 56rem of page, and when the student picks After Only, one
 * column shows at a time. The After column is its own `@container/main`, so
 * the editor lays out for its column. In a half column Ask Scout would open
 * under the page, out of view, so opening it switches to After Only, where
 * it docks beside the page as on the editor's own page.
 *
 * The record lives in this tab's sessionStorage (./tailor-review.tsx), so
 * another tab or device has no source: the editor shows alone, with a line
 * that says why.
 */

type View = "both" | "before" | "after";
type Before = { name: string | null; pdf: string | null; error: string | null };

/** The editor's sticky bar's box (../../../resumes/[resumeId]/editor.tsx),
 *  so Before's pages start level with After's. */
const BAR =
  "bg-brand-tint/95 ring-brand-pale sticky top-2 z-20 flex min-h-12 flex-wrap items-center gap-2 rounded-2xl p-1.5 pl-3 shadow-sm ring-1 backdrop-blur";

export function TailorCompare({
  name,
  ...editor
}: ComponentProps<typeof Editor> & {
  /** The tailored resume's name, over the After column. */
  name: string;
}) {
  const [record] = useTailorReview(editor.resumeId);
  // Storage is read after mount; until then the page shows no line about it.
  const [read, setRead] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the storage read done
    setRead(true);
  }, []);
  // The first source read is kept: a revert of every change clears the
  // record, and the original should not vanish from under the student.
  const [source, setSource] = useState<TailorSource | null>(null);
  if (record?.source && !source) setSource(record.source);
  const [view, setView] = useState<View>("both");
  const both = source != null && view !== "after";
  // One at a time: on the page below 56rem, and in the phone editor's own
  // header, since that layout covers the page.
  const oneAtATime = (className?: string) => (
    <SegmentedToggle
      label="Resume Shown"
      options={[
        { value: "before", label: "Before" },
        { value: "after", label: "After" },
      ]}
      value={view === "before" ? "before" : "after"}
      onValueChange={(next) => setView(next as View)}
      className={className}
    />
  );

  const noRecord = read && !source && (
    <p className="text-note text-ink-meta">
      The before and after shows only in the tab that ran Tailor.
    </p>
  );

  return (
    <div
      className={cn(
        "mt-4 [--wide:max(100%,min(84rem,calc(100cqw_-_6rem)))]",
        both && "@4xl/main:ml-[calc((100%_-_var(--wide))/2)] @4xl/main:w-(--wide)",
      )}
    >
      {noRecord}
      {source && (
        <div className="flex flex-wrap items-center gap-3">
          {oneAtATime("@4xl/main:hidden")}
          <SegmentedToggle
            label="Comparison"
            options={[
              { value: "both", label: "Side by Side" },
              { value: "after", label: "After Only" },
            ]}
            value={view === "after" ? "after" : "both"}
            onValueChange={(next) => setView(next as View)}
            className="hidden @4xl/main:grid"
          />
        </div>
      )}
      <div className={cn("grid items-start gap-6", both && "@4xl/main:grid-cols-2")}>
        {source && (
          <section
            aria-label="Before"
            className={cn(
              "mt-4 min-w-0",
              view === "after" && "hidden",
              view === "both" && "hidden @4xl/main:block",
            )}
          >
            <BeforeColumn source={source} />
          </section>
        )}
        <section
          aria-label={source ? "After" : undefined}
          className={cn(
            "@container/main min-w-0",
            source && "mt-4",
            view === "before" && "hidden @4xl/main:block",
          )}
        >
          {source && <Label tag="After" name={name} />}
          <Editor
            {...editor}
            onAsk={() => setView("after")}
            phoneBar={source ? oneAtATime() : noRecord}
          />
        </section>
      </div>
    </div>
  );
}

function Label({ tag, name }: { tag: string; name: ReactNode }) {
  return (
    <p className="text-label text-ink flex min-w-0 items-center gap-2">
      <Badge>{tag}</Badge>
      <span className="truncate">{name}</span>
    </p>
  );
}

/** The source as it prints: its pdf.js pages with no click targets, as an
 *  upload's own page draws them. */
function BeforeColumn({ source }: { source: TailorSource }) {
  const [before, setBefore] = useState<Before | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readTailorSource(source).then((read) => {
      if (!cancelled) setBefore(read);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <>
      <Label tag="Before" name={before?.name ?? "The resume you tailored"} />
      <div className={cn(BAR, "mt-4")}>
        <span className="text-label text-ink">As it was before Tailor. Read only.</span>
      </div>
      <div className="mt-4">
        {before == null ? (
          <PageSkeleton />
        ) : before.pdf ? (
          <PdfPages
            pdf={before.pdf}
            boxes={[]}
            selected={null}
            onSelect={() => {}}
            placeholder={<PageSkeleton />}
          />
        ) : before.error ? (
          <EmptyState Icon={CloudSlashIcon} title="The Original Isn't Loading Right Now">
            {before.error}
          </EmptyState>
        ) : (
          <EmptyState Icon={FileIcon} title="This File Can't Be Shown Here">
            WorkIt shows PDF resumes here, and this one is a Word file.
          </EmptyState>
        )}
      </div>
    </>
  );
}
