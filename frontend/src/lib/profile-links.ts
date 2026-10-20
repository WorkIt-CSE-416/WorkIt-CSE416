/**
 * The profile's links as people see them: the text a link prints, the site
 * it points at, and the same check the API makes before saving one
 * (backend `schemas/profile.py`, `web_link`).
 */

/** How a link prints: no scheme, no "www.", no trailing slash (the API's
 *  `fields.link_text`). */
export function linkText(url: string) {
  return url
    .replace(/^(https?:\/\/|mailto:)/i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** A typed link as the API stores it: "https://" added when missing. Null
 *  for an empty field, "invalid" for anything that is not a web address
 *  (a "javascript:" link included). */
export function webLink(text: string): string | null | "invalid" {
  const value = text.trim();
  if (!value) return null;
  const withScheme = value.includes("://") ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    const ok = /^https?:$/.test(url.protocol) && url.hostname.includes(".") && !/\s/.test(value);
    return ok ? withScheme : "invalid";
  } catch {
    return "invalid";
  }
}

/** An href that is safe to render: http(s) only. A link saved before the API
 *  checked them may lack its scheme or be something else entirely. */
export function safeHref(url: string): string | null {
  const link = webLink(url);
  return link === "invalid" ? null : link;
}

/** The sites an Other Link is named by, matched on the host and its parent
 *  domains, so "www.behance.net" and "scholar.google.com" both match. */
const SITES: Record<string, string> = {
  "linkedin.com": "LinkedIn",
  "github.com": "GitHub",
  "gitlab.com": "GitLab",
  "x.com": "X",
  "twitter.com": "X",
  "behance.net": "Behance",
  "dribbble.com": "Dribbble",
  "scholar.google.com": "Google Scholar",
  "orcid.org": "ORCID",
  "kaggle.com": "Kaggle",
  "stackoverflow.com": "Stack Overflow",
  "medium.com": "Medium",
  "substack.com": "Substack",
  "youtube.com": "YouTube",
  "instagram.com": "Instagram",
  "joinhandshake.com": "Handshake",
  "leetcode.com": "LeetCode",
  "devpost.com": "Devpost",
};

/** The site a link points at ("Behance"), or null for a site not listed. */
export function siteName(url: string): string | null {
  const href = safeHref(url);
  if (!href) return null;
  const parts = new URL(href).hostname.toLowerCase().split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const name = SITES[parts.slice(i).join(".")];
    if (name) return name;
  }
  return null;
}
