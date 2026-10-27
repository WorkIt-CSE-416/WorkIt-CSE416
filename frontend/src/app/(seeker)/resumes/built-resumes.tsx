"use client";

import { ArrowsDownUpIcon, FileTextIcon, TagIcon } from "@phosphor-icons/react/ssr";
import { startTransition, useOptimistic, useState } from "react";

import { FacetLabel, facetClasses, FieldFacet, type FacetOption } from "@/components/field-facet";
import {
  matches,
  RESUME_TYPES,
  ResumeGroup,
  searchWords,
  type ResumeType,
} from "@/components/resume-list";
import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { useShallowParams, useShallowPush } from "@/components/shallow-routing";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { generateResume, listBuiltResumes, type BuiltResume } from "@/lib/built-resume-actions";
import { listResumes, type ResumeItem } from "@/lib/resume-actions";

import { BuiltResumeRow } from "./built-resume-row";
import { DuplicateResumeDialog } from "./duplicate-resume-dialog";
import { ResumesHeader } from "./header";
import { ResumeList } from "./resume-list";
import { ShortLabel, UploadedRow, useResumeUpload } from "./upload-resume";

/** The Type filter's options: the list's groups, in their order. */
const TYPES: FacetOption[] = [...RESUME_TYPES];

/** `?type=uploaded,tailored`: the picked types, in the options' order;
 *  none (or none valid) is every type. */
function parseTypes(raw: string | null): ResumeType[] {
  const picked = raw?.split(",") ?? [];
  return TYPES.map((t) => t.value).filter((v) => picked.includes(v)) as ResumeType[];
}

/** The list's orders, in `?sort=`: Last Edited (newest first, the
 *  default, with no `?sort=`), Oldest First, and Name (A to Z). An upload
 *  dates from its upload, a built resume from its last edit. */
type Sort = "edited" | "oldest" | "name";

const SORTS: { value: Sort; label: string }[] = [
  { value: "edited", label: "Last Edited" },
  { value: "oldest", label: "Oldest First" },
  { value: "name", label: "Name (A to Z)" },
];

function parseSort(raw: string | null): Sort {
  return raw === "oldest" || raw === "name" ? raw : "edited";
}

/** One resume of either kind, as the list orders and filters it. */
type Row =
  | {
      key: string;
      type: "uploaded";
      name: string;
      at: string;
      text: string;
      primary: boolean;
      upload: ResumeItem;
    }
  | {
      key: string;
      type: "generated" | "tailored";
      name: string;
      at: string;
      text: string;
      primary: boolean;
      built: BuiltResume;
    };

/**
 * The Resumes view of Resumes & Experiences: its header, then one list of
 * every resume the student has (KAN-362), uploaded, generated (the base
 * resumes, KAN-207) and tailored (KAN-217), in the order the Sort dropdown
 * picks (`SortMenu`, KAN-366; newest first by default), each as its
 * card with its star, Rename, Download and Delete, in a card that scrolls
 * inside itself (./resume-list.tsx). Every card acts alike, so one list
 * holds them all; each says what it is in its own line ("Uploaded …",
 * "Last edited …", "For <posting>").
 *
 * The list is grouped by type, as Notion's Group by draws one (KAN-404):
 * Uploaded, Generated, then Tailored, the Type filter's order, each under
 * a heading with its name in a pill and its count, which folds it away
 * (`?collapsed=`). Search, Type and Sort apply to every row first, then
 * each row falls into its group, the order runs inside each group, the
 * starred resume leads its own, and a group with no row left hides. The
 * list is one scroll, five cards high (./resume-list.tsx): no scroll box
 * per group and no Show N More, which the user turned down. Ungrouped,
 * the 5 uploads sank under the tailored resumes, which have no cap, and a
 * student needed the Type filter to find their own file; three stacked
 * cards (below) had no search over all.
 *
 * It is laid out as the Applications Tracker is (../applications/page.tsx
 * and filter-bar.tsx), so the two read as one app: a search over the
 * names and the postings on its own row, then the Type filter
 * (`FieldFacet`, the Applications list's dropdown) and Sort, with Upload Resume
 * (./upload-resume.tsx) and Generate Resume at the right, then the list,
 * or an `EmptyState` in its place. The type and the order are the URL's
 * (`?type=`, `?sort=`), moved in place and replacing the entry
 * (`useShallowPush`), so a reload or a shared link keeps them and a tick
 * is not a step of Back. The
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
 * would hide it is cleared and Generated opens, so it shows at the top
 * of Generated, under the starred resume if that is there. Generate has no limit:
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
  const sort = parseSort(params.get("sort"));
  // `?collapsed=tailored`: the folded groups (KAN-404), named as the
  // types are; none is every group open.
  const collapsed = parseTypes(params.get("collapsed"));

  // The type, the sort and the folded groups ride in the URL together,
  // each left out at its default, replacing the entry so a tick is not a
  // step of Back.
  function move(next: { types?: ResumeType[]; sort?: Sort; collapsed?: ResumeType[] }) {
    const search = new URLSearchParams();
    const t = next.types ?? types;
    const o = next.sort ?? sort;
    const c = next.collapsed ?? collapsed;
    if (t.length > 0) search.set("type", t.join(","));
    if (o !== "edited") search.set("sort", o);
    if (c.length > 0) search.set("collapsed", c.join(","));
    const qs = search.toString();
    push(qs ? `/resumes?${qs}` : "/resumes", undefined, { replace: true });
  }
  const setTypes = (next: ResumeType[]) => move({ types: next });

  // Both lists, every time: one primary star spans them.
  async function reload() {
    const [built, uploads] = await Promise.all([listBuiltResumes(), listResumes()]);
    if (built.data) setResumes(built.data);
    if (!uploads.error) setUploaded(uploads.resumes);
    setError(built.error ?? uploads.error);
  }

  // A deleted resume leaves the list first and the delete runs behind it
  // (KAN-388). A failed delete ends the transition with the row still in
  // its list, so it comes back, with the error above the list: its own
  // error line went with it. A delete that worked drops the row from its
  // list before the reload, which a failed reload would otherwise undo;
  // the reload still runs, since the star can move.
  const [gone, hide] = useOptimistic<string[], string>([], (keys, key) => [...keys, key]);
  function remove(key: string, send: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      hide(key);
      const { error } = await send();
      if (error) return setError(error);
      setUploaded((rows) => rows.filter((r) => `uploaded:${r.id}` !== key));
      setResumes((rows) => rows.filter((r) => `built:${r.id}` !== key));
      await reload();
    });
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
    // The new resume shows: a Type filter that hides it is cleared, and its
    // group opens.
    const hidden = types.length > 0 && !types.includes("generated");
    if (hidden || collapsed.includes("generated")) {
      move({ types: hidden ? [] : types, collapsed: collapsed.filter((g) => g !== "generated") });
    }
  }

  function toggle(group: ResumeType) {
    move({
      collapsed: collapsed.includes(group)
        ? collapsed.filter((g) => g !== group)
        : [...collapsed, group],
    });
  }

  const rows: Row[] = [
    ...uploaded.map((r) => ({
      key: `uploaded:${r.id}`,
      type: "uploaded" as const,
      name: r.original_filename ?? "Resume",
      at: r.created_at ?? "",
      text: r.original_filename ?? "Resume",
      primary: r.is_default,
      upload: r,
    })),
    ...resumes.map((r) => ({
      key: `built:${r.id}`,
      type: r.job_posting_id ? ("tailored" as const) : ("generated" as const),
      name: r.name,
      at: r.edited_at,
      text: `${r.name} ${r.posting_title ?? ""} ${r.posting_company ?? ""}`,
      primary: r.is_default,
      built: r,
    })),
  ].filter((row) => !gone.includes(row.key));
  const words = searchWords(query);
  const shown = rows
    .filter((row) => types.length === 0 || types.includes(row.type))
    .filter((row) => matches(row.text, words))
    .sort(
      (a, b) =>
        // The starred resume leads its group, whatever the order.
        Number(b.primary) - Number(a.primary) ||
        (sort === "name"
          ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
          : (Date.parse(b.at || "0") - Date.parse(a.at || "0")) * (sort === "oldest" ? -1 : 1)),
    );

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
        {/* Below 42rem the row is two even rows, the dropdowns, then the
            buttons; wrapped as one flex row it left the buttons at the
            right of a line of their own. */}
        <div className="@container">
          <div className="grid grid-cols-2 items-center gap-2 @2xl:flex">
            <FieldFacet
              label="Type"
              Icon={TagIcon}
              options={TYPES}
              values={types}
              onChange={(values) => setTypes(values as ResumeType[])}
              className="min-w-36"
            />
            <SortMenu value={sort} onChange={(next) => move({ sort: next })} />
            <div className="col-span-2 grid grid-cols-2 gap-2 @2xl:ml-auto @2xl:flex">
              {upload.button}
              <Button size="sm" onClick={generate} disabled={generating}>
                <FileTextIcon aria-hidden className="size-4" />
                {generating ? "Generating…" : <ShortLabel verb="Generate" />}
              </Button>
            </div>
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
          {TYPES.map(({ value, label }) => {
            // The file in flight is the first card of its group, which
            // stays open while it uploads.
            const pending = value === "uploaded" && upload.pending;
            const rows = shown.filter((row) => row.type === value);
            if (rows.length === 0 && !pending) return null;
            return (
              <ResumeGroup
                key={value}
                label={label}
                count={rows.length}
                open={!collapsed.includes(value as ResumeType) || Boolean(pending)}
                onToggle={() => toggle(value as ResumeType)}
              >
                {pending}
                {rows.map((row) =>
                  row.type === "uploaded" ? (
                    <UploadedRow
                      key={row.key}
                      resume={row.upload}
                      reload={reload}
                      onDelete={(send) => remove(row.key, send)}
                    />
                  ) : (
                    <BuiltResumeRow
                      key={row.key}
                      resume={row.built}
                      reload={reload}
                      onDelete={(send) => remove(row.key, send)}
                    />
                  ),
                )}
              </ResumeGroup>
            );
          })}
        </ResumeList>
      )}
      <DuplicateResumeDialog message={duplicate} onClose={() => setDuplicate(null)} />
    </>
  );
}

/**
 * The list's order, beside the Type filter (KAN-366): one pick of three,
 * drawn as the filter's dropdown is (`facetClasses`), its button naming the
 * order in force. It never takes the filter's brand tint, which marks a
 * filter holding a pick: an order is always in force. A dropdown, not
 * the Jobs page's Sort By pills: the header already holds the Resumes or
 * Experiences pills, and two pill rows read as one kind of choice.
 */
function SortMenu({ value, onChange }: { value: Sort; onChange: (next: Sort) => void }) {
  const current = SORTS.find((s) => s.value === value) ?? SORTS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Sort by ${current.label}`}
        className={facetClasses(false, "min-w-36")}
      >
        <FacetLabel Icon={ArrowsDownUpIcon} label={current.label} active={false} count={0} />
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max min-w-(--anchor-width)">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as Sort)}>
          {SORTS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
