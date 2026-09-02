import { FilterChip } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";
import { TextField } from "@/components/ui/text-field";

import { SECTIONS } from "../data";
import { KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.forms.title };

export default function FormsPage() {
  return (
    <KitPage {...SECTIONS.forms}>
      <div>
        <Row name="<TextField>" role="Label, optional leading icon, optional label action">
          <div className="w-72">
            <TextField id="dk-email" label="Email" type="email" placeholder="you@university.edu" />
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
      </div>
    </KitPage>
  );
}
