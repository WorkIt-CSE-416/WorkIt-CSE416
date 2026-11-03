import type { ComponentType } from "react";

import { GmailIcon, GoogleCalendarIcon, SparkleIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { claudeConnectorLink } from "@/lib/claude-connector";
import { getClaudeConnected } from "@/lib/connector-actions";

import { INBOX_LIVE } from "../../inbox/live";
import { SettingRow } from "../setting-row";
import { ClaudeButton } from "./claude-button";

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
 *
 * Claude comes first, the one live row (KAN-571; it sat in Sign-In &
 * Security's Connected Apps, so a student had two places to look):
 * whether the student's Claude is signed in to WorkIt through the
 * connector, with Disconnect, which revokes its access server-side at once
 * (removing the connector in Claude alone leaves WorkIt's tokens alive), or
 * Add to Claude when it isn't. A failed read says so and offers neither.
 */
export async function IntegrationsSection() {
  const claude = await getClaudeConnected();

  return (
    <Card as="section" aria-labelledby="integrations" className="flex flex-col gap-4">
      <div>
        <SectionHeading as="h3" id="integrations">
          Integrations
        </SectionHeading>
        <p className="text-note text-ink-meta mt-1">Connect the apps that work with WorkIt.</p>
      </div>
      <ul className="divide-border-subtle flex flex-col divide-y">
        <SettingRow
          Icon={SparkleIcon}
          label="Claude"
          value={
            claude.added == null ? (
              (claude.error ?? "Couldn't check.")
            ) : claude.added ? (
              <Badge tone="positive">Connected</Badge>
            ) : (
              "Your Claude writes your written answers once you add WorkIt to it"
            )
          }
        >
          {claude.added != null && (
            <ClaudeButton connected={claude.added} claudeLink={claudeConnectorLink()} />
          )}
        </SettingRow>
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
