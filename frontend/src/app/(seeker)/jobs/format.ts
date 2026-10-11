import { formatDistanceToNowStrict } from "date-fns";

import type { ExperienceLevel, JobType, Recommendation, WorkStyle } from "./data";

/**
 * Turns the schema-shaped fields on `Recommendation` back into the strings
 * the card used to carry pre-formatted. Keeping this separate from `data.ts`
 * is what stops the fixtures from re-hardcoding display text the way the
 * mockup-only version did.
 */

const JOB_TYPE_LABEL: Record<JobType, string> = {
  full_time: "Full-Time",
  part_time: "Part-Time",
  contract: "Contract",
};

const WORK_STYLE_LABEL: Record<WorkStyle, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-Site",
};

const EXPERIENCE_LABEL: Record<ExperienceLevel, string> = {
  // "Intern", as Jobright prints the level: the job type beside it already
  // reads "Internship".
  internship: "Intern",
  new_grad: "New Grad",
  experienced: "Experienced",
};

const countryName = new Intl.DisplayNames(["en"], { type: "region" });

export function formatJobType(jobType: JobType) {
  return JOB_TYPE_LABEL[jobType];
}

export function formatWorkStyle(workStyle: WorkStyle) {
  return WORK_STYLE_LABEL[workStyle];
}

export function formatExperienceLevel(level: ExperienceLevel) {
  return EXPERIENCE_LABEL[level];
}

export function formatLocation(city: string | null, country: string | null) {
  if (!city || !country) return "Remote";
  try {
    return `${city}, ${countryName.of(country) ?? country}`;
  } catch {
    return `${city}, ${country}`;
  }
}

/** "US" -> "United States", with no city — a Remote posting that names a
 *  country a candidate must be based in but, being remote, has no office
 *  city to go with it. Kept separate from `formatLocation` rather than
 *  folded into its `!city` branch: that branch is "Remote" full stop, used
 *  when there is no location information at all, and callers that do have a
 *  country need to tell the two states apart. */
export function formatCountry(country: string) {
  try {
    return countryName.of(country) ?? country;
  } catch {
    return country;
  }
}

/** US states, DC and Puerto Rico by name, lowercased, to their postal codes. */
const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "puerto rico": "PR",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

/** The ways postings name the US as a country, lowercased, dots dropped. */
const US_NAMES = new Set(["united states", "united states of america", "usa", "us"]);

/** What separates one place from the next in a scraped location: "Bellevue,
 *  WA; New York, NY" or "Austin | Remote". Not a slash, which postings use
 *  inside one place ("Remote/Hybrid if local to Maryland"). */
const PLACE_SEPARATOR = /\s*(?:;|\||•)\s*/;

/** One place as a job board would print it: "Philadelphia, Pennsylvania,
 *  United States" is "Philadelphia, PA", "Mountain View, CA, USA" is
 *  "Mountain View, CA". A state right after a city, ending the place, is
 *  shortened to its code (in a list of cities, "New York" is a city), and
 *  the US dropped once a city or state comes before it. A remote place keeps
 *  its country, since "Remote, US" says who may apply. Anything else (a city
 *  abroad, "San Francisco" with no state) is printed as the posting wrote it:
 *  only the text is tidied, never a place guessed at. */
function tidyPlace(place: string): string {
  const parts = place
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const remote = parts.some((part) => /\bremote\b/i.test(part));
  const kept = parts.filter(
    (part, i) => remote || i === 0 || !US_NAMES.has(part.toLowerCase().replaceAll(".", "")),
  );
  // Only a "City, State" place: in a list of cities ("San Francisco,
  // Seattle, New York") New York is a city, and it prints as written.
  return kept
    .map((part, i) =>
      i === 1 && kept.length === 2 ? (US_STATES[part.toLowerCase()] ?? part) : part,
    )
    .join(", ");
}

/**
 * A scraped location's places, each tidied (tidyPlace), in the posting's
 * order and without repeats. Empty for no location. The board's text is
 * kept as written in the database (`location_raw`); this only changes how it
 * reads, so the Location filter, which reads the resolver's codes, is
 * untouched (KAN-171).
 */
export function placesOf(location: string | null): string[] {
  if (!location) return [];
  const places = location.split(PLACE_SEPARATOR).map(tidyPlace).filter(Boolean);
  return [...new Set(places)];
}

/** The card's location: its one place, or its first and how many more
 *  ("Bellevue, WA +2 more"). A posting listed in several offices used to
 *  print them all on one line, cut off at the card's column. Null for none. */
export function formatPlaces(location: string | null): string | null {
  const places = placesOf(location);
  if (places.length === 0) return null;
  return places.length === 1 ? places[0] : `${places[0]} +${places.length - 1} more`;
}

/**
 * A posting's location as one string: city and country when it has a city,
 * the country alone when it doesn't (a Remote role restricted to, say, the
 * US), and null only when there is no location information at all.
 *
 * Shared by the feed card and the expanded view so the two cannot describe the
 * same posting's location differently.
 */
export function formatJobLocation(job: Pick<Recommendation, "locationCity" | "locationCountry">) {
  if (job.locationCity) return formatLocation(job.locationCity, job.locationCountry);
  return job.locationCountry ? formatCountry(job.locationCountry) : null;
}

const PERIOD_LABEL = { hour: "hr", week: "wk", month: "mo", year: "yr" } as const;

export function formatSalary(
  job: Pick<Recommendation, "salary" | "salaryMin" | "salaryMax" | "salaryCurrency"> & {
    /** Wider than `Recommendation`'s: a scraped internship can pay by the month. */
    salaryPeriod: keyof typeof PERIOD_LABEL;
  },
) {
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: job.salaryCurrency,
    /* 2, not 0: compact notation only abbreviates above four digits, so an
       hourly rate under $1,000 prints uncompacted — at 0 digits, cents like
       $27.50/hr would silently round to $28/hr. A whole-dollar Year salary
       never had a fractional part, so raising this changes nothing for it. */
    maximumFractionDigits: 2,
    notation: "compact",
  });

  const period = PERIOD_LABEL[job.salaryPeriod];
  // A range whose ends meet is one amount: scraped pay always arrives as a
  // range (scraper/workit_scraper/feed.py `salary`).
  const range =
    job.salaryMin != null && job.salaryMax != null && job.salaryMin !== job.salaryMax
      ? `${fmt.format(job.salaryMin)} - ${fmt.format(job.salaryMax)}`
      : fmt.format(job.salary ?? job.salaryMin ?? 0);

  return `${range}/${period}`;
}

/** "2+ yrs exp", as the composer's preview prints it. */
export function formatMinYears(years: number) {
  return `${years}+ yrs exp`;
}

export function formatPosted(uploadedAt: string) {
  return `Posted ${formatDistanceToNowStrict(new Date(uploadedAt))} ago`;
}
