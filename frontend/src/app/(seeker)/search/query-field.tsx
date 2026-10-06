"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, type ChangeEventHandler } from "react";

import { SearchField } from "@/components/ui/search-field";

/**
 * The job search field, holding the query this page was searched with. The
 * top bar and the phone's search sheet both draw it, inside their own GET
 * form to /search, so on a results page the field still says what was
 * searched for and a second search starts from the first rather than from
 * nothing. Anywhere else it is empty.
 *
 * Its own client component because the layout cannot see the query: a layout
 * receives no searchParams, so reading ?q takes useSearchParams.
 *
 * Controlled, and reset whenever the URL's query changes (React's "adjust
 * state while rendering" pattern), rather than remounted with a `key`. The
 * shell stays mounted across a search, so the field the seeker just pressed
 * Enter in keeps its focus and caret while the results arrive, and leaving
 * /search clears it.
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
      onChange={(event) => setValue(event.target.value)}
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
