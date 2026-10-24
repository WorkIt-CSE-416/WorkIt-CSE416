import { getResumeFileUrl } from "@/lib/resume-actions";

/**
 * Opens one uploaded resume's file, as a click on its row does on the
 * Resumes view, and on the Experiences view's Showing card (KAN-363).
 * `isPdf` picks a tab or a download, so the caller knows it before any
 * await. Returns the message to show, or null when it opened.
 *
 * CALL IT STRAIGHT FROM THE CLICK, before any await of your own. A PDF opens
 * in a new tab, and that tab is opened here, before this function's own first
 * await: one opened after it is a popup, which browsers block. A DOCX link
 * downloads, so it needs no tab and leaves the page in place.
 */
export async function previewResume(id: string, isPdf: boolean): Promise<string | null> {
  const tab = isPdf ? window.open("", "_blank") : null;
  let url: string | null = null;
  let error: string | null = null;
  try {
    ({ url, error } = await getResumeFileUrl(id));
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
