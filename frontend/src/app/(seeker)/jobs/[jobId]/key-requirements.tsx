import "server-only";

import { apiGet } from "@/lib/api";

import { KeyRequirementsVisibility } from "./key-requirements-visibility";

export type Requirement = {
  kind:
    | "graduation_window"
    | "degree"
    | "sponsorship"
    | "citizenship"
    | "clearance"
    | "skills"
    | "experience"
    | "enrollment"
    | "work_arrangement"
    | "availability"
    | "gpa";
  evidence: string;
  summary: string | null;
  importance: "required" | "preferred" | "stated";
};

const LABELS = {
  degree: "Education",
  graduation_window: "Graduation",
  enrollment: "Enrollment",
  experience: "Experience",
  gpa: "GPA",
  sponsorship: "Work authorization",
  citizenship: "Citizenship",
  clearance: "Security clearance",
  work_arrangement: "Work arrangement",
  availability: "Availability",
  skills: "Key skills",
};

/**
 * What the posting asks for (GET /jobs/{id}/requirements): the API's
 * rule-based reading of its description. The job page's loader starts it
 * beside the posting's own read (./job-view.tsx, loadJobView); read here,
 * once the card rendered, it only began after the other five reads had all
 * answered, and the page waited for it on top of them (about 120-190 ms).
 *
 * NEVER REJECTS. The card is an optional summary: on any failure it answers
 * an empty list, the card draws nothing and the full posting still shows.
 * The loader's Promise.all relies on that, since one rejection there would
 * fail the whole page.
 */
export async function getRequirements(jobId: string): Promise<Requirement[]> {
  try {
    const response = await apiGet(`/jobs/${encodeURIComponent(jobId)}/requirements`);
    return response.ok ? ((await response.json()) as Requirement[]) : [];
  } catch {
    // The full posting remains available if this optional summary cannot load.
    return [];
  }
}

/** The Key Requirements card, drawn from getRequirements' list. */
export function KeyRequirementsCard({
  requirements: read,
  minYearsExperience,
}: {
  /** getRequirements(), read by the page's loader. */
  requirements: Requirement[];
  minYearsExperience: number | null;
}) {
  // A copy, since the stated years may be added to it below: the list is
  // the loader's, and a render never changes what it was handed.
  const requirements = [...read];

  if (
    minYearsExperience != null &&
    !requirements.some(
      (item) =>
        item.kind === "experience" &&
        item.importance !== "preferred" &&
        (item.summary === `${minYearsExperience}+ years of experience` ||
          item.summary === `${minYearsExperience} years of experience`),
    )
  ) {
    requirements.push({
      kind: "experience",
      summary: `${minYearsExperience}+ ${minYearsExperience === 1 ? "year" : "years"}`,
      evidence: "",
      importance: "stated",
    });
  }

  // Show concise, supported takeaways instead of repeating the description.
  const groups = Object.entries(LABELS).flatMap(([kind, label]) => {
    const statements = requirements.filter((item) => item.kind === kind && item.summary?.trim());
    const priority = { required: 0, stated: 1, preferred: 2 };
    const evidence = [
      ...new Map(
        statements.map((item) => [
          `${item.importance}:${item.summary}:${item.evidence.trim()}`,
          { ...item, evidence: item.evidence.trim() },
        ]),
      ).values(),
    ].sort((a, b) => priority[a.importance] - priority[b.importance]);
    if (evidence.length === 0) return [];
    const highlights = evidence.filter(
      (item, index) => evidence.findIndex((other) => other.summary === item.summary) === index,
    );
    return [
      {
        kind,
        label,
        highlights,
      },
    ];
  });

  if (groups.length === 0) return null;

  return (
    <KeyRequirementsVisibility>
      <dl className="mt-4 flex flex-col gap-4">
        {groups.map(({ kind, label, highlights }) => (
          <div key={kind}>
            <dt className="text-body text-ink font-semibold">{label}</dt>
            <dd className="text-body text-ink mt-1">
              <p>
                {highlights
                  .map(
                    (item) =>
                      `${item.summary}${item.importance === "preferred" ? " (preferred)" : ""}`,
                  )
                  .join(" · ")}
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </KeyRequirementsVisibility>
  );
}
