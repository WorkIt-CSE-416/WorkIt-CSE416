import {
  AwardIcon,
  BellIcon,
  BookmarkIcon,
  BriefcaseIcon,
  CalendarIcon,
  GearIcon,
  PinIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { Fact } from "@/components/ui/fact";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextLink } from "@/components/ui/text-link";

import { STAGE_TONE } from "../../company/applicants/data";
import { STATUS_TONE } from "../../company/jobs/data";
import { SECTIONS } from "../data";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.display.title };

export default function DisplayPage() {
  return (
    <KitPage {...SECTIONS.display}>
      {/* Rendered from the same maps the two company tables read, so this
          cannot drift from what the app actually paints. Adding a status there
          makes it appear here with no edit. */}
      <Group
        title="Status pills"
        note="A tone names a state's kind, not one label each. Two states share a tone only when they are the same kind of thing."
      >
        <Row name="Job posting statuses" role="app/company/jobs/data.ts — STATUS_TONE">
          {Object.entries(STATUS_TONE).map(([status, tone]) => (
            <Badge key={status} variant="status" tone={tone}>
              {status}
            </Badge>
          ))}
        </Row>
        <Row name="Applicant stages" role="app/company/applicants/data.ts — STAGE_TONE">
          {Object.entries(STAGE_TONE).map(([stage, tone]) => (
            <Badge key={stage} variant="status" tone={tone}>
              {stage}
            </Badge>
          ))}
        </Row>
        <Row name='<Badge variant="tag">' role="Skill pill on a profile — a fact, not a state">
          <Badge variant="tag">TypeScript</Badge>
          <Badge variant="tag">React</Badge>
        </Row>
      </Group>

      <Group title="Everything else">
        <Row name="<CompanyTile>" role="Logo stand-in, three sizes and four tones">
          <CompanyTile Icon={BriefcaseIcon} size="sm" />
          <CompanyTile Icon={BriefcaseIcon} size="md" tone="positive" />
          <CompanyTile Icon={BriefcaseIcon} size="lg" tone="deep" />
          <CompanyTile Icon={BriefcaseIcon} size="md" tone="outline" />
        </Row>
        <Row name="<Fact>" role="Icon plus one truncating line of metadata">
          <Fact Icon={PinIcon}>Stony Brook, NY</Fact>
          <Fact Icon={CalendarIcon}>Posted 3 days ago</Fact>
          <Fact Icon={AwardIcon}>92% match</Fact>
        </Row>
        <Row name="<IconButton>" role="Bare glyph, bordered, and brand disc">
          <IconButton label="Notifications">
            <BellIcon className="size-4" />
          </IconButton>
          <IconButton label="Save job" variant="outline" className="size-8">
            <BookmarkIcon className="size-4" />
          </IconButton>
          <IconButton label="Edit avatar" variant="brand">
            <GearIcon className="size-3.5" />
          </IconButton>
        </Row>
        <Row name="<TextLink>" role="Brand link inside running text">
          <p className="text-body text-ink-muted">
            Read the <TextLink href="/design-kit">design kit</TextLink> first.
          </p>
        </Row>
        <Row name="<SectionHeading>" role="Card heading, with an optional action on its baseline">
          <div className="w-full max-w-sm">
            <SectionHeading as="h3" action={<Button variant="ghost">+ Add</Button>}>
              Work Experience
            </SectionHeading>
          </div>
        </Row>
        <Row name="<Card>" role="Five paddings, three status accents, optional selection">
          <div className="flex flex-wrap items-start gap-3">
            <Card padding="sm" className="w-40">
              <p className="text-note text-ink-meta">Default</p>
            </Card>
            <Card padding="sm" accent="brand" className="w-40">
              <p className="text-note text-ink-meta">accent=&quot;brand&quot;</p>
            </Card>
            <Card padding="sm" accent="positive" className="w-40">
              <p className="text-note text-ink-meta">accent=&quot;positive&quot;</p>
            </Card>
            <Card padding="sm" selected className="w-40">
              <p className="text-note text-ink-meta">selected</p>
            </Card>
          </div>
        </Row>
      </Group>
    </KitPage>
  );
}
