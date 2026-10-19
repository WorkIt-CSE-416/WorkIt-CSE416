import "server-only";

import { apiGet } from "@/lib/api";

type Requirement = {
  kind: "graduation_window" | "degree" | "sponsorship" | "citizenship" | "clearance";
  evidence: string;
  summary: string | null;
  importance: "required" | "preferred" | "stated";
};

const LABELS = {
  degree: "Education",
  graduation_window: "Graduation",
  sponsorship: "Work authorization",
  citizenship: "Citizenship",
  clearance: "Security clearance",
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

  // One row per topic, with original wording so alternatives and negation survive.
  const groups = Object.entries(LABELS).flatMap(([kind, label]) => {
    const statements = requirements.filter((item) => item.kind === kind && item.evidence.trim());
    const priority = { required: 0, stated: 1, preferred: 2 };
    const evidence = [
      ...new Map(
        statements.map((item) => [
          `${item.importance}:${item.evidence.trim()}`,
          { ...item, evidence: item.evidence.trim() },
        ]),
      ).values(),
    ].sort((a, b) => priority[a.importance] - priority[b.importance]);
    if (evidence.length === 0) return [];
    return [
      {
        kind,
        label,
        evidence,
      },
    ];
  });

  if (groups.length === 0 && minYearsExperience == null) return null;

  return (
    <section
      aria-labelledby="key-requirements-title"
      className="border-border mt-6 rounded-xl border p-4"
    >
      <h2 id="key-requirements-title" className="text-subtitle text-ink font-semibold">
        Key Requirements
      </h2>
      <dl className="mt-4 flex flex-col gap-4">
        {groups.map(({ kind, label, evidence }) => (
          <div key={kind}>
            <dt className="text-body text-ink font-semibold">{label}</dt>
            <dd className="text-body text-ink mt-1">
              <p>
                {evidence[0].summary || evidence[0].evidence}
                {evidence[0].importance === "preferred" && " (preferred)"}
              </p>
              {(evidence.length > 1 || evidence[0].summary) && (
                <details className="mt-2">
                  <summary className="text-brand cursor-pointer">More from the posting</summary>
                  {evidence.slice(evidence[0].summary ? 0 : 1).map((statement) => (
                    <p key={`${statement.importance}:${statement.evidence}`} className="mt-2">
                      {statement.evidence}
                      {statement.importance === "preferred" && " (preferred)"}
                    </p>
                  ))}
                </details>
              )}
            </dd>
          </div>
        ))}
        {minYearsExperience != null && (
          <div>
            <dt className="text-body text-ink font-semibold">Experience</dt>
            <dd className="text-body text-ink mt-1">
              {`${minYearsExperience}+ ${minYearsExperience === 1 ? "year" : "years"}`}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
