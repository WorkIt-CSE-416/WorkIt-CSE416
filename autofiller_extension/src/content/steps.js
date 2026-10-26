// The stepped job system on this page, or null: Workday (workday.js) or
// Oracle (oracle.js), the extension's side of the engine's Stepper seam
// (fill-engine src/steps.ts). The fill's step loop (content-script.js) and
// Fill to Review (workday-walk.js) use only this face, so a new stepped
// system (iCIMS, SuccessFactors) is one more script giving it:
//   isOn, name, step(), stepId(), stepAfter(from), quiet(), filledBefore(),
//   nextLabel ("Save and Continue", "Next"), reviewName ("Review", "Summary"),
//   waiting {title, reason} (the panel's line before the first step),
//   watchGate(onView) (a gate the student passes: Oracle's email), and
//   walk {next, review, goesOn, banner, wentWrong()} (the step's button, the
//   page where the walk stops, the button's words that go on, an error's
//   words, the system's error page).
// Loaded after workday.js and oracle.js, as window.WIA.steps.
window.WIA = window.WIA || {};
window.WIA.steps = [window.WIA.workday, window.WIA.oracle].find((system) => system?.isOn) ?? null;
