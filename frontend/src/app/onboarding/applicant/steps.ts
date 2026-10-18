/**
 * Onboarding's three steps, as the Stepper draws them on both its pages: the
 * wizard's two questions (./onboarding-form), then intake (./bank).
 *
 * The rail counts the whole journey (KAN-259). The wizard used to say "Step 2
 * of 2" on its last question, and intake then opened six more sections, so
 * a seeker who thought they were done was not.
 */
export const ONBOARDING_STEPS = ["Role", "Pay & Visa", "Experiences"] as const;
