import "server-only";

import Link from "next/link";

import { apiGet } from "@/lib/api";
import { getAccessToken } from "@/lib/session";

type Item = {
  kind: "graduation_window" | "degree" | "sponsorship";
  label: string;
  importance: "required" | "preferred" | "stated";
  status: "matches" | "potential_mismatch" | "needs_confirmation" | "not_stated";
  explanation: string;
  evidence: string | null;
};

type Checklist = {
  items: Item[];
  description_available: boolean;
};

const STATUS = {
  matches: "Date matches",
  potential_mismatch: "Potential mismatch",
  needs_confirmation: "Needs confirmation",
  not_stated: "Not found in available text",
};

const IMPORTANCE = {
  required: "Required",
  preferred: "Preferred, not required",
  stated: "Statement from the posting",
};

async function loadChecklist(jobId: string): Promise<Checklist | "signed_out" | null> {
  try {
    const token = await getAccessToken();
    if (!token) return "signed_out";

    const response = await apiGet(`/jobs/${encodeURIComponent(jobId)}/eligibility`, token);

    if (!response.ok) {
      throw new Error("Eligibility request failed");
    }

    return (await response.json()) as Checklist;
  } catch {
    return null;
  }
}

export async function EligibilityCard({ jobId }: { jobId: string }) {
  const checklist = await loadChecklist(jobId);

  if (checklist === "signed_out") {
    return (
      <p className="text-body text-ink-meta">
        Sign in to compare this posting with your education.
      </p>
    );
  }

  if (checklist === null) {
    return (
      <p className="text-body text-ink-meta" role="status">
        The eligibility checklist couldn’t load. You can still read the posting and apply.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="eligibility-title"
      className="border-border mt-6 rounded-xl border p-4"
    >
      <h2 id="eligibility-title" className="text-subtitle text-ink font-semibold">
        Eligibility Checklist
      </h2>

      <p className="text-body text-ink-meta mt-2">
        Check individual requirements before applying. These checks do not determine your overall
        eligibility.
      </p>

      {!checklist.description_available && (
        <p className="text-body text-ink-meta mt-2">
          No description is available here. Check the employer’s posting.
        </p>
      )}

      <ul role="list" className="mt-4 flex flex-col gap-4">
        {checklist.items.map((item, index) => (
          <li key={`${item.kind}-${index}`}>
            <p className="text-body text-ink font-semibold">{item.label}</p>
            {item.evidence && (
              <p className="text-body text-ink-meta">{IMPORTANCE[item.importance]}</p>
            )}
            <p className="text-body text-ink">{STATUS[item.status]}</p>
            <p className="text-body text-ink-meta">{item.explanation}</p>

            {item.evidence && (
              <details className="mt-2">
                <summary className="text-body text-brand cursor-pointer">
                  View Posting Evidence
                </summary>
                <blockquote className="border-border text-body text-ink mt-2 border-l-2 pl-3">
                  {item.evidence}
                </blockquote>
              </details>
            )}
          </li>
        ))}
      </ul>

      <Link href="/bank" className="text-body text-brand mt-4 inline-block underline">
        Review Your Education
      </Link>
    </section>
  );
}
