import { CloseIcon } from "@/components/icons";
import { ChipLink } from "@/components/ui/chip";

import {
  EXPERIENCE_OPTIONS,
  filterEntries,
  JOB_TYPE_OPTIONS,
  seasonLabel,
  WORKPLACE_OPTIONS,
  type FeedFilters,
} from "../jobs/filter-query";
import type { SearchFact } from "../jobs/listings";

/**
 * The filters a search's own words set (KAN-308): "remote" is the Remote
 * work style, "intern" the internships, "summer 2027" a start term
 * (docs/search.md, the facts). They narrow the results as the filter row
 * does, but the row never showed them, so a search could be narrowed by
 * nothing the page named, and "remote" with Hybrid ticked found no role with
 * no reason given. Each is a chip here, in the row's own words, and its
 * cross is a link to the same search without the words that set it, the
 * row's filters kept.
 *
 * Chips beside the row rather than ticks in it: a fact matches a little more
 * than its filter (a title saying "Remote" or "Summer 2027" counts too), so
 * ticking Remote for it would claim the row's narrower rule.
 *
 * A server component: every chip is a plain link, as the row's picks are
 * URL state.
 */
export function SearchFacts({ facts, filters }: { facts: SearchFact[]; filters: FeedFilters }) {
  if (facts.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <p className="text-meta text-ink-meta">Your search also filters by</p>
      <ul className="contents">
        {facts.map((fact) => {
          const label = factLabel(fact);
          return (
            <li key={`${fact.facet}:${fact.value}`}>
              <ChipLink
                pressed
                href={hrefWithout(fact, filters)}
                aria-label={`Remove ${label} from your search`}
              >
                {label}
                <CloseIcon />
              </ChipLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A fact in the words the filter row uses for it. "intern" is the student
 *  level, which the row offers as Job Type's Internship (KAN-284). A bare
 *  year is any start that year, not seasonLabel's "season not stated". */
function factLabel({ facet, value }: SearchFact): string {
  const named = (options: readonly { value: string; label: string }[], key = value) =>
    options.find((option) => option.value === key)?.label ?? value;
  if (facet === "work_style") return named(WORKPLACE_OPTIONS);
  if (facet === "level") {
    return value === "student" ? named(JOB_TYPE_OPTIONS, "internship") : named(EXPERIENCE_OPTIONS);
  }
  return value.includes("-") ? seasonLabel(value) : value;
}

/** The search without this fact's words, the row's filters kept. When they
 *  were the whole search there is nothing left to search for, so it is the
 *  Jobs page under the same filters (with its default order when there are
 *  none: a bare /jobs brings back the saved preferences, as ../jobs/filters
 *  explains). */
function hrefWithout(fact: SearchFact, filters: FeedFilters): string {
  const kept = filterEntries(filters);
  if (fact.without) return `/search?${new URLSearchParams([["q", fact.without], ...kept])}`;
  return `/jobs?${new URLSearchParams(kept.length > 0 ? kept : [["sort", "match"]])}`;
}
