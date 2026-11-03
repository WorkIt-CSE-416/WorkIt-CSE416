import { ExternalLinkIcon } from "@/components/icons";
import { Section } from "@/components/ui/section";
import { apiGet } from "@/lib/api";
import { safeHref } from "@/lib/profile-links";

/** GET /jobs/{id}/company: the employer's website and its company brief. */
export type JobCompany = {
  company: string;
  website: string | null;
  facts: { category: string; fact: string; url: string; published: string | null }[];
};

/** The brief's categories (backend/app/auto_apply/briefs.py), as they read. */
const CATEGORIES: [string, string][] = [
  ["products", "Products"],
  ["launches", "Recent Launches"],
  ["engineering", "Engineering"],
  ["team", "Team"],
];

/** Null when it can't be read: the tab then says it has nothing, as a company
 *  no student has researched does. */
export async function getCompany(jobId: string): Promise<JobCompany | null> {
  try {
    const response = await apiGet(`/jobs/${encodeURIComponent(jobId)}/company`);
    return response.ok ? ((await response.json()) as JobCompany) : null;
  } catch {
    return null;
  }
}

/**
 * The job's Company tab (KAN-519): the employer's website and what the shared
 * company brief says (KAN-382). Each fact was checked against the page it links
 * to. A brief exists only once a student's Claude has researched the company,
 * so most jobs show the website alone. The facts come from the web: text only,
 * and a link only through `safeHref`.
 */
export function CompanyTab({ name, company }: { name: string; company: JobCompany | null }) {
  const facts = company?.facts ?? [];
  const website = company?.website ? safeHref(company.website) : null;

  return (
    <Section title={`About ${name}`}>
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-body text-brand hover:text-brand-hover mt-3 inline-flex items-center gap-1"
        >
          {website.replace(/^https?:\/\//, "")}
          <ExternalLinkIcon className="size-4" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      {facts.length === 0 ? (
        <p className="text-body text-ink-meta mt-3">WorkIt has no notes on {name} yet.</p>
      ) : (
        CATEGORIES.map(([category, heading]) => {
          const inCategory = facts.filter((fact) => fact.category === category);
          if (inCategory.length === 0) return null;
          return (
            <section key={category} className="text-body mt-5 max-w-[46ch]">
              <h3 className="text-label text-ink">{heading}</h3>
              <ul className="mt-2 flex list-disc flex-col gap-2 pl-5">
                {inCategory.map((fact) => {
                  const source = safeHref(fact.url);
                  return (
                    <li key={fact.url + fact.fact} className="text-body text-ink">
                      {fact.fact}
                      {source && (
                        <>
                          {" "}
                          <a
                            href={source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand hover:text-brand-hover underline decoration-current underline-offset-2"
                          >
                            Source<span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </Section>
  );
}
