import { SECTIONS } from "../data";
import { DialogSpecimen, DropdownSpecimen, SwitchSpecimen } from "../interactive";
import { KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.vendored.title };

export default function VendoredPage() {
  return (
    <KitPage {...SECTIONS.vendored}>
      <div>
        <Row
          name="<Dialog>"
          role="Focus trap, Escape to close, scroll lock, focus restored on close"
        >
          <DialogSpecimen />
        </Row>
        <Row
          name="<DropdownMenu>"
          role="Roving focus, typeahead, arrow-key navigation; rows are medium, like every control"
        >
          <DropdownSpecimen />
        </Row>
        <Row name="<Switch>" role="An on/off setting (Settings' Notifications)">
          <SwitchSpecimen />
        </Row>
      </div>
    </KitPage>
  );
}
