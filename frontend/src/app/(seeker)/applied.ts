import type { AfterApplied, ApplicationStage } from "./auto-apply/actions";

/** Whether the student applied: applied, or a stage after it that the
 *  Applications Tracker sets (interviewing, offer, rejected; KAN-413). The
 *  Jobs page hides these jobs and their buttons say Applied. Not in
 *  ./auto-apply/actions.ts, whose every export must be a server action. */
export function hasApplied(
  stage: ApplicationStage | null | undefined,
): stage is "applied" | AfterApplied {
  return (
    stage === "applied" || stage === "interviewing" || stage === "offer" || stage === "rejected"
  );
}
