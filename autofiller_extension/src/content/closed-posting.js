// Whether the page is a covered job system's word that the job is closed
// (KAN-369), not a job WorkIt can't fill. Loaded before content-script.js
// (shared/content-scripts.js), which says "This job is closed" in the panel,
// and on its own by batch.js, for a batch tab whose page shows no form at
// all (Workable's closed job), so the job leaves the batch marked closed.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  // Where a job system WorkIt fills sends a closed job (live, 2026-10-26): Greenhouse to its board with
  // ?error=true, Workable to the account with ?not_found=true; others say so on the page.
  const CLOSED_HOSTS = /(^|\.)(greenhouse\.io|workable\.com|lever\.co|ashbyhq\.com|rippling\.com|myworkdayjobs\.com|myworkdaysite\.com|eightfold\.ai|oraclecloud\.com|successfactors\.com|successfactors\.eu|sapsf\.com|sapsf\.eu)$/;
  const CLOSED_WORDS = /no longer (accepting applications|open|available)|this (job|position|posting) (is|has been) (closed|filled)|job not found|couldn't find anything here/i;

  window.WIA.closedPosting = function closedPosting() {
    if (!CLOSED_HOSTS.test(location.hostname)) return false;
    const params = new URLSearchParams(location.search);
    return params.get("error") === "true" || params.has("not_found") || CLOSED_WORDS.test(document.body?.innerText ?? "");
  };
})();
