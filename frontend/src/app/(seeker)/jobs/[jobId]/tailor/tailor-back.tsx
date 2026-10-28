"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";

import { ButtonLink } from "@/components/ui/button";

import { useTailorReview } from "../../../resumes/[resumeId]/tailor-review";

/**
 * The review's Back: Choose Keywords again on the resume the run started
 * from (the record's `source`), so the student picks other keywords and
 * runs again, which replaces this tailored resume. A tab with no record
 * (Tailor ran in another one) opens Pick a Resume instead. It went to the
 * Jobs page until 2026-10-26, when a posting could be tailored only once.
 */
export function TailorBack({ jobId, resumeId }: { jobId: string; resumeId: string }) {
  const [record] = useTailorReview(resumeId);
  const source = record?.source;
  const key = source
    ? "built_resume_id" in source
      ? `built:${source.built_resume_id}`
      : `uploaded:${source.uploaded_resume_id}`
    : null;
  const href = `/jobs/${encodeURIComponent(jobId)}/tailor?${
    key ? `step=keywords&source=${encodeURIComponent(key)}` : "step=pick"
  }`;
  return (
    <ButtonLink href={href} variant="secondary" size="sm" className="group/back justify-self-start">
      <ArrowLeftIcon className="ease-glide size-3.5 transition-transform duration-200 group-hover/back:-translate-x-0.5" />
      Back
    </ButtonLink>
  );
}
