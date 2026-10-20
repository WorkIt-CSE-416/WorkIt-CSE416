/**
 * Onboarding's three steps, as the Stepper draws them over the wizard
 * (./onboarding-form): two questions, then the resume (KAN-275). The third
 * was intake, on a page of its own, until the resume step replaced it.
 *
 * The rail counts the whole journey (KAN-259). The wizard used to say "Step 2
 * of 2" on its last question, and intake then opened six more sections, so
 * a seeker who thought they were done was not.
 *
 * The second was "Pay & Visa" until KAN-283 moved pay to Role and made it
 * the questions every application asks.
 */
export const ONBOARDING_STEPS = ["Role", "Profile", "Resume"] as const;
