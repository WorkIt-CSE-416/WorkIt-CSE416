import { EllipsisIcon } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/button";

import { BUTTON_ICON_SIZES, BUTTON_SIZES, BUTTON_VARIANTS, SECTIONS } from "../data";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.buttons.title };

export default function ButtonsPage() {
  return (
    <KitPage {...SECTIONS.buttons}>
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

      <Group title="As a link" note="Navigation stays an anchor rather than becoming a button.">
        <Row name="<ButtonLink>" role="Renders a Next <Link> with button styling">
          <ButtonLink href="/jobs">Browse jobs</ButtonLink>
        </Row>
      </Group>
    </KitPage>
  );
}
