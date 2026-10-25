// Job boards (KAN-376; GLOSSARY.md, "Job board"): sites that list other
// employers' job postings, whose terms ban automated applications. Batch
// apply never opens one: the API names a job board's posting by the
// employer's own form it names (`job.form_url`) or refuses to queue it, and
// this list is the extension's own check that no tab ever opens one anyway.
// The same hosts as backend/app/auto_apply/hosts.py JOB_BOARDS.

const JOB_BOARDS = {
  "linkedin.com": "LinkedIn",
  "lnkd.in": "LinkedIn",
  "indeed.com": "Indeed",
  "glassdoor.com": "Glassdoor",
  "ziprecruiter.com": "ZipRecruiter",
  "joinhandshake.com": "Handshake",
  "wellfound.com": "Wellfound",
  "simplyhired.com": "SimplyHired",
  "monster.com": "Monster",
  "dice.com": "Dice",
  "builtin.com": "Built In",
  "simplify.jobs": "Simplify",
  "jobright.ai": "Jobright",
};

/**
 * The job board a link is on ("LinkedIn"), or null for any other link: the
 * host is a job board's or a subdomain of it (www.linkedin.com, ca.indeed.com).
 * @param {string} url
 * @returns {string | null}
 */
export function jobBoard(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const board = Object.keys(JOB_BOARDS).find((b) => host === b || host.endsWith(`.${b}`));
  return board ? JOB_BOARDS[board] : null;
}
