/**
 * Onboarding's five steps, as the Stepper draws them over the wizard
 * (./onboarding-form): the role, the resume, then the questions every
 * application asks, right after the resume (KAN-372; the resume was last
 * from KAN-275), then the extension's install and a practice batch on
 * WorkIt's own practice forms (KAN-378). Intake, on a page of its own, was a step until the resume
 * step replaced it.
 *
 * The rail counts the whole journey (KAN-259). The wizard used to say "Step 2
 * of 2" on its last question, and intake then opened six more sections, so
 * a seeker who thought they were done was not.
 *
 * Availability (KAN-369), the wizard's fourth page, has no mark of its own:
 * it sits under Profile, the second half of the questions, since six labels
 * cut each other short on a laptop's rail ("Res…", "Pro…").
 *
 * The second was "Pay & Visa" until KAN-283 moved pay to Role and made it
 * the questions every application asks.
 */
export const ONBOARDING_STEPS = ["Role", "Resume", "Profile", "Extension", "Practice"] as const;

/** The extension step's link: the tab the WorkIt extension opens on install
 *  (KAN-471, autofiller_extension/src/background/install.js). */
export const EXTENSION_STEP_PATH = "/onboarding/applicant?step=extension";

/**
 * The step ./page opens on, from its `?step=`: "2" opens Profile, the third
 * step, and "extension" the extension's install step, which the extension
 * links to when it is added. Either only with saved answers (`saved`): the
 * first step holds the answers that must be given, and a seeker who never
 * gave them starts there.
 */
export function startStep(param: string | string[] | undefined, saved: boolean): number {
  if (!saved) return 0;
  if (param === "2") return 2;
  // The wizard's fifth page: Availability has no mark on the rail (ONBOARDING_STEPS).
  if (param === "extension") return 4;
  return 0;
}
