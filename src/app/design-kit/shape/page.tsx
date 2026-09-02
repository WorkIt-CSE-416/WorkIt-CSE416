import { RADII, SECTIONS, SHADOWS } from "../data";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.shape.title };

export default function ShapePage() {
  return (
    <KitPage {...SECTIONS.shape}>
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
    </KitPage>
  );
}
