import { FilterChip } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";
import { TextField } from "@/components/ui/text-field";

import { SECTIONS } from "../data";
import { ResumeUploadSpecimen, SelectFieldSpecimen } from "../interactive";
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
            <SearchField id="dk-search" label="Search Jobs" placeholder="Search jobs" />
          </div>
        </Row>
        <Row name="<SelectField>" role="Label wired by aria-labelledby, WorkIt's field height">
          <SelectFieldSpecimen />
        </Row>
        <Row name="<ResumeUpload>" role="Dropzone and file preview; the caller does the upload">
          <ResumeUploadSpecimen />
        </Row>
        <Row name="<FilterChip>" role="Toggle in a filter rail">
          <FilterChip label="Remote" active />
          <FilterChip label="Full-Time" />
          <FilterChip label="Internship" />
        </Row>
      </div>
    </KitPage>
  );
}
