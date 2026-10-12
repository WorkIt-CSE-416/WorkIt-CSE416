/**
 * Where the browser fetches a resume drawn with a template: the route handler
 * at app/api/resumes/[resumeId]/download, which adds the session's token and
 * passes the API's file through. A plain module, not an action, so a link or
 * an iframe can use it.
 */
export function builtResumeUrl(resumeId: string, format: "pdf" | "docx", inline = false) {
  const query = new URLSearchParams({ format, ...(inline ? { inline: "true" } : {}) });
  return `/api/resumes/${encodeURIComponent(resumeId)}/download?${query}`;
}
