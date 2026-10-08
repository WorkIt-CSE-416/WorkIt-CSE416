import type { ReactNode } from "react";

import { Logo, LogoLockup } from "@/components/logo";
import { NotificationsMenu } from "@/components/notifications-menu";

import { BAR_CIRCLE } from "../../(seeker)/bar";
import { SECTIONS } from "../data";
import { AccountMenuSpecimen } from "../interactive";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.shell.title };

export default function ShellPage() {
  return (
    <KitPage {...SECTIONS.shell}>
      <Group title="Logo">
        <Row name="<LogoLockup>" role="Seeker panel: mark and word as two images, word at 55%">
          <LogoLockup />
        </Row>
        <Row name="<LogoLockup wordmarkHidden>" role="The collapsed panel: the word fades out">
          <LogoLockup wordmarkHidden />
        </Row>
        <Row name='<Logo size="bar">' role="Company bar's corner cell: the drawn lockup in ink">
          <Logo size="bar" />
        </Row>
        <Row name='<Logo size="card">' role="The auth card, in violet">
          <Logo size="card" />
        </Row>
      </Group>

      <Group
        title="Bar Controls"
        note="Each bar's right-hand end, on a white strip like the bar itself: the seeker's grey circles are drawn for a white panel and vanish on this page's grey. The bell opens a popover holding an empty state; the account menu opens on who is signed in."
      >
        <Row
          name="<NotificationsMenu>"
          role="Company bar's bare 32px glyph, then the seeker bar's 40px grey circle (hidden below sm)"
        >
          <BarStrip>
            <NotificationsMenu>
              New applicants and team activity will show up here.
            </NotificationsMenu>
            <NotificationsMenu className={BAR_CIRCLE}>
              New matches and replies from employers will show up here.
            </NotificationsMenu>
          </BarStrip>
        </Row>
        <Row
          name="<AccountMenu>"
          role="Company: the avatar alone. Seeker: the photo, name and email, with Settings and Help. Sign Out does nothing here"
        >
          <BarStrip>
            <AccountMenuSpecimen />
          </BarStrip>
        </Row>
        <Row
          name="--animate-status-ping"
          role="The seeker bar's new-roles dot: three pings as the page loads, then it rests. Reload to see it again"
        >
          <span aria-hidden="true" className="relative flex size-2">
            <span className="bg-brand motion-safe:animate-status-ping absolute inset-0 rounded-full" />
            <span className="bg-brand relative size-2 rounded-full" />
          </span>
        </Row>
      </Group>
    </KitPage>
  );
}

/** A stretch of a bar's white panel, for controls drawn against one. */
function BarStrip({ children }: { children: ReactNode }) {
  return (
    <div className="bg-panel rounded-shell shadow-panel flex items-center gap-4 px-3 py-2">
      {children}
    </div>
  );
}
