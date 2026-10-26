import { Switch } from "@/components/shadcn/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { getProfile } from "@/lib/profile-actions";

import { JobAlertsSwitch } from "./job-alerts-switch";

/** The alerts still waiting on their own feature, disabled and marked Coming
 *  Soon (KAN-326): nothing stores or sends them yet. New Matches is live
 *  (KAN-298, below): one flag gates both the bell and the daily email. */
const COMING_SOON = [
  {
    key: "employer-replies",
    title: "Employer Replies",
    line: "Email me when an employer answers an application I sent.",
  },
] as const;

/**
 * Notifications. New Matches' switch is live (KAN-298): it reads and saves
 * `job_alerts_enabled`, the same flag that gates the daily digest email and
 * its bell notification. A failed profile read defaults it off, same as a
 * fresh account: Settings should never block on My Profile's cache, and a
 * student who can't load their own state here isn't opted into a daily
 * email either way. The rest stay disabled, same as My Profile's Autofill
 * switch was removed for on 2026-10-18 (docs/screens.md, My Profile).
 */
export async function NotificationsSection() {
  const { profile } = await getProfile();

  return (
    <Card as="section" aria-labelledby="notifications" className="flex flex-col gap-4">
      <SectionHeading id="notifications">Notifications</SectionHeading>
      <p className="text-body text-ink-meta">Choose which emails you get.</p>
      <ul className="divide-border-subtle flex flex-col divide-y">
        <li className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p id="new-matches-label" className="text-label text-ink font-semibold">
              New Matches
            </p>
            <p id="new-matches-line" className="text-meta text-ink-meta">
              Email me when new job postings fit my job preferences.
            </p>
          </div>
          <JobAlertsSwitch initialEnabled={profile?.job_alerts_enabled ?? false} />
        </li>
        {COMING_SOON.map(({ key, title, line }) => (
          <li key={key} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p
                id={`${key}-label`}
                className="text-label text-ink flex items-center gap-2 font-semibold"
              >
                {title}
                <Badge tone="inert">Coming Soon</Badge>
              </p>
              <p id={`${key}-line`} className="text-meta text-ink-meta">
                {line}
              </p>
            </div>
            <Switch
              checked={false}
              disabled
              aria-labelledby={`${key}-label`}
              aria-describedby={`${key}-line`}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
