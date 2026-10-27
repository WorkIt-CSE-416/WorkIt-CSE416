import { CheckIcon, CloseIcon, MailIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

/** What WorkIt reads, and what it never does: the section's promise, kept to
 *  what docs/email_tracker.md designs (read-only Gmail, job emails only, no
 *  bodies kept). Each line is a claim, so change it with the design. */
const READS = [
  "Emails from hiring systems and the companies you applied to",
  "Who sent each one, its subject and the date it names",
] as const;
const NEVER = [
  "Send, delete or change any email",
  "Keep an email's text: only the update it held",
  "Read anything else in your inbox",
] as const;

/**
 * Email (KAN-413, docs/email_tracker.md, "Where it lives"): where a student
 * connects Gmail so the Applications Tracker's Updates strip fills itself.
 * The design only, like Notifications: Connect Gmail is disabled and marked
 * Coming Soon, because the Google sign-in and the inbox reading are not
 * built (build step 3, which needs the team's Google Cloud project). Then
 * this section gains its other states: Checking, Connected (the address,
 * the last check, Check Now, Disconnect and "also delete what WorkIt got
 * from Gmail") and Needs Attention.
 */
export function EmailSection() {
  return (
    <Card as="section" aria-labelledby="email" className="flex flex-col gap-4">
      <SectionHeading id="email">Email</SectionHeading>
      <p className="text-body text-ink-meta">
        Connect Gmail and WorkIt reads replies about your applications: confirmations, interview
        invites, assessments, offers and rejections. Each one waits on your Applications Tracker for
        you to accept, and nothing changes until you do.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled>
          <MailIcon />
          Connect Gmail
        </Button>
        <Badge tone="inert">Coming Soon</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-label text-ink font-semibold">What WorkIt Reads</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {READS.map((line) => (
              <li key={line} className="text-meta text-ink-muted flex items-start gap-2">
                <CheckIcon className="text-positive-ink mt-0.5 size-4 shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-label text-ink font-semibold">What WorkIt Never Does</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {NEVER.map((line) => (
              <li key={line} className="text-meta text-ink-muted flex items-start gap-2">
                <CloseIcon className="text-danger mt-0.5 size-4 shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-meta text-ink-meta">
        Google will show a &ldquo;Google hasn&apos;t verified this app&rdquo; screen while
        WorkIt&apos;s review is under way. You can disconnect at any time here.
      </p>
    </Card>
  );
}
