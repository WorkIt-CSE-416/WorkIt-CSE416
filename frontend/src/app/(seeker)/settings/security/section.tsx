import type { ComponentType, ReactNode } from "react";

import { GoogleIcon, LinkedInIcon, LockIcon, MailIcon, SparkleIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { claudeConnectorLink } from "@/lib/claude-connector";
import { getClaudeConnected } from "@/lib/connector-actions";
import type { OAuthProvider } from "@/lib/oauth-actions";
import { getSessionUser, getSignInProviders } from "@/lib/session";

import { ClaudeButton } from "./claude-button";
import { EmailDialog } from "./email-dialog";
import { SecurityNotice } from "./notice";
import { PasswordDialog } from "./password-form";
import { ProviderButton } from "./provider-button";
import { DeleteAccount } from "./delete-account";
import { SignOutButton } from "./sign-out-button";
import { WorkdaySignupButton } from "./workday-signup-button";

/** The OAuth providers a seeker can link, in the order sign-in shows them. */
const PROVIDERS: {
  provider: OAuthProvider;
  name: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { provider: "google", name: "Google", Icon: GoogleIcon },
  { provider: "linkedin_oidc", name: "LinkedIn", Icon: LinkedInIcon },
];

/** One setting: its glyph, name and value on the left, its action on the right. */
function Row({
  Icon,
  label,
  value,
  children,
}: {
  Icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="bg-surface text-ink-muted rounded-control flex size-9 shrink-0 items-center justify-center">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink font-semibold">{label}</p>
        <div className="text-meta text-ink-meta break-all">{value}</div>
      </div>
      {children}
    </li>
  );
}

/**
 * Sign-In & Security (KAN-326): each setting is a row, and its form opens
 * from the row's button, since most visits change nothing. The sign-in
 * methods come from Supabase's identities (getSignInProviders), so one
 * linked a moment ago shows at once. Disconnect never offers to remove the
 * last method. The notice at the top (./notice) is what the auth callback
 * brings back from a link or a confirm email.
 *
 * Claude (Connected Apps): whether the student's Claude is signed in to
 * WorkIt through the connector, with Disconnect, which revokes its access
 * server-side at once (removing the connector in Claude alone leaves
 * WorkIt's tokens alive), or Add to Claude when it isn't. A failed read
 * says so and offers neither.
 */
export async function SecuritySection() {
  const [user, providers, claude] = await Promise.all([
    getSessionUser(),
    getSignInProviders(),
    getClaudeConnected(),
  ]);
  const email = user?.email ?? "";
  const hasPassword = providers.includes("email");

  return (
    <>
      <SecurityNotice />

      <Card as="section" aria-labelledby="sign-in" className="flex flex-col gap-4">
        <SectionHeading id="sign-in">Sign-In</SectionHeading>
        <ul className="divide-border-subtle flex flex-col divide-y">
          <Row Icon={MailIcon} label="Email" value={email}>
            <EmailDialog current={email} />
          </Row>
          <Row
            Icon={LockIcon}
            label="Password"
            value={hasPassword ? "Set" : "Not set. You sign in with another method."}
          >
            <PasswordDialog hasPassword={hasPassword} />
          </Row>
        </ul>
      </Card>

      <Card as="section" aria-labelledby="methods" className="flex flex-col gap-4">
        <SectionHeading id="methods">Sign-In Methods</SectionHeading>
        <ul className="divide-border-subtle flex flex-col divide-y">
          {PROVIDERS.map(({ provider, name, Icon }) => {
            const connected = providers.includes(provider);
            return (
              <Row
                key={provider}
                Icon={Icon}
                label={name}
                value={
                  connected ? (
                    <Badge tone="positive">Connected</Badge>
                  ) : (
                    `Sign in with your ${name} account`
                  )
                }
              >
                <ProviderButton
                  provider={provider}
                  name={name}
                  connected={connected}
                  canDisconnect={providers.length > 1}
                />
              </Row>
            );
          })}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="connected-apps" className="flex flex-col gap-4">
        <SectionHeading id="connected-apps">Connected Apps</SectionHeading>
        <ul className="divide-border-subtle flex flex-col divide-y">
          <Row
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
          </Row>
          <Row
            Icon={LockIcon}
            label="Workday Sign-Up"
            value="One email and password for every company's Workday. Your password stays in this browser. WorkIt never sends or saves it anywhere else."
          >
            <WorkdaySignupButton />
          </Row>
        </ul>
      </Card>

      <Card as="section" aria-labelledby="session" className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <SectionHeading id="session">Sign Out</SectionHeading>
          <p className="text-meta text-ink-meta">Signs you out here and on your other devices.</p>
        </div>
        <SignOutButton />
      </Card>

      {/* At the foot, in a red-edged card of its own: where students look
          for it, beside the account's sign-in, and apart from everything
          that can be undone (KAN-364; it sat under Personal Details). */}
      <Card
        as="section"
        aria-labelledby="delete-account"
        className="border-danger/40 flex flex-col gap-4"
      >
        <SectionHeading id="delete-account">Delete Account</SectionHeading>
        <p className="text-body text-ink-meta">
          This deletes your profile, resumes, experiences, applications and files for good. You
          can&apos;t undo it.
        </p>
        <DeleteAccount email={email} />
      </Card>
    </>
  );
}
