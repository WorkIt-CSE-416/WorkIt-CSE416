import { ONBOARDING_STEPS } from "@/app/onboarding/applicant/steps";
import { Stepper } from "@/components/stepper";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { SearchField } from "@/components/ui/search-field";
import { TextField } from "@/components/ui/text-field";

import { SECTIONS } from "../data";
import { ResumeUploadSpecimen, SegmentedSpecimen, SelectFieldSpecimen } from "../interactive";
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
        <Row
          name="<SegmentedToggle> / <SegmentedLinks>"
          role="One choice among a few, its thumb sliding to the pick: sm (36px) and lg (44px)"
        >
          <SegmentedSpecimen />
        </Row>
        <Row
          name="<Stepper>"
          role="The 1-2-3 rail over a flow: default in the job composer, lg (32px discs) in onboarding"
        >
          <div className="flex w-full max-w-lg flex-col gap-5">
            <Stepper steps={["Basic Details", "Screening", "Review"]} current={1} />
            <Stepper size="lg" steps={ONBOARDING_STEPS} current={1} />
          </div>
        </Row>
        <Row name="<SelectField>" role="Label wired by aria-labelledby, WorkIt's field height">
          <SelectFieldSpecimen />
        </Row>
        <Row name="<ResumeUpload>" role="Dropzone and file preview; the caller does the upload">
          <ResumeUploadSpecimen />
        </Row>
        <Row
          name="checkRowClasses + <CheckRowBox>"
          role="An option in a list of several picks: a multiple Select's and the Role filter's"
        >
          <div className="border-border-subtle bg-panel w-56 rounded-lg border p-1 shadow-md">
            <div className={checkRowClasses} data-selected="">
              Software Engineer
              <CheckRowBox />
            </div>
            <div className={checkRowClasses} data-highlighted="">
              Data Scientist
              <CheckRowBox />
            </div>
            <div className={checkRowClasses}>
              Product Manager
              <CheckRowBox />
            </div>
          </div>
        </Row>
      </div>
    </KitPage>
  );
}
