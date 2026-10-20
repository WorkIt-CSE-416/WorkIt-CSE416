/**
 * Handing a file to the browser's download, from a click handler, on
 * Resumes & Experiences, the one place a student downloads resume files
 * (KAN-267). Two ways a file reaches the page: a Storage link (an uploaded
 * resume) or the file itself in base64 (a resume rendered for this
 * download).
 */

/** Opens a Storage link that downloads its file (its Content-Disposition). */
export function openDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

/** Saves a file the API sent as base64, under its name. */
export function saveFile({
  data,
  contentType,
  fileName,
}: {
  data: string;
  contentType: string;
  fileName: string;
}) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // After the click has handed the file to the browser's download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
