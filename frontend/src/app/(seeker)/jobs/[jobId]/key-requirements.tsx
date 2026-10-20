import "server-only";

import { apiGet } from "@/lib/api";

import { KeyRequirementsVisibility } from "./key-requirements-visibility";

type Requirement = {
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

export async function KeyRequirementsCard({
  jobId,
  minYearsExperience,
}: {
  jobId: string;
  minYearsExperience: number | null;
}) {
  let requirements: Requirement[] = [];
  try {
    const response = await apiGet(`/jobs/${encodeURIComponent(jobId)}/requirements`);
    if (response.ok) requirements = (await response.json()) as Requirement[];
  } catch {
    // The full posting remains available if this optional summary cannot load.
  }

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
