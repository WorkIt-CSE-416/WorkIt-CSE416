import { Switch } from "@/components/shadcn/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

/** Each alert, in the order the bell names them ("New matches and replies
 *  from employers will show up here", (seeker)/layout.tsx). */
const ALERTS = [
  {
    key: "new-matches",
    title: "New Matches",
    line: "Email me when new job postings fit my job preferences.",
  },
  {
    key: "employer-replies",
    title: "Employer Replies",
    line: "Email me when an employer answers an application I sent.",
  },
] as const;

/**
 * Notifications (KAN-326): the design only. Each alert is a row with its
 * switch, disabled and marked Coming Soon, because nothing stores or sends
 * notifications yet; the notification work (KAN-298) wires each switch to
 * what it saves. Disabled, not live: a switch that saves nothing is what
 * My Profile's Autofill switch was removed for on 2026-10-18
 * (docs/screens.md, My Profile).
 */
export function NotificationsSection() {
  return (
    <Card as="section" aria-labelledby="notifications" className="flex flex-col gap-4">
      <SectionHeading id="notifications">Notifications</SectionHeading>
      <p className="text-body text-ink-meta">
        Choose which emails you get. WorkIt doesn&apos;t send notifications yet, so these switches
        turn on when it does.
      </p>
      <ul className="divide-border-subtle flex flex-col divide-y">
        {ALERTS.map(({ key, title, line }) => (
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
