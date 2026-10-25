// Onboarding's later moments (KAN-387): what onboarding no longer asks up
// front is asked on the form that first needs it, once per student:
// - "self_id": the voluntary self-identification, on the first form that asks it;
// - "claude": adding WorkIt to the student's Claude, on the first batch tab
//   with a question for Claude, unless the connector is already added;
// - "samples": writing samples, once the first batch's written answers landed.
// Each is shown in one tab, once: the first tab to claim it shows it, and no
// other tab, now or later, does (the student may still answer it all in
// My Profile). What was shown is kept in chrome.storage.local, by student,
// so a second student signing in on the same Chrome is asked too.

const MOMENTS_KEY = "workit_moments";

// One claim at a time: five tabs finishing together must not all win.
let queue = Promise.resolve();

/**
 * Claims `moment` for `applicantId`: true the first time only.
 * @param {string} applicantId
 * @param {"self_id" | "claude" | "samples"} moment
 */
export function claimMoment(applicantId, moment) {
  const run = queue.then(async () => {
    const all = (await chrome.storage.local.get(MOMENTS_KEY))[MOMENTS_KEY] ?? {};
    const shown = all[applicantId] ?? {};
    if (shown[moment]) return false;
    await chrome.storage.local.set({ [MOMENTS_KEY]: { ...all, [applicantId]: { ...shown, [moment]: true } } });
    return true;
  });
  queue = run.catch(() => {});
  return run;
}
