import { Avatar } from "@/components/avatar";
import { CompanyLogo } from "@/components/company-logo";
import { HeroArcs } from "@/components/hero-arcs";
import {
  AwardIcon,
  BellIcon,
  BookmarkIcon,
  BriefcaseIcon,
  CalendarIcon,
  GearIcon,
  MailIcon,
  PinIcon,
  PlusIcon,
} from "@/components/icons";
import { JOB_POSTINGS } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { JobPostingCard, NOT_LISTED } from "@/components/job-posting-card";
import { SaveButton } from "@/components/save-button";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Fact } from "@/components/ui/fact";
import { IconButton } from "@/components/ui/icon-button";
import { Points, Section } from "@/components/ui/section";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextLink } from "@/components/ui/text-link";

import { MatchRail } from "../../(seeker)/jobs/match-rail";
import { STAGE_TONE } from "../../company/applicants/data";
import { STATUS_TONE } from "../../company/jobs/data";
import { SECTIONS } from "../data";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.display.title };

/** An open, scored fixture, so the header shows its deadline and its rail. */
const SAMPLE_POSTING = JOB_POSTINGS.find(
  (posting) => posting.status === "Open" && posting.match != null,
);

export default function DisplayPage() {
  return (
    <KitPage {...SECTIONS.display}>
      {/* Rendered from the same maps the two company tables read, so this
          cannot drift from what the app actually paints. Adding a status there
          makes it appear here with no edit. */}
      <Group
        title="Status Pills"
        note="A tone names a state's kind, not one label each. Two states share a tone only when they are the same kind of thing."
      >
        <Row name="Job Posting Statuses" role="app/company/jobs/data.ts, STATUS_TONE">
          {Object.entries(STATUS_TONE).map(([status, tone]) => (
            <Badge key={status} variant="status" tone={tone}>
              {status}
            </Badge>
          ))}
        </Row>
        <Row name="Applicant Stages" role="app/company/applicants/data.ts, STAGE_TONE">
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

      <Group title="People and Companies">
        <Row name="<Avatar>" role="Initials without a photo, at the 28, 32 and 40px the app uses">
          <Avatar name="Alex Chen" className="text-meta size-7" />
          <Avatar name="Alex Chen" className="text-note size-8" />
          <Avatar name="Alex Chen" className="text-label size-10" />
        </Row>
        <Row name="<CompanyLogo>" role="A job board's logo, or the company's initials without one">
          <CompanyLogo name="Northwind" className="text-note rounded-control size-9" />
        </Row>
      </Group>

      <Group
        title="Dashboards"
        note="Both Dashboards open on plain tiles and one violet hero, so the numbers and the next step are the first places to look."
      >
        <Row name="<StatTile plain>" role="Both Dashboards' headline row">
          <div className="grid w-full max-w-md grid-cols-2 gap-6">
            <StatTile
              plain
              label="Applications"
              Icon={BriefcaseIcon}
              value={12}
              delta={{ value: 3, period: "last week", upIsGood: true }}
            />
            <StatTile plain label="Replies" Icon={MailIcon} value={4} note="Since Aug 4" />
          </div>
        </Row>
        <Row name="<StatTile>" role="The card form, which has no caller today">
          <div className="w-full max-w-56">
            <StatTile
              label="Interviews"
              Icon={CalendarIcon}
              value={2}
              delta={{ value: -1, period: "last week", upIsGood: true }}
            />
          </div>
        </Row>
        <Row name="<HeroArcs>" role="The corner arcs on both Dashboards' violet hero">
          <div className="from-brand to-brand-active text-on-brand rounded-shell relative h-28 w-full max-w-sm overflow-hidden bg-linear-to-br p-5">
            <HeroArcs />
            <p className="text-caption relative text-white/85 uppercase">Next Up</p>
          </div>
        </Row>
      </Group>

      <Group
        title="Job Postings"
        note="One card for the seeker's Jobs feed, its search results and the company composer's preview. Its facts are two fixed rows (location, work style, level; then job type, salary, start or years), so each sits in the same column on every card. What the board never said leaves its slot empty, which a screen reader hears as “not listed”, and the match rail waits for scoring."
      >
        <Row name="<JobPostingCard>" role="A fixture role, every fact known, with its match rail">
          <div className="w-full">
            <JobPostingCard
              job={{
                company: "Northwind",
                title: "Software Engineer, New Grad",
                timing: "Posted 3 hours ago",
                location: "New York, NY",
                jobType: "Full-Time",
                salary: "$120K - $140K/yr",
                workStyle: "Hybrid",
                experienceLevel: "New Grad",
                minYearsExperience: null,
              }}
              rail={
                <MatchRail
                  score={86}
                  highlights={[
                    { text: "TypeScript and React", met: true },
                    { text: "New grad friendly", met: true },
                    { text: "Wants Go experience", met: false },
                  ]}
                />
              }
              actions={
                <>
                  <SaveButton title="Software Engineer, New Grad" />
                  <Button size="sm">Apply Now</Button>
                </>
              }
            />
          </div>
        </Row>
        <Row
          name="NOT_LISTED"
          role="A scraped role: what the board never stated keeps its slot, empty, and no score yet"
        >
          <div className="w-full">
            <JobPostingCard
              job={{
                company: "Contoso",
                title: "Frontend Engineer",
                timing: NOT_LISTED,
                location: "Seattle, WA",
                jobType: NOT_LISTED,
                salary: NOT_LISTED,
                workStyle: NOT_LISTED,
                experienceLevel: "Experienced",
                minYearsExperience: NOT_LISTED,
              }}
              rail={<MatchRail score={null} highlights={[]} />}
            />
          </div>
        </Row>
        {SAMPLE_POSTING && (
          <Row
            name="<JobDetailHeader>"
            role="A job's own page, for seekers and companies alike: its facts, deadline and match rail"
          >
            <div className="w-full">
              <JobDetailHeader
                posting={SAMPLE_POSTING}
                tile={
                  <Avatar name={SAMPLE_POSTING.companyName} className="text-meta size-8 rounded" />
                }
                showDeadline
                actions={
                  <>
                    <SaveButton title={SAMPLE_POSTING.title} />
                    <Button size="lg" className="ml-auto shrink-0 @xl:ml-0">
                      Apply Now
                    </Button>
                  </>
                }
                rail={
                  <MatchRail
                    score={SAMPLE_POSTING.match ?? null}
                    highlights={SAMPLE_POSTING.highlights ?? []}
                    standalone
                  />
                }
              />
            </div>
          </Row>
        )}
      </Group>

      <Group title="Empty and Long-Form">
        <Row name="<EmptyState>" role="A list with nothing in it: what happened, then one way on">
          <Card padding="none" className="w-full max-w-md">
            <EmptyState
              Icon={BriefcaseIcon}
              title="No Roles Yet"
              action={<Button variant="secondary">Refresh</Button>}
            >
              New roles show up here as soon as they&apos;re posted.
            </EmptyState>
          </Card>
        </Row>
        <Row name="<Section> and <Points>" role="A job's long-form copy, on its detail page">
          <div className="w-full">
            <Section title="What You'll Do">
              <Points
                marker
                items={[
                  "Build the screens seekers use to track applications",
                  "Pair with design on the components in this kit",
                ]}
              />
            </Section>
          </div>
        </Row>
      </Group>

      <Group title="Everything Else">
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
            <SectionHeading
              as="h3"
              action={
                <Button variant="section">
                  <PlusIcon />
                  Add
                </Button>
              }
            >
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
