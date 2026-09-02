import { SECTIONS } from "../data";
import { DialogSpecimen, DropdownSpecimen } from "../interactive";
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
        <Row name="<DropdownMenu>" role="Roving focus, typeahead, arrow-key navigation">
          <DropdownSpecimen />
        </Row>
      </div>
    </KitPage>
  );
}
