"use client";

import { FileTextIcon, TagIcon } from "@phosphor-icons/react/ssr";
import { useState } from "react";

import { FieldFacet, type FacetOption } from "@/components/field-facet";
import { SearchIcon } from "@/components/icons";
import { useShallowParams, useShallowPush } from "@/components/shallow-routing";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { generateResume, listBuiltResumes, type BuiltResume } from "@/lib/built-resume-actions";
import { listResumes, type ResumeItem } from "@/lib/resume-actions";

import { BuiltResumeRow } from "./built-resume-row";
import { DuplicateResumeDialog } from "./duplicate-resume-dialog";
import { ResumesHeader } from "./header";
import { matches, ResumeList, searchWords } from "./resume-list";
import { UploadedRow, useResumeUpload } from "./upload-resume";

type ResumeType = "uploaded" | "generated" | "tailored";

/** The Type filter's options. */
const TYPES: FacetOption[] = [
  { value: "uploaded", label: "Uploaded" },
  { value: "generated", label: "Generated" },
  { value: "tailored", label: "Tailored" },
];

/** `?type=uploaded,tailored`: the picked types, in the options' order;
 *  none (or none valid) is every type. */
function parseTypes(raw: string | null): ResumeType[] {
  const picked = raw?.split(",") ?? [];
  return TYPES.map((t) => t.value).filter((v) => picked.includes(v)) as ResumeType[];
}

/** One resume of either kind, as the list orders and filters it. */
type Row =
  | { key: string; type: "uploaded"; at: string; text: string; upload: ResumeItem }
  | { key: string; type: "generated" | "tailored"; at: string; text: string; built: BuiltResume };

/**
 * The Resumes view of Resumes & Experiences: its header, then one list of
 * every resume the student has (KAN-362), uploaded, generated (the base
 * resumes, KAN-207) and tailored (KAN-217), newest first, each as its
 * card with its star, Rename, Download and Delete, in a card that scrolls
 * inside itself (./resume-list.tsx). Every card acts alike, so one list
 * holds them all; each says what it is in its own line ("Uploaded …",
 * "Last edited …", "For <posting>").
 *
 * It is laid out as the Applications Tracker is (../applications/page.tsx
 * and filter-bar.tsx), so the two read as one app: a search over the
 * names and the postings on its own row, then the Type filter
 * (`FieldFacet`, the Applications list's dropdown) with Upload Resume
 * (./upload-resume.tsx) and Generate Resume at the right, then the list,
 * or an `EmptyState` in its place. The type is the URL's (`?type=`),
 * moved in place and replacing the entry (`useShallowPush`), so a reload
 * or a shared link keeps it and a tick is not a step of Back. The
 * search's words are the page's own.
 *
 * It went through five shapes in KAN-362 first: three cards stacked one
 * under another, which a student with many resumes scrolled past; a pill
 * switcher under the header's own; underline tabs with counts; a table
 * with Type and Last Edited columns and sort headings; and that table
 * with the icons in one `⋯` menu. The views split one list in three, the
 * columns said what each card's line already says, and the menu hid the
 * actions a student uses. Generate Resume sat in the header until then.
 * The resume picker (`../jobs/resume-picker.tsx`) still splits Generated
 * (base and tailored) from Uploaded.
 *
 * Generate makes a base resume from the whole bank in Jake's Resume, named
 * "Resume #N" by the API until the student renames it; a Type filter that
 * would hide it is cleared, so it shows at the top. Generate has no limit:
 * only uploads count toward the 5 (KAN-268). A failed Generate or reload
 * shows its error under the filter row. A Generate or an upload that would
 * make a resume the student already has (the API's 409, KAN-267) makes
 * nothing and says so in one pop-up (./duplicate-resume-dialog.tsx).
 */
export function BuiltResumes({
  initial,
  initialUploaded,
}: {
  initial: BuiltResume[];
  initialUploaded: ResumeItem[];
}) {
  const [resumes, setResumes] = useState(initial);
  const [uploaded, setUploaded] = useState(initialUploaded);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The API's "Duplicate Resume found: <name>", while its pop-up is open.
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const params = useShallowParams();
  const push = useShallowPush();
  const types = parseTypes(params.get("type"));

  function setTypes(next: ResumeType[]) {
    const href = next.length > 0 ? `/resumes?type=${next.join(",")}` : "/resumes";
    push(href, undefined, { replace: true });
  }

  // Both lists, every time: one primary star spans them.
  async function reload() {
    const [built, uploads] = await Promise.all([listBuiltResumes(), listResumes()]);
    if (built.data) setResumes(built.data);
    if (!uploads.error) setUploaded(uploads.resumes);
    setError(built.error ?? uploads.error);
  }

  const upload = useResumeUpload({ uploaded, reload, onDuplicate: setDuplicate });

  async function generate() {
    setGenerating(true);
    setError(null);
    const { error, status } = await generateResume();
    setGenerating(false);
    if (status === 409) return setDuplicate(error);
    if (error) return setError(error);
    await reload();
    if (types.length > 0 && !types.includes("generated")) setTypes([]);
  }

  const rows: Row[] = [
    ...uploaded.map((r) => ({
      key: `uploaded:${r.id}`,
      type: "uploaded" as const,
      at: r.created_at ?? "",
      text: r.original_filename ?? "Resume",
      upload: r,
    })),
    ...resumes.map((r) => ({
      key: `built:${r.id}`,
      type: r.job_posting_id ? ("tailored" as const) : ("generated" as const),
      at: r.edited_at,
      text: `${r.name} ${r.posting_title ?? ""} ${r.posting_company ?? ""}`,
      built: r,
    })),
  ];
  const words = searchWords(query);
  const shown = rows
    .filter((row) => types.length === 0 || types.includes(row.type))
    .filter((row) => matches(row.text, words))
    // Newest first: an upload by the day it came, a built resume by its
    // last edit.
    .sort((a, b) => Date.parse(b.at || "0") - Date.parse(a.at || "0"));

  const filtered = types.length > 0 || words.length > 0;

  return (
    <>
      <ResumesHeader view="resumes" />

      {/* The search, then the filters with the buttons at the right, above
          the card: the Applications page's FilterBar, row for row. */}
      <div className="mt-6 flex flex-col gap-3">
        <SearchField
          id="resumes-search"
          label="Search resumes"
          placeholder="Search by name or job"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full @lg/main:w-64"
        />
        <div className="flex flex-wrap items-center gap-2">
          <FieldFacet
            label="Type"
            Icon={TagIcon}
            options={TYPES}
            values={types}
            onChange={(values) => setTypes(values as ResumeType[])}
            className="min-w-36"
          />
          <div className="ml-auto flex items-center gap-2">
            {upload.button}
            <Button size="sm" onClick={generate} disabled={generating}>
              <FileTextIcon aria-hidden className="size-4" />
              {generating ? "Generating…" : "Generate Resume"}
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-note text-danger">
            {error}
          </p>
        )}
        {upload.notes}
      </div>

      {rows.length === 0 && !upload.uploading ? (
        <EmptyState Icon={FileTextIcon} title="No Resumes Yet" className="mt-4">
          Upload a resume to add its experiences, or generate one from them.
        </EmptyState>
      ) : shown.length === 0 && !upload.uploading ? (
        <EmptyState
          Icon={SearchIcon}
          title="No Matching Resumes"
          className="mt-4"
          action={
            filtered && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setTypes([]);
                }}
              >
                Clear Filters
              </Button>
            )
          }
        >
          {types.length === 1 && types[0] === "tailored" && words.length === 0
            ? "You have no tailored resumes yet. Use Tailor My Resume on a job posting's page to make one for it."
            : "None of your resumes match these filters."}
        </EmptyState>
      ) : (
        <ResumeList>
          {upload.pending}
          {shown.map((row) =>
            row.type === "uploaded" ? (
              <UploadedRow key={row.key} resume={row.upload} reload={reload} />
            ) : (
              <BuiltResumeRow key={row.key} resume={row.built} reload={reload} />
            ),
          )}
        </ResumeList>
      )}
      <DuplicateResumeDialog message={duplicate} onClose={() => setDuplicate(null)} />
    </>
  );
}
