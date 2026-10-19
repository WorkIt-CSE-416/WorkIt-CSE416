"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ResumeUpload } from "@/components/resume-upload";
import { ButtonLink } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { uploadResume } from "@/lib/resume-actions";

/** The resume upload as an onboarding step (KAN-275): the Resumes view's own
 *  dropzone. Picking a file uploads it at once, and the API reads it into
 *  the experience bank as any upload does (ADR 0003), so the Jobs page's
 *  Recommended view, opened next, scores against what it read. Skip opens
 *  the same view with the bank as it is. */
export function ResumeStep() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (uploading) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { error: uploadError } = await uploadResume(fd);
      if (uploadError) {
        setUploading(false);
        return setError(uploadError);
      }
      // Busy until the Jobs page replaces this one.
      router.push("/jobs");
    } catch {
      setUploading(false);
      setError("Could not upload the resume. Refresh the page and try again.");
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div>
        <ResumeUpload file={null} onFileChange={handleFile} onRemove={() => {}} busy={uploading} />
        {error && (
          <p role="alert" className="text-meta text-danger mt-2">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TextLink href="/onboarding/applicant">Back to Profile</TextLink>
        <ButtonLink href="/jobs" variant="outline" size="lg">
          Skip
        </ButtonLink>
      </div>
    </div>
  );
}
