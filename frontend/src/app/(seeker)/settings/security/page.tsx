import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";

import { GoogleIcon, LinkedInIcon, LockIcon, MailIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import type { OAuthProvider } from "@/lib/oauth-actions";
import { getSessionUser, getSignInProviders } from "@/lib/session";

import { EmailDialog } from "./email-dialog";
import { PasswordDialog } from "./password-form";
import { ProviderButton } from "./provider-button";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Sign-In & Security" };

/** The OAuth providers a seeker can link, in the order sign-in shows them. */
const PROVIDERS: {
  provider: OAuthProvider;
  name: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { provider: "google", name: "Google", Icon: GoogleIcon },
  { provider: "linkedin_oidc", name: "LinkedIn", Icon: LinkedInIcon },
];

/** What the callback's `?notice=` says on the way back (lib/account-actions.ts). */
const NOTICES: Record<string, string> = {
  email: "Your sign-in email is changed.",
  "email-pending": "Link accepted. Open the link we sent to your other email to finish.",
  linked: "Your sign-in method is connected.",
};

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
 * last method. `notice` is what the auth callback brings back from a link
 * or a confirm email.
 */
export default async function SecurityPage({ searchParams }: PageProps<"/settings/security">) {
  const [user, providers, { notice }] = await Promise.all([
    getSessionUser(),
    getSignInProviders(),
    searchParams,
  ]);
  const email = user?.email ?? "";
  const hasPassword = providers.includes("email");
  const message = typeof notice === "string" ? NOTICES[notice] : undefined;

  return (
    <>
      {message && (
        <p role="status" className="bg-positive-tint text-ink rounded-control text-body px-4 py-3">
          {message}
        </p>
      )}

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

      <Card as="section" aria-labelledby="session" className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <SectionHeading id="session">Sign Out</SectionHeading>
          <p className="text-meta text-ink-meta">Signs you out here and on your other devices.</p>
        </div>
        <SignOutButton />
      </Card>
    </>
  );
}
