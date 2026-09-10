import { BriefcaseIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { cn } from "@/lib/cn";

import { EXAMPLE, type JobDraft } from "./data";

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
export function JobPreview({ draft }: { draft: JobDraft }) {
  const title = draft.title.trim() || EXAMPLE.title;
  const location = draft.location.trim() || EXAMPLE.location;
  const description = draft.description.trim();
  const salary = salaryBand(draft.salaryMin, draft.salaryMax);

  return (
    <Card padding="none">
      <div className="p-4.5">
        <CompanyTile Icon={BriefcaseIcon} size="md" tone="brand" />

        <h3 className="text-title text-ink mt-3">{title}</h3>
        <p className="text-note text-ink-meta mt-0.5">
          {location} <span aria-hidden="true">·</span> {draft.department}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge variant="tag">{salary}</Badge>
          <Badge variant="tag">{draft.employmentType}</Badge>
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
 * "$100k - $150k" from what is in the two salary inputs.
 *
 * Each end is handled separately because a half-filled pair is a real state —
 * a recruiter types the floor before the ceiling — and a band that reads
 * "$100k - $0k" in between would be worse than no band. With neither end filled
 * the example band stands in, matching what the inputs suggest.
 */
function salaryBand(minInput: string, maxInput: string) {
  const min = Number(minInput);
  const max = Number(maxInput);

  if (!min && !max) return `${compact(EXAMPLE.salaryMin)} - ${compact(EXAMPLE.salaryMax)}`;
  if (!max) return `From ${compact(min)}`;
  if (!min) return `Up to ${compact(max)}`;
  /* Typed out of order — show the band, not the mistake. The form is what
     should complain about min > max, once it validates anything. */
  if (min > max) return `${compact(max)} - ${compact(min)}`;

  return `${compact(min)} - ${compact(max)}`;
}

/** 100000 -> "$100k". Anything under a thousand is written out in full. */
function compact(amount: number) {
  if (amount < 1000) return `$${amount}`;

  /* One decimal only where it says something: $125k, not $125.0k. */
  const thousands = amount / 1000;

  return `$${Number(thousands.toFixed(1))}k`;
}
