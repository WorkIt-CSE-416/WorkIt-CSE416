import { RADII, SECTIONS, SHADOWS, WIDTHS } from "../data";
import { TokenValue } from "../palette";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.shape.title };

export default function ShapePage() {
  return (
    <KitPage {...SECTIONS.shape}>
      <Group title="Radii">
        {RADII.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`bg-brand-tint border-border-subtle h-14 w-24 border ${cls}`} />
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

      <Group
        title="Widths"
        note="Each bar stops at its token's width, or at this column's edge when the token is wider than the column."
      >
        {WIDTHS.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <div className="flex w-full flex-col gap-1.5">
              <span className={`bg-brand-tint block h-2 w-full rounded-full ${cls}`} />
              <TokenValue token={token} />
            </div>
          </Row>
        ))}
      </Group>
    </KitPage>
  );
}
