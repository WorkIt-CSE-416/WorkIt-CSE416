import { format } from "date-fns";

import { JobPostingCard } from "@/components/job-posting-card";

import {
  EXAMPLE,
  formatCountry,
  formatLocation,
  parseCloseDate,
  type JobDraft,
  type SavedLocation,
} from "./data";

/**
 * What a seeker will see, redrawn on every keystroke — built from the same
 * <JobPostingCard> the seeker's own Jobs feed renders (see
 * @/components/job-posting-card.tsx), rather than a second card that merely
 * resembled it. When the seeker card changes, this one changes with it for
 * free.
 *
 * NO ACTIONS ROW, Apply Now included: this is a picture of a posting, not an
 * interactive one, and there is nothing to apply to, save, or ask WorkIt about
 * yet. Passing nothing for `actions` is what drops the footer row entirely
 * rather than showing it disabled — the previous disabled Apply Now button
 * was still a competing affordance on a screen whose one live action is
 * Continue/Publish.
 *
 * NO COMPANY OR TITLE LINK either, for the same reason: <JobPostingCard>
 * paints both in the same ink either way, but a real link here would navigate
 * away from an in-progress draft that lives only in this component's state.
 */
export function JobPreview({ draft, locations }: { draft: JobDraft; locations: SavedLocation[] }) {
  const title = draft.title.trim() || EXAMPLE.title;
  const location = locationLabel(draft, locations);
  const salary = formatSalary(draft);
  const minYearsExperience = draft.minYearsExperience
    ? `${draft.minYearsExperience}+ yrs exp`
    : null;
  /** No `uploadedAt` exists until the posting is actually published — the
   *  preview assumes that happens the moment Publish is pressed. */
  const closeDate = parseCloseDate(draft.closesAt);
  const timing = closeDate ? `Closes ${format(closeDate, "MMM d, yyyy")}` : "Posted just now";

  return (
    <JobPostingCard
      job={{
        company: EXAMPLE.company,
        title,
        timing,
        location,
        jobType: draft.jobType,
        salary,
        workStyle: draft.workStyle,
        experienceLevel: draft.experienceLevel,
        minYearsExperience,
      }}
    />
  );
}

/**
 * Where a location is read from: the saved location a recruiter picked, or
 * `null` to drop the fact entirely.
 *
 * Remote no longer means "no location, full stop" — a lot of remote postings
 * mean "remote, but based in the United States", which is a real constraint
 * worth showing. So a Remote draft with a location picked shows just that
 * location's COUNTRY, not its city: a remote hire isn't tied to "Austin"
 * specifically the way an office is, only to the country/timezone it sits in.
 * A Remote draft with nothing picked stays `null` — open to anywhere, the
 * same as before — rather than falling back to `EXAMPLE.location`, since
 * "optional and blank" should read as blank, not as San Francisco.
 */
function locationLabel(draft: JobDraft, locations: SavedLocation[]) {
  const saved = locations.find((location) => location.id === draft.locationId);

  if (draft.workStyle === "Remote") {
    return saved ? formatCountry(saved.country) : null;
  }

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
 * suggest — scaled to Pay Period (an Hour draft gets `EXAMPLE.hourlyMin`/`Max`,
 * not the Year-scale figures) and in the currency actually selected, not a
 * hardcoded USD: the example is meant to look like a plausible number in the
 * mode the recruiter is already in, not a stand-in for a different one.
 */
function formatSalary(draft: JobDraft) {
  const isHourly = draft.salaryPeriod === "Hour";
  const period = isHourly ? "hr" : "yr";
  const exampleMin = isHourly ? EXAMPLE.hourlyMin : EXAMPLE.salaryMin;
  const exampleMax = isHourly ? EXAMPLE.hourlyMax : EXAMPLE.salaryMax;

  if (draft.salaryType === "Exact figure") {
    const amount = Number(draft.salary);
    if (!amount) return `${compact(exampleMin, draft.currency)}/${period}`;
    return `${compact(amount, draft.currency)}/${period}`;
  }

  const min = Number(draft.salaryMin);
  const max = Number(draft.salaryMax);

  if (!min && !max) {
    return `${compact(exampleMin, draft.currency)} - ${compact(exampleMax, draft.currency)}/${period}`;
  }
  if (!max) return `From ${compact(min, draft.currency)}/${period}`;
  if (!min) return `Up to ${compact(max, draft.currency)}/${period}`;
  /* Typed out of order — show the band, not the mistake. The form is what
     should complain about min > max, once it validates anything. */
  if (min > max)
    return `${compact(max, draft.currency)} - ${compact(min, draft.currency)}/${period}`;

  return `${compact(min, draft.currency)} - ${compact(max, draft.currency)}/${period}`;
}

/** 100000, "USD" -> "$100K"; 27.5, "USD" -> "$27.50". `Intl` picks the right
 *  symbol for the currency a recruiter chose rather than assuming USD, and
 *  `compact` notation is what gives the one-decimal "$125K" instead of
 *  writing every zero out — it only kicks in above four digits, so an hourly
 *  rate under $1,000 prints as a plain, uncompacted amount. The two fraction
 *  digits are for that hourly rate's cents; a whole-dollar Year figure never
 *  had a fractional part to begin with, so raising this from 1 changes
 *  nothing for it. */
function compact(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(amount);
}
