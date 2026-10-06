import { SECTIONS, SHADCN_SIZES, TYPE_SCALE, TYPEFACES } from "../data";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.type.title };

export default function TypePage() {
  return (
    <KitPage {...SECTIONS.type}>
      <Group title="Typefaces">
        {TYPEFACES.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`${cls} text-body text-ink`}>Software Engineer, New Grad</span>
          </Row>
        ))}
      </Group>

      <Group title="Scale">
        {TYPE_SCALE.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`${cls} text-ink`}>Software Engineer, New Grad</span>
          </Row>
        ))}
      </Group>

      <Group
        title="shadcn Sizes"
        note="What a vendored component's stock size resolves to. Bound in globals.css rather than restyled per component, the same way its colour roles are, so a menu row moves with --text-body. A vendored title is 16px medium, a pairing the scale has no token for, so each call site passes text-subtitle font-semibold, the size and weight of an empty state's heading."
      >
        {SHADCN_SIZES.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`${cls} text-ink`}>Software Engineer, New Grad</span>
          </Row>
        ))}
      </Group>
    </KitPage>
  );
}
