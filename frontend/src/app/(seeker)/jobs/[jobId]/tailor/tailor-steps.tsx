/** Tailor's steps, in order: each its own view, so the student looks at one
 *  thing at a time, named in its top row (`TailorBar`, ./tailor-header.tsx).
 *  "review" is the tailored resume's own page. The run itself was a fourth
 *  step, Tailor, until 2026-10-26; it only waited, so it is now a loader
 *  over Choose Keywords (`TailorRunning`). A timeline of the steps
 *  (`TailorSteps`) sat over each view until the top row named the step. */
export type TailorStep = "pick" | "keywords" | "review";

export const TAILOR_STEPS: { value: TailorStep; label: string }[] = [
  { value: "pick", label: "Pick a Resume" },
  { value: "keywords", label: "Choose Keywords" },
  { value: "review", label: "Review Changes" },
];
