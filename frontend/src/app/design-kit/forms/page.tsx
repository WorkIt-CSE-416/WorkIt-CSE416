import { ONBOARDING_STEPS } from "@/app/onboarding/applicant/steps";
import { Stepper } from "@/components/stepper";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { LinkedInGlyph } from "@/app/(seeker)/profile/icons";
import { SearchField } from "@/components/ui/search-field";
import { TextField, TextInput } from "@/components/ui/text-field";

import { SECTIONS } from "../data";
import { TextAreaField } from "@/components/text-area-field";

import {
  ChoiceSpecimen,
  DateFieldSpecimen,
  GlyphSelectSpecimen,
  MonthFieldSpecimen,
  ResumeUploadSpecimen,
  SegmentedSpecimen,
  SelectFieldSpecimen,
} from "../interactive";
import { FieldFacetStates, MultiSelectSpecimen, SortMenuSpecimen } from "../parts";
import { Group, KitPage, Row } from "../specimen";
import { SelectFieldStates, StateCell, StateCells } from "../states";

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
        <Row
          name={'<TextField size="lg" labelIcon>'}
          role="Onboarding's field: 16px type, 44px box, a glyph before its 14px label"
        >
          <div className="w-72">
            <TextField
              id="dk-linkedin"
              label="LinkedIn"
              labelIcon={LinkedInGlyph}
              size="lg"
              placeholder="linkedin.com/in/your-name"
            />
          </div>
        </Row>
        <Row name="<TextInput>" role="TextField's bare box, for a field a section heading names">
          <div className="w-72">
            <TextInput aria-label="Location" placeholder="Stony Brook, NY" />
          </div>
        </Row>
        <Row
          name="<SearchField>"
          role="White pill with a control edge, visually-hidden label, leading search glyph"
        >
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
        <Row
          name="<SelectField> with glyphs"
          role="An option's Icon and colour, or a leading logo, drawn as the filters draw them"
        >
          <GlyphSelectSpecimen />
        </Row>
        <Row
          name="<FieldFacet>"
          role="The filter over a page's items: a dropdown of checkbox rows, tinted while it holds a pick"
        >
          <FieldFacetStates />
        </Row>
        <Row
          name="<SortMenu>"
          role="A list's order, drawn as a filter is; never tinted, since an order is always in force"
        >
          <SortMenuSpecimen />
        </Row>
        <Row
          name="<Select multiple> + <SelectCheckboxItem>"
          role="ui/select: shadcn's Select opening below its trigger, with a checkbox row for several picks"
        >
          <MultiSelectSpecimen />
        </Row>
        <Row name="<DateField>" role="WorkIt's calendar in a popover, never the browser's picker">
          <DateFieldSpecimen />
        </Row>
        <Row name="<TextAreaField>" role="A multi-line box drawn as <TextField> is">
          <div className="w-72">
            <TextAreaField id="dk-note" label="Note" rows={2} />
          </div>
        </Row>
        <Row name="<TextAreaField grow>" role="A box that grows with its text: a written answer">
          <div className="w-72">
            <TextAreaField id="dk-answer" label="Your Answer" rows={2} grow />
          </div>
        </Row>
        <Row
          name="<MonthField>"
          role="A year and its twelve months in a popover, never the browser's month picker"
        >
          <MonthFieldSpecimen />
        </Row>
        <Row
          name="<ChoiceTile> / <RadioRow>"
          role="A tile: one answer on a one-question screen. A radio row: one pick in a form's list"
        >
          <ChoiceSpecimen />
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

      <Group
        title="Field States"
        note="A field has no hover look; Focus is forced from the app's stylesheet, as the Tab key or a click draws it. Invalid outlines the box red and names the problem under it in text-note danger. Disabled fades to half and takes no input."
      >
        <Row name="<TextField>" className="sm:grid-cols-1">
          <StateCells>
            <StateCell label="Empty">
              <div className="w-48">
                <TextField id="dk-state-empty" label="School" placeholder="Your school" />
              </div>
            </StateCell>
            <StateCell label="Filled">
              <div className="w-48">
                <TextField id="dk-state-filled" label="School" defaultValue="Stony Brook" />
              </div>
            </StateCell>
            <StateCell label="Focus" state="focus">
              <div className="w-48">
                <TextField id="dk-state-focus" label="School" placeholder="Your school" />
              </div>
            </StateCell>
            <StateCell label="Invalid">
              <div className="flex w-48 flex-col gap-1">
                <TextField
                  id="dk-state-invalid"
                  label="Email"
                  defaultValue="alex@"
                  aria-invalid
                  aria-describedby="dk-state-invalid-error"
                />
                <p id="dk-state-invalid-error" className="text-note text-danger">
                  Enter a full email address
                </p>
              </div>
            </StateCell>
            <StateCell label="Disabled">
              <div className="w-48">
                <TextField
                  id="dk-state-disabled"
                  label="School"
                  defaultValue="Stony Brook"
                  disabled
                />
              </div>
            </StateCell>
          </StateCells>
        </Row>
        <Row name="<SelectField>" className="sm:grid-cols-1">
          <SelectFieldStates />
        </Row>
      </Group>
    </KitPage>
  );
}
