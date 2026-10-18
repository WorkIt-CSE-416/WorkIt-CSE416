import { getResumeFileUrl, type ResumeItem } from "@/lib/resume-actions";

/**
 * Opens one resume's file, the way a resume row's eye does on the Resumes
 * view and the Auto Apply page. Returns the message to show, or null when it opened.
 *
 * CALL IT STRAIGHT FROM THE CLICK, before any await of your own. A PDF opens
 * in a new tab, and that tab is opened here, before this function's own first
 * await: one opened after it is a popup, which browsers block. A DOCX link
 * downloads, so it needs no tab and leaves the page in place.
 */
export async function previewResume(resume: ResumeItem): Promise<string | null> {
  const isPdf = resume.storage_path.endsWith(".pdf");
  const tab = isPdf ? window.open("", "_blank") : null;
  let url: string | null = null;
  let error: string | null = null;
  try {
    ({ url, error } = await getResumeFileUrl(resume.id));
  } catch {
    error = "Could not open the resume. Refresh the page and try again.";
  }
  if (!url) {
    tab?.close();
    return error ?? "Could not open the resume.";
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = url;
  } else if (isPdf) {
    // The tab was blocked. Swapping the page for the PDF would be worse.
    return "Your browser blocked the preview tab. Allow pop-ups for this site, then try again.";
  } else {
    window.location.assign(url);
  }
  return null;
}
