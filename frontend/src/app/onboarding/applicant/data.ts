/**
 * The vocabularies the applicant onboarding form offers, plus the fixture a
 * resume "parse" hands back. No backend exists yet — see the note in
 * ./resume-upload.tsx — so these are display text used as their own value,
 * the same convention company/jobs/new/data.ts documents.
 */

export const EXPERTISE_SUGGESTIONS = [
  "Software Engineering",
  "Product Design",
  "Product Management",
  "Data Science",
  "Marketing",
  "Sales",
  "Customer Support",
  "Finance & Accounting",
  "Human Resources",
  "Operations",
] as const;

export const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship"] as const;

/**
 * Stands in for what a real resume parser would hand back. A file is never
 * actually read — see ./resume-upload.tsx — so this is the same fixture
 * regardless of which file is chosen.
 */
export const MOCK_RESUME_SKILLS = ["React", "TypeScript", "Node.js", "SQL", "Project Management"];
