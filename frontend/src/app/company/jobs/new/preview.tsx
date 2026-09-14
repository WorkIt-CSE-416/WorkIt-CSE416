import { BriefcaseIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { cn } from "@/lib/cn";

import { EXAMPLE, formatLocation, type JobDraft, type SavedLocation } from "./data";

/**
 * What a seeker will see, redrawn on every keystroke.
 *
 * It is built from the same primitives the seeker's own screens use —
 * <CompanyTile>, <Badge variant="tag">, <Card> — rather than from a second set
 * that merely resembles them, which is the only way a preview stays true. When
 * the search result card is restyled this follows it.
 *
 * THE COMPANY MARK is a glyph rather than a logo for the reason given in
 * ui/company-tile.tsx: the repo ships no image for an employer. The mockup
 * draws the company's initial in the tile, which is the same stand-in one step
 * further along; it becomes a real <Image> when uploads exist, here and on the
 * seeker's cards at the same time.
 *
 * APPLY NOW IS DISABLED, and that is the honest state rather than a styling
 * choice. There is nothing to apply to yet — the posting is not published, and
 * this is a picture of one. It also keeps the preview from competing with the
 * form: the real primary action on this screen is Continue, and a live-looking
 * Apply Now beside it would be the louder of the two.
 *
 * Base UI renders it with a real `disabled` attribute — it also writes
 * tabindex="0", which a disabled form control ignores — so it cannot be
 * clicked or submitted, not merely dimmed.
 */
export function JobPreview({ draft, locations }: { draft: JobDraft; locations: SavedLocation[] }) {
  const title = draft.title.trim() || EXAMPLE.title;
  const location = locationLabel(draft, locations);
  const description = draft.description.trim();
  const salary = formatSalary(draft);

  return (
    <Card padding="none">
      <div className="p-4.5">
        <CompanyTile Icon={BriefcaseIcon} size="md" tone="brand" />

        <h3 className="text-title text-ink mt-3">{title}</h3>
        <p className="text-note text-ink-meta mt-0.5">{location}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge variant="tag">{salary}</Badge>
          <Badge variant="tag">{draft.jobType}</Badge>
        </div>
      </div>

      <div className="border-border-subtle border-t p-4.5">
        <h4 className="text-label text-ink">About the Role</h4>

        {description ? (
          /* whitespace-pre-line so the paragraph breaks the recruiter typed
             survive. The field's hint promises Markdown; nothing renders it
             yet, so this shows the text as written rather than as marked up —
             see the note in ./composer.tsx. */
          <p className="text-body text-ink-muted mt-2 whitespace-pre-line">{description}</p>
        ) : (
          <RuledLines />
        )}

        <Button disabled className="mt-4 w-full">
          Apply Now
        </Button>
      </div>
    </Card>
  );
}

/**
 * Grey bars standing in for a description nobody has written.
 *
 * Not <Skeleton>: that one pulses, which means "this is loading and will
 * arrive". Nothing is loading here — the field is empty, and it stays empty
 * until someone types. A still bar says the paragraph goes here; a pulsing one
 * would say it is on its way.
 *
 * The ragged last-line widths are what make five bars read as prose rather than
 * as a table.
 */
const LINE_WIDTHS = ["w-full", "w-[72%]", "w-[58%]", "w-full", "w-[64%]"];

function RuledLines() {
  return (
    <div aria-hidden="true" className="mt-3 flex flex-col gap-2">
      {LINE_WIDTHS.map((width, index) => (
        <span key={index} className={cn("bg-border-subtle block h-2 rounded-full", width)} />
      ))}
    </div>
  );
}

/**
 * Where a location is read from: the saved location a recruiter picked, or
 * "Remote" when Work Style says so — Remote never has a location at all, the
 * same NULL/NULL convention `job_postings` uses.
 */
function locationLabel(draft: JobDraft, locations: SavedLocation[]) {
  if (draft.workStyle === "Remote") return "Remote";

  const saved = locations.find((location) => location.id === draft.locationId);
  return saved ? formatLocation(saved.city, saved.country) : EXAMPLE.location;
}

/**
 * "$100k - $150k/yr" from the salary fields, respecting the Exact/Range
 * toggle and the chosen currency and period.
 *
 * Each end of a range is handled separately because a half-filled pair is a
 * real state — a recruiter types the floor before the ceiling — and a band
 * that reads "$100k - $0k" in between would be worse than no band. With
 * nothing filled the example band stands in, matching what the inputs
 * suggest.
 */
function formatSalary(draft: JobDraft) {
  const period = draft.salaryPeriod === "Year" ? "yr" : "hr";

  if (draft.salaryType === "Exact figure") {
    const amount = Number(draft.salary);
    if (!amount) return `${compact(EXAMPLE.salaryMin, "USD")}/yr`;
    return `${compact(amount, draft.currency)}/${period}`;
  }

  const min = Number(draft.salaryMin);
  const max = Number(draft.salaryMax);

  if (!min && !max) {
    return `${compact(EXAMPLE.salaryMin, "USD")} - ${compact(EXAMPLE.salaryMax, "USD")}/yr`;
  }
  if (!max) return `From ${compact(min, draft.currency)}/${period}`;
  if (!min) return `Up to ${compact(max, draft.currency)}/${period}`;
  /* Typed out of order — show the band, not the mistake. The form is what
     should complain about min > max, once it validates anything. */
  if (min > max)
    return `${compact(max, draft.currency)} - ${compact(min, draft.currency)}/${period}`;

  return `${compact(min, draft.currency)} - ${compact(max, draft.currency)}/${period}`;
}

/** 100000, "USD" -> "$100K". `Intl` picks the right symbol for the currency
 *  a recruiter chose rather than assuming USD, and `compact` notation is what
 *  gives the one-decimal "$125K" instead of writing every zero out. */
function compact(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}
