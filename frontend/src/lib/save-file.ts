/**
 * Handing a file to the browser's download, from a click handler. Two ways a
 * file reaches the page: a Storage link (an uploaded resume, a sent resume
 * kept as a file) or the file itself in base64 (a resume rendered for this
 * download, or a sent resume rendered again from its snapshot, KAN-267).
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

/** A sent resume's file, either way it comes (`SentResumeFile`). */
export function saveSentFile(file: {
  url: string | null;
  data: string | null;
  content_type: string;
  file_name: string;
}) {
  if (file.url) return openDownload(file.url);
  if (file.data)
    saveFile({ data: file.data, contentType: file.content_type, fileName: file.file_name });
}
