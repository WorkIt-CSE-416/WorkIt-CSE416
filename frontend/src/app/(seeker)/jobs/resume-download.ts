"use client";

import { useState } from "react";

import { renderResumePdf } from "@/lib/built-resume-actions";
import { getResumeFileUrl } from "@/lib/resume-actions";
import { openDownload, saveFile } from "@/lib/save-file";

import type { Source } from "./resume-picker";

/**
 * Downloads one resume from a picker's choice (KAN-217): a built resume as the
 * editor's PDF (rendered for the download, kept nowhere, KAN-267), an upload
 * as its own file. Apply Now's "Did You Apply?" and Tailor's Your Resume Is Ready
 * offer it, so the student has the file in hand for the employer's form,
 * which Apply Now opens in a new tab with no resume step of its own.
 */
export function useResumeFileDownload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(source: Source) {
    setBusy(true);
    setError(null);
    if ("builtResumeId" in source) {
      const { data, error } = await renderResumePdf(source.builtResumeId);
      setBusy(false);
      if (!data) return setError(error);
      saveFile({ data: data.pdf, contentType: "application/pdf", fileName: data.file_name });
      return;
    }
    const { url, error } = await getResumeFileUrl(source.uploadedResumeId, true);
    setBusy(false);
    if (!url) return setError(error);
    openDownload(url);
  }

  return { busy, error, download };
}
