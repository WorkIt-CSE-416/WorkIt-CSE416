"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type ChangeEventHandler } from "react";

import { SearchField } from "@/components/ui/search-field";

import { rememberedJobs } from "../jobs/[jobId]/page-actions";
import { restoreScrollOn } from "../scroll-memory";

/**
 * The job search field, holding the query this page was searched with
 * (./job-search.tsx), so on a results page the field still says what was
 * searched for and a second search starts from the first rather than from
 * nothing. On the Jobs page it is empty.
 *
 * Its own client component because the Jobs page's split frame is drawn by a
 * layout, and a layout receives no searchParams.
 *
 * Controlled, and reset whenever the URL's query changes (React's "adjust
 * state while rendering" pattern), rather than remounted with a `key`, so on
 * /search the field the seeker just pressed Enter in keeps its focus and caret
 * while the results arrive.
 *
 * Clearing it on /search with the field's cross (or Escape) ends the search:
 * the page goes back to the Jobs list from before it, filters, Load More
 * pages and scroll place and all, as "Back to Jobs" does (asked for
 * 2026-10-13, KAN-228). Only the cross: it empties the field with an input
 * event that has no inputType, which typing and deleting always carry, so
 * backspacing to nothing to type a new search stays on the results.
 */
export function QueryField({ id, autoFocus }: { id: string; autoFocus?: boolean }) {
  /* useSearchParams suspends on a prerendered route, and a build fails without
     a boundary around it. Every seeker route renders per request today (the
     layout reads cookies), so the fallback, the same field empty, should
     never show; the boundary keeps the build safe if that changes. */
  return (
    <Suspense fallback={<Field id={id} autoFocus={autoFocus} />}>
      <FieldWithQuery id={id} autoFocus={autoFocus} />
    </Suspense>
  );
}

function FieldWithQuery({ id, autoFocus }: { id: string; autoFocus?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = pathname === "/search" ? (searchParams.get("q") ?? "") : "";

  const [value, setValue] = useState(query);
  const [shown, setShown] = useState(query);
  if (shown !== query) {
    setShown(query);
    setValue(query);
  }

  return (
    <Field
      id={id}
      autoFocus={autoFocus}
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        const cleared = !(event.nativeEvent as InputEvent).inputType;
        if (pathname === "/search" && event.target.value === "" && cleared) {
          const jobs = rememberedJobs();
          restoreScrollOn(jobs);
          router.push(jobs);
        }
      }}
    />
  );
}

/** The field itself: everything but the value is the same wherever it is. */
function Field(props: {
  id: string;
  autoFocus?: boolean;
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <SearchField
      label="Search Jobs"
      name="q"
      placeholder="Search jobs"
      enterKeyHint="search"
      {...props}
    />
  );
}
