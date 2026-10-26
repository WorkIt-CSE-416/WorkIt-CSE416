"use client";

import { DownloadMenu, DownloadNotes, useResumeDownload } from "../../../resumes/download-menu";

/**
 * The tailored resume's Download, in the review step's top row beside
 * Finish (`TailorReviewBar`): saving the file and finishing are the two ways
 * out of the review, so they sit together, and the editor's toolbar keeps
 * only tools that change the page. Secondary, so Finish is the row's one
 * filled button. A download's warning or error opens under it, over the
 * page, rather than pushing the page down. The phone's editor has its own.
 */
export function TailorDownload({ resumeId }: { resumeId: string }) {
  const download = useResumeDownload(resumeId);
  const noted = download.held !== null || download.error !== null;
  return (
    <div className="relative max-sm:hidden">
      <DownloadMenu download={download} />
      {noted && (
        <div className="bg-panel ring-border-subtle absolute top-full right-0 z-30 mt-2 w-80 rounded-xl p-3 shadow-lg ring-1">
          <DownloadNotes download={download} />
        </div>
      )}
    </div>
  );
}
