import "server-only";

import { GraduationCapIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";

import { getRoleOptions } from "@/app/onboarding/applicant/role-options";
import { Skeleton } from "@/components/shadcn/skeleton";
import { PencilIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading, SectionHeadingSkeleton } from "@/components/ui/section-heading";
import type { Bank } from "@/lib/bank-actions";
import type { Result } from "@/lib/applicant-call";
import { schoolYear } from "@/lib/school-year";

import {
  EXPERIENCE_OPTIONS,
  JOB_TYPE_OPTIONS,
  seasonLabel,
  WORKPLACE_OPTIONS,
  type FeedFilters,
} from "../jobs/filter-query";
import { SECTION_CARD } from "./field-styles";

/**
 * What My Profile reads on the server (KAN-550), each streamed into the
 * client screen (./profile-screen.tsx) in its own <Suspense> from
 * ./page.tsx, so the identity card and Contact & Links never wait for them.
 * The experience bank is read once and shared by the school line and Top
 * Skills.
 *
 * Each says nothing it does not know: a failed read leaves the school line
 * out and says so in the card, never "No skills yet" for a student who has
 * some.
 */

/** How many skills Top Skills shows before "View All". */
const TOP_SKILLS = 12;

/**
 * The identity card's school row, an <li> in its facts list: the latest
 * education entry's school, its degree and field ("B.S., Computer
 * Science"), then the class year and graduation year worked out from its
 * end month (lib/school-year, the rule Application Answers' School Year
 * uses): "Junior · Class of 2027". A line with nothing to say is left out.
 * With no education entry, a link to add one on Experiences.
 */
export async function SchoolLine({ bank }: { bank: Promise<Result<Bank>> }) {
  const { data } = await bank;
  if (!data) return null;
  const schools = data.entries
    .filter((entry) => entry.section === "education")
    .sort((a, b) => (b.end_month ?? "").localeCompare(a.end_month ?? ""));
  const school = schools[0];
  if (!school) {
    return (
      <li>
        <Link
          href="/experiences#section-education"
          className="text-ink hover:text-brand focus-visible:ring-brand-ring flex items-center gap-2.5 rounded-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          <GraduationCapIcon aria-hidden className="size-4 shrink-0" />
          Add Your School
        </Link>
      </li>
    );
  }
  const year = schoolYear(schools, new Date(), {});
  const study = [school.degree, school.field_of_study].filter(Boolean).join(", ");
  const when = [
    year.classYear,
    year.graduation && year.classYear !== "Graduate" && `Class of ${year.graduation.slice(0, 4)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-start gap-2.5">
      <GraduationCapIcon aria-hidden className="text-ink-meta mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        <span className="text-ink block font-medium">{school.title}</span>
        {study && <span className="block">{study}</span>}
        {when && <span className="text-ink-meta block">{when}</span>}
      </span>
    </li>
  );
}

/** The school row while the bank loads: its glyph's place and two bars. */
export function SchoolLineSkeleton() {
  return (
    <li aria-hidden className="flex items-start gap-2.5">
      <Skeleton className="size-4 shrink-0" />
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-28" />
      </span>
    </li>
  );
}

/**
 * Job Preferences and Top Skills, side by side where they fit (as the link
 * cards under them, ./more-of-you.tsx).
 */
export async function ProfileExtras({
  bank,
  preferences,
}: {
  bank: Promise<Result<Bank>>;
  preferences: Promise<FeedFilters | null>;
}) {
  const [{ data, error }, saved, options] = await Promise.all([
    bank,
    preferences,
    getRoleOptions(),
  ]);
  return (
    <div className={EXTRAS_GRID}>
      <JobPreferences saved={saved} options={options} />
      <TopSkills skills={data?.skills.map((skill) => skill.name) ?? null} failed={error != null} />
    </div>
  );
}

const EXTRAS_GRID = "grid gap-4 @3xl/main:grid-cols-2 @4xl/main:grid-cols-1 @6xl/main:grid-cols-2";

/** Both cards while they load, at about their height. */
export function ProfileExtrasSkeleton() {
  return (
    <div className={EXTRAS_GRID}>
      {["Job Preferences", "Top Skills"].map((title) => (
        <Card key={title} as="section" padding="none" aria-label={title} className={SECTION_CARD}>
          <SectionHeadingSkeleton />
          <div aria-hidden className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-3/4" />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Job Preferences: what onboarding saved and Settings' Job Preferences
 * edits (KAN-326), read only here. Its Edit opens that Settings section, so
 * the preferences keep one editor. Roles and places are slugs and codes in
 * the saved filters; their names come from the Jobs page's own options
 * (getRoleOptions), and one the options no longer list prints as saved.
 * `saved` is null both when nothing is saved and when the read failed: the
 * API's read cannot tell the two apart, so the card says only that none
 * show.
 */
function JobPreferences({
  saved,
  options,
}: {
  saved: FeedFilters | null;
  options: Awaited<ReturnType<typeof getRoleOptions>>;
}) {
  const name = (list: { value: string; label: string }[], value: string) =>
    list.find((option) => option.value === value)?.label ?? value;
  const rows = saved
    ? [
        { label: "Roles", value: saved.roles.map((role) => name(options.roles, role)) },
        { label: "Job Type", value: saved.jobTypes.map((type) => name(JOB_TYPE_OPTIONS, type)) },
        {
          label: "Workplace",
          value: saved.workStyles.map((style) => name(WORKPLACE_OPTIONS, style)),
        },
        {
          label: "Experience",
          value: saved.levels.map((level) => name(EXPERIENCE_OPTIONS, level)),
        },
        { label: "Locations", value: saved.places.map((place) => name(options.places, place)) },
        { label: "Start", value: saved.startTerms.map(seasonLabel) },
        { label: "Pay", value: payRange(saved) },
      ].filter((row) => row.value.length > 0)
    : [];

  return (
    <Card as="section" padding="none" aria-labelledby="job-preferences" className={SECTION_CARD}>
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id="job-preferences">Job Preferences</SectionHeading>
        <ButtonLink
          href="/settings/preferences"
          variant="section"
          size="section"
          aria-label="Edit in Settings: Job Preferences"
        >
          <PencilIcon />
          Edit in Settings
        </ButtonLink>
      </div>
      {rows.length > 0 ? (
        <dl className="mt-4 flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-x-4 gap-y-0.5 @lg/main:grid-cols-[6rem_1fr]">
              <dt className="text-label text-ink-meta">{row.label}</dt>
              <dd className="text-body text-ink-muted min-w-0">{row.value.join(", ")}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-body text-ink-meta mt-4">
          No job preferences to show. Set them so the Jobs page starts with your roles and places.
        </p>
      )}
    </Card>
  );
}

/** The saved salary range as a row's one value, "$80,000 – $120,000 a year"
 *  or "$25+ an hour" with no top; empty when neither end is saved. */
function payRange({ minPay, maxPay, payPer }: FeedFilters): string[] {
  if (minPay == null && maxPay == null) return [];
  const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;
  const per = payPer === "hour" ? "an hour" : "a year";
  if (minPay != null && maxPay != null) return [`${dollars(minPay)} – ${dollars(maxPay)} ${per}`];
  if (minPay != null) return [`${dollars(minPay)}+ ${per}`];
  return [`Up to ${dollars(maxPay!)} ${per}`];
}

/**
 * Top Skills: the skills in the experience bank, the ones on the most
 * resumes first. Each upload keeps its own copy of a skill (ADR 0005), so
 * names are counted once, case aside, and a name on more uploads ranks
 * higher; ties keep the bank's order. View All opens Experiences' Skills
 * card, where they are edited.
 */
function TopSkills({ skills, failed }: { skills: string[] | null; failed: boolean }) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const skill of skills ?? []) {
    const key = skill.trim().toLowerCase();
    if (!key) continue;
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { name: skill.trim(), count: 1 });
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  const shown = ranked.slice(0, TOP_SKILLS);

  return (
    <Card as="section" padding="none" aria-labelledby="top-skills" className={SECTION_CARD}>
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id="top-skills">Top Skills</SectionHeading>
        {ranked.length > 0 && (
          <ButtonLink
            href="/experiences#section-skills"
            variant="section"
            size="section"
            aria-label={`View All ${ranked.length} Skills in Experiences`}
          >
            View All
          </ButtonLink>
        )}
      </div>
      {failed ? (
        <p className="text-body text-ink-meta mt-4">
          Your skills didn&apos;t load. Refresh the page to try again.
        </p>
      ) : shown.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {shown.map((skill) => (
            <li key={skill.name}>
              <Badge variant="tag" pill>
                {skill.name}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-meta mt-4">
          No skills yet. Add them in Experiences, or upload a resume to fill them in.
        </p>
      )}
    </Card>
  );
}
