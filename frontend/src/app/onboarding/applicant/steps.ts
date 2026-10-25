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
 * The second was "Pay & Visa" until KAN-283 moved pay to Role and made it
 * the questions every application asks.
 */
export const ONBOARDING_STEPS = ["Role", "Resume", "Profile", "Extension", "Practice"] as const;
