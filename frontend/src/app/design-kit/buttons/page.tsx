import { CheckIcon, EllipsisIcon, PlusIcon, SearchIcon, SparkleIcon } from "@/components/icons";
import { SaveButton } from "@/components/save-button";
import { Button, ButtonLink } from "@/components/ui/button";
import { Chip, ChipLink } from "@/components/ui/chip";
import { FilterChip } from "@/components/ui/filter-chip";
import { SectionLink } from "@/components/ui/section-link";

import { BUTTON_ICON_SIZES, BUTTON_SIZES, BUTTON_VARIANTS, CHIP_VARIANTS, SECTIONS } from "../data";
import { RemovableChipSpecimen } from "../interactive";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.buttons.title };

/**
 * Buttons and chips (KAN-251): the two shapes, each size with its role, and
 * the chip's roles. Every specimen is the real component at its real size,
 * with nothing set at the call site, which is the rule the page teaches.
 */
export default function ButtonsPage() {
  return (
    <KitPage {...SECTIONS.buttons}>
      <Group
        title="Button or Chip"
        note="A button acts: it saves, opens, sends or goes somewhere, and it is a rounded rectangle. A chip is a choice made in place, a filter, a toggle or an offered answer, and it is a pill. A badge is a pill too, but it is a label you cannot press. An sm button and a chip are both 36px, so a row of them lines up."
      >
        <Row name="sm <Button> beside a <Chip>" role="One height in one row">
          <Button size="sm">
            <SearchIcon /> Find Jobs
          </Button>
          <Button size="sm" variant="secondary">
            Save
          </Button>
          <Chip pressed>
            <CheckIcon /> Remote
          </Chip>
          <Chip>Internship</Chip>
        </Row>
      </Group>

      <Group title="Variants" note="Shown at each variant's own default size.">
        {BUTTON_VARIANTS.map(({ variant, note }) => (
          <Row key={variant} name={`variant="${variant}"`} role={note}>
            <Button variant={variant}>Apply Now</Button>
          </Row>
        ))}
      </Group>

      <Group
        title="Sizes"
        note="Pick a size by where the button sits, never by how big it should look. Every variant at a size is the same box, a text-only one included. An icon with no size class is 16px (14px at inline, xs and section)."
      >
        {BUTTON_SIZES.map(({ size, note }) => (
          <Row key={size} name={`size="${size}"`} role={note}>
            <Button size={size}>Apply Now</Button>
            {/* inline has no box, and no screen draws a bordered one. */}
            {size !== "inline" && (
              <Button size={size} variant="secondary">
                <SparkleIcon /> Ask Scout
              </Button>
            )}
          </Row>
        ))}
      </Group>

      <Group
        title="Chips"
        note="Two sizes: default 36px with 13px type, and lg 42px with 16px type for a screen whose question the chips are (onboarding). A 14px glyph in both. A chip's colour comes from its role; only a stage filter paints its own pressed tint, since a stage owns its colour."
      >
        {CHIP_VARIANTS.map(({ variant, pressed, note }) => (
          <Row
            key={`${variant}-${pressed}`}
            name={`<Chip variant="${variant}"${pressed ? " pressed" : ""}>`}
            role={note}
          >
            <Chip variant={variant} pressed={pressed}>
              {pressed && <CheckIcon />}
              {variant === "suggestion" && <PlusIcon />}
              {variant === "primary" ? "Use This" : variant === "suggestion" ? "Python" : "Remote"}
            </Chip>
          </Row>
        ))}
        <Row name='<Chip size="lg">' role="42px, 16px type: onboarding's answers">
          <Chip size="lg" pressed>
            <CheckIcon /> $35+/hr
          </Chip>
          <Chip size="lg">$45+/hr</Chip>
        </Row>
        <Row name="<ChipLink pressed>" role="A filter kept in the URL; says it is on in words">
          <ChipLink href="/design-kit/buttons" pressed>
            Interviewing
          </ChipLink>
          <ChipLink href="/design-kit/buttons">Offer</ChipLink>
        </Row>
        <Row
          name="<RemovableChip>"
          role="A picked value with a cross: the place, role and season picks"
        >
          <RemovableChipSpecimen />
        </Row>
        <Row name="<FilterChip>" role="A facet with a menu behind it, then a cross once applied">
          <FilterChip label="Remote" active />
          <FilterChip label="Full-Time" />
        </Row>
      </Group>

      <Group
        title="Icon Sizes"
        note="Square, for shadcn components that ask for them. A bare glyph in WorkIt's own chrome is IconButton, under Display."
      >
        {BUTTON_ICON_SIZES.map((size) => (
          <Row key={size} name={`size="${size}"`}>
            <Button size={size} aria-label="More">
              <EllipsisIcon className="size-4" />
            </Button>
          </Row>
        ))}
      </Group>

      <Group title="As a Link" note="Navigation stays an anchor rather than becoming a button.">
        <Row name="<ButtonLink>" role="Renders a Next <Link> with button styling">
          <ButtonLink href="/jobs">Browse Jobs</ButtonLink>
        </Row>
        <Row
          name="<SectionLink>"
          role="An open section's one way onward, at the top right of its heading"
        >
          <SectionLink href="/design-kit/buttons" label="View All Applicants">
            View All
          </SectionLink>
        </Row>
      </Group>

      <Group title="On a Job">
        <Row
          name="<SaveButton>"
          role="The one Save control on every job surface, unsaved then saved"
        >
          <SaveButton title="Software Engineer, New Grad" />
          <SaveButton title="Software Engineer, New Grad" saved />
        </Row>
      </Group>
    </KitPage>
  );
}
