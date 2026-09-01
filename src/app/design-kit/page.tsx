import type { Metadata } from "next";

import {
  AwardIcon,
  BellIcon,
  BookmarkIcon,
  BriefcaseIcon,
  CalendarIcon,
  EllipsisIcon,
  GearIcon,
  PinIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { Fact } from "@/components/ui/fact";
import { FilterChip } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";

import {
  BUTTON_ICON_SIZES,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  RADII,
  SHADOWS,
  TYPE_SCALE,
} from "./data";
import { DialogSpecimen, DropdownSpecimen } from "./interactive";
import { Palette } from "./palette";
import { Group, Row, Section } from "./specimen";

export const metadata: Metadata = {
  title: "Design kit · WorkIt",
  description: "Every token and component the app is built from.",
};

const SECTIONS = [
  { id: "colour", title: "Colour" },
  { id: "type", title: "Type" },
  { id: "shape", title: "Shape and elevation" },
  { id: "buttons", title: "Buttons" },
  { id: "forms", title: "Form controls" },
  { id: "display", title: "Display" },
  { id: "vendored", title: "Vendored" },
];

/**
 * The design kit — every token and component on one page.
 *
 * It exists to answer two questions without opening a mockup: what is this
 * token called, and what does that component actually look like beside its
 * siblings. Both are questions the KAN-43 screens keep raising, because the
 * three mockups disagree with each other in places that only show up when the
 * values sit next to one another (the surfaces conflict, the two 11px sizes).
 *
 * It sits outside both shells on purpose. Rendering it inside the seeker layout
 * would put a top bar above a page whose whole job is to show components in
 * isolation, and would make every specimen inherit a shell it does not need.
 */
export default function DesignKitPage() {
  return (
    <main className="max-w-app mx-auto px-6 py-10 sm:px-12">
      <header>
        <h1 className="text-heading text-ink">Design kit</h1>
        <p className="text-body text-ink-muted mt-2 max-w-prose">
          Every token in <code className="text-note font-mono">globals.css</code> and every
          component in <code className="text-note font-mono">src/components</code>, rendered from
          the same source the app uses. Nothing here is a screenshot — if a value changes, this page
          changes with it.
        </p>

        <nav aria-label="Sections" className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5">
          {SECTIONS.map(({ id, title }) => (
            <TextLink key={id} href={`#${id}`} className="text-label">
              {title}
            </TextLink>
          ))}
        </nav>
      </header>

      <div className="mt-10 flex flex-col gap-12">
        <Section
          id="colour"
          title="Colour"
          note="Swatches paint var(--token) directly and the value beside each is read back from the live stylesheet, so neither can drift from globals.css."
        >
          <Palette />
        </Section>

        <Section
          id="type"
          title="Type"
          note="Weight and letter-spacing are baked into each token, so a caption cannot be used without its tracking. Two sizes are both 11px — caption carries uppercase tracking and weight 600, meta carries neither."
        >
          {TYPE_SCALE.map(({ token, cls, role }) => (
            <Row key={token} name={token} role={role}>
              <span className={`${cls} text-ink`}>Software Engineer, New Grad</span>
            </Row>
          ))}
        </Section>

        <Section id="shape" title="Shape and elevation">
          <Group title="Radii">
            {RADII.map(({ token, cls, role }) => (
              <Row key={token} name={token} role={role}>
                <span className={`bg-brand-tint border-border-subtle size-12 border ${cls}`} />
              </Row>
            ))}
          </Group>
          <Group title="Elevation">
            {SHADOWS.map(({ token, cls, role }) => (
              <Row key={token} name={token} role={role}>
                <span
                  className={`bg-panel border-border-subtle rounded-card h-12 w-24 border ${cls}`}
                />
              </Row>
            ))}
          </Group>
        </Section>

        <Section
          id="buttons"
          title="Buttons"
          note="One component, shadcn's variant and size names, WorkIt's measured styling. Each variant has a natural size, so most call sites pass only a variant."
        >
          <Group title="Variants" note="Shown at each variant's own default size.">
            {BUTTON_VARIANTS.map(({ variant, note }) => (
              <Row key={variant} name={`variant="${variant}"`} role={note}>
                <Button variant={variant}>Apply Now</Button>
              </Row>
            ))}
          </Group>

          <Group
            title="Sizes"
            note="All on the default variant. `inline` is padding-free and WorkIt-only."
          >
            {BUTTON_SIZES.map((size) => (
              <Row key={size} name={`size="${size}"`}>
                <Button size={size}>Apply Now</Button>
              </Row>
            ))}
          </Group>

          <Group
            title="Icon sizes"
            note="Square, for shadcn components that ask for them. A bare glyph in WorkIt's own chrome is IconButton, below."
          >
            {BUTTON_ICON_SIZES.map((size) => (
              <Row key={size} name={`size="${size}"`}>
                <Button size={size} aria-label="More">
                  <EllipsisIcon className="size-4" />
                </Button>
              </Row>
            ))}
          </Group>

          <Group title="As a link" note="Navigation stays an anchor rather than becoming a button.">
            <Row name="<ButtonLink>" role="Renders a Next <Link> with button styling">
              <ButtonLink href="/jobs">Browse jobs</ButtonLink>
            </Row>
          </Group>
        </Section>

        <Section id="forms" title="Form controls">
          <Row name="<TextField>" role="Label, optional leading icon, optional label action">
            <div className="w-72">
              <TextField
                id="dk-email"
                label="Email"
                type="email"
                placeholder="you@university.edu"
              />
            </div>
          </Row>
          <Row name="<SearchField>" role="Visually-hidden label, leading search glyph">
            <div className="w-72">
              <SearchField id="dk-search" label="Search jobs" placeholder="Search jobs" />
            </div>
          </Row>
          <Row name="<FilterChip>" role="Toggle in a filter rail">
            <FilterChip label="Remote" active />
            <FilterChip label="Full-time" />
            <FilterChip label="Internship" />
          </Row>
        </Section>

        <Section id="display" title="Display">
          <Row name='<Badge variant="status">' role="Pill on an application card">
            <Badge variant="status" tone="brand">
              Round 2
            </Badge>
            <Badge variant="status" tone="positive">
              Offer
            </Badge>
            <Badge variant="status" tone="neutral">
              Applied
            </Badge>
          </Row>
          <Row name='<Badge variant="tag">' role="Skill pill on a profile">
            <Badge variant="tag">TypeScript</Badge>
            <Badge variant="tag">React</Badge>
          </Row>
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
        </Section>

        <Section
          id="vendored"
          title="Vendored"
          note="Pulled in with `npx shadcn add` and not restyled. They look like WorkIt because globals.css maps shadcn's role names onto WorkIt's tokens, and because they compose against the same Button as everything above."
        >
          <Row
            name="<Dialog>"
            role="Focus trap, Escape to close, scroll lock, focus restored on close"
          >
            <DialogSpecimen />
          </Row>
          <Row name="<DropdownMenu>" role="Roving focus, typeahead, arrow-key navigation">
            <DropdownSpecimen />
          </Row>
        </Section>
      </div>
    </main>
  );
}
