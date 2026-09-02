import { SECTIONS, TYPE_SCALE } from "../data";
import { KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.type.title };

export default function TypePage() {
  return (
    <KitPage {...SECTIONS.type}>
      <div>
        {TYPE_SCALE.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`${cls} text-ink`}>Software Engineer, New Grad</span>
          </Row>
        ))}
      </div>
    </KitPage>
  );
}
