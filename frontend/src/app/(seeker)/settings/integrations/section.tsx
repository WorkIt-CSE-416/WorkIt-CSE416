import type { ComponentType } from "react";

import { GmailIcon, GoogleCalendarIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

import { INBOX_LIVE } from "../../inbox/live";
import { SettingRow } from "../setting-row";

/** The apps a student can connect, each with what it does for them in one
 *  line. Each line is a claim of docs/email_tracker.md, so change it with
 *  the design. */
const APPS: {
  key: string;
  name: string;
  Icon: ComponentType<{ className?: string }>;
  line: string;
}[] = [
  // Archived with the Inbox until WorkIt has a source of emails (KAN-428,
  // ../../inbox/live.ts): a Gmail row promised a connection that does not
  // exist.
  ...(INBOX_LIVE
    ? [
        {
          key: "gmail",
          name: "Gmail",
          Icon: GmailIcon,
          line: "Moves your applications along when employers reply. Read-only.",
        },
      ]
    : []),
  {
    key: "google-calendar",
    name: "Google Calendar",
    Icon: GoogleCalendarIcon,
    line: "Puts your interviews and deadlines on your calendar.",
  },
];

/**
 * Integrations (KAN-413, docs/email_tracker.md, "Where it lives"): the apps
 * a student connects, after Claude's connectors list. One row per app,
 * drawn as Sign-In & Security draws its sign-in methods (../setting-row):
 * the app's own logo, its name, one line on what it does, and Connect. The
 * design only, like Notifications: each Connect is disabled and marked
 * Coming Soon until its Google sign-in is built (build step 3; a Google
 * Cloud project on the team's account). Then a connected row shows
 * Connected, with Disconnect in place of Connect, and what WorkIt reads goes
 * in the Connect flow, not on this page.
 */
export function IntegrationsSection() {
  return (
    <Card as="section" aria-labelledby="integrations" className="flex flex-col gap-4">
      <div>
        <SectionHeading id="integrations">Integrations</SectionHeading>
        <p className="text-meta text-ink-meta mt-1">
          Connect your apps so your tracker keeps itself up to date.
        </p>
      </div>
      <ul className="divide-border-subtle flex flex-col divide-y">
        {APPS.map(({ key, name, Icon, line }) => (
          <SettingRow
            key={key}
            Icon={Icon}
            label={
              <>
                {name}
                <Badge tone="inert">Coming Soon</Badge>
              </>
            }
            value={line}
          >
            <Button variant="secondary" size="sm" disabled>
              Connect
            </Button>
          </SettingRow>
        ))}
      </ul>
    </Card>
  );
}
