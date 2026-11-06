"""Seam 2: the Workday Filler against a saved Workday posting (real up to the
sign-in step) and the fake Workday's steps after it (tests/fake_workday.py)."""

from dataclasses import replace
from datetime import datetime

import pytest
from conftest import FIXTURES, FORMS
from fake_workday import (
    EDUCATION,
    EXPERIENCE_STEPS,
    FIELDS_OF_STUDY,
    MY_EXPERIENCE,
    STEPS,
    FakeWorkdayServer,
    Field,
)
from fakes import FakeClaude, FakeClock, FakeMailbox

from apply import workday
from apply.accounts import Accounts
from apply.claude_fill import OnePage
from apply.keychain import InMemoryKeychain
from apply.model import FillError, Handoff, MoreQuestions
from apply.plain.bridge import PortTimeoutError
from apply.rescue import Rescue
from apply.workday import WorkdayFiller

CACI_FORM = FORMS / "workday-caci"
CACI_URL = "https://caci.wd1.myworkdayjobs.com/external/job/Florham-Park-NJ-US/Software-Engineering-Intern---Summer-2027_332543"
CACI = "caci.wd1.myworkdayjobs.com"
NOW = datetime(2026, 10, 15, 9, 30)
ONE_PAGER = FIXTURES / "one-pager.pdf"

# The answers a plan would give, by question label.
ANSWERS = {
    "How Did You Hear About Us?": "Company Website",
    "Have you previously worked for this company?": "No",
    "Country": "United States of America",
    "First Name": "Test",
    "Last Name": "Person",
    "State": "Ohio",
    "Phone Device Type": "Mobile",
    "Phone Number": "555 010 0199",
    "Resume/CV": ONE_PAGER,
    "LinkedIn": "https://www.linkedin.com/in/test-person",
    "Are you legally authorized to work in the United States?": "Yes",
    "Will you now or in the future require sponsorship for employment visa status?": "No",
    "Gender": "I do not wish to answer",
    "Please select the ethnicity which most accurately describes how you identify yourself": "I do not wish to answer",
    "Veteran Status": "I am not a protected veteran",
    "Yes, I have read and consent to the terms and conditions": "Yes",
    "Name": "Test Person",
    "Disability Status": "No, I do not have a disability and have not had one in the past",
}


# Snap's My Experience: how many panels each repeating section gets, and each panel's answers.
EXPERIENCE = {
    "Work Experience (entries)": "2",
    "Work Experience 1 / Job Title": "Software Engineer Intern, Onboard Systems",
    "Work Experience 1 / Company": "Hitachi Rail",
    "Work Experience 1 / Location": "Woodbury, NY",
    "Work Experience 1 / I currently work here": "No",
    "Work Experience 1 / From (MM/YYYY)": "06/2026",
    "Work Experience 1 / To (MM/YYYY)": "08/2026",
    "Work Experience 2 / Job Title": "Software Engineer Intern",
    "Work Experience 2 / Company": "Cloud Data Pro",
    "Work Experience 2 / Location": "Remote",
    "Work Experience 2 / I currently work here": "No",
    "Work Experience 2 / From (MM/YYYY)": "06/2024",
    "Work Experience 2 / To (MM/YYYY)": "08/2024",
    "Education (entries)": "1",
    "Education 1 / School or University": "Stony Brook University",
    "Education 1 / Degree": "B.S.",
    "Education 1 / Field of Study": "Computer Science",
    "Education 1 / Overall Result (GPA)": "3.77",
    "Education 1 / From (YYYY)": "2024",
    "Education 1 / To (Actual or Expected) (YYYY)": "2028",
}


def fill_all(filler, page, questions, given=ANSWERS):
    """Fill the form step by step, as the Worker does: answer each step's
    questions as fill() reveals them. Returns the questions and the readback."""
    while True:
        answers = {q.name: given[q.label] for q in questions if q.label in given}
        try:
            return questions, answers, filler.fill(page, questions, answers)
        except MoreQuestions as more:
            questions = questions + more.questions


def test_creates_an_account_fills_every_step_reads_it_back_and_stops_before_submit():
    keychain, created = InMemoryKeychain(), []
    accounts = Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI", created.append)
    filler = WorkdayFiller(accounts)

    # Workday shows a step's name late (seen live): it is waited for, not taken for the last step.
    with FakeWorkdayServer(CACI_FORM, keychain=keychain, step_name_delay=1.5) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            questions, answers, readback = fill_all(filler, page, questions)

    [account] = server.created
    assert (account["host"], account["email"]) == (CACI, "test.person@example.com")
    assert keychain.password(CACI) == account["password"] == account["keychain"]  # in Keychain before it was sent
    assert [(a.company, a.site, a.login) for a in created] == [("CACI", CACI, "test.person@example.com")]
    # The first step's questions are read before anything is filled.
    assert [q.label for q in questions][:3] == ["How Did You Hear About Us?", "Have you previously worked for this company?", "Country"]
    assert {q.label: q.kind for q in questions}["Resume/CV"] == "file"
    assert readback == {**answers, next(q.name for q in questions if q.label == "Resume/CV"): "one-pager.pdf"}
    assert server.submissions == []


def test_a_checkbox_ticked_before_workday_wires_it_is_ticked_again_until_workday_holds_it():
    # Axiom's Self Identify (live): the box showed ticked, but Workday said it had no value.
    statuses = ("Yes, I have a disability, or have had one in the past",
                "No, I do not have a disability and have not had one in the past", "I do not want to answer")
    steps = [("Self Identify", [
        Field("acceptTermsAndAgreements", "Yes, I have read and consent to the terms and conditions", "checkbox", True),
        Field("disabilityStatus", "Please check one of the boxes below:", "checkboxes", True, statuses),
    ])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))
    given = {"Yes, I have read and consent to the terms and conditions": "Yes",
             "Please check one of the boxes below:": [statuses[1]]}

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps, box_wiring=1.5) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            page.reload()  # the step shows anew, its boxes not yet wired
            fill_all(filler, page, questions, given)
            filler.submit(page)

    assert server.submissions[0].application["acceptTermsAndAgreements"] is True
    assert server.submissions[0].application["disabilityStatus"] == [statuses[1]]


def test_a_date_is_typed_key_by_key_even_where_it_shows_already():
    # Axiom's Self Identify (live): a date set without keystrokes, or saved on an earlier visit,
    # showed in its spin buttons, but Workday said the field had no value.
    steps = [("Self Identify", [Field("dateSignedOn", "Date", "date", True, format="MM/DD/YYYY")])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [date] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            page.evaluate("""() => document.querySelectorAll('[data-automation-id$=-input]')
                .forEach((input, n) => { input.value = ['10', '16', '2026'][n]; })""")  # shown, not held
            readback = filler.fill(page, [date], {date.name: "10/16/2026"})
            filler.submit(page)

    assert readback == {date.name: "10/16/2026"}
    assert server.submissions[0].application["dateSignedOn"] == "10/16/2026"


def test_a_date_saved_on_an_earlier_visit_is_typed_over_whole():
    # Axiom's My Experience, filled again (live): typed into, saved dates garbled into 1/6202.
    steps = [("My Experience", [Field("startDate", "From", "date", True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [date] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            page.evaluate("""() => document.querySelectorAll('[data-automation-id$=-input]')
                .forEach((input, n) => { input.dataset.held = input.value = ['01', '2025'][n]; })""")  # saved before
            readback = filler.fill(page, [date], {date.name: "06/2026"})
            filler.submit(page)

    assert readback == {date.name: "06/2026"}
    assert server.submissions[0].application["startDate"] == "06/2026"


def test_a_last_step_named_other_than_review_is_where_filling_stops_and_nothing_is_sent():
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, review="Review and Submit") as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            fill_all(filler, page, questions)
            assert server.submissions == []  # its Submit is the Filler's submit() to click
            filler.submit(page)

    [sent] = server.submissions
    assert sent.application["legalName--firstName"] == "Test"


def test_reads_a_dropdowns_options_beside_a_prompt_workday_preset():
    # Snap's My Information presets Country Phone Code; its chosen item sits in a
    # role=listbox list of its own, which is not the dropdown's options (seen live).
    steps = [("My Information", [
        Field("countryPhoneCode", "Country Phone Code", "prompt", True, ("United States of America (+1)",),
              chosen=("United States of America (+1)",)),
        Field("country", "Country", "dropdown", True, ("Canada", "United States of America")),
    ])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)

    assert {q.label: q.options for q in questions}["Country"] == ("Canada", "United States of America")
    assert "Country Phone Code" not in [q.label for q in questions]  # Workday answered it already


# A nested prompt other than How Did You Hear About Us?, whose sources the engine never reads but searches
# for (KAN-369): its choices are read, and a tenant's tree of them saved.
SOURCE = "Source"


def test_reads_and_fills_a_prompt_whose_search_box_is_bare():
    # Snap's prompts' search boxes carry neither an automation id nor a type attribute (seen live).
    steps = [("My Information", [
        Field("source", SOURCE, "prompt", True, ("Company Website", "LinkedIn"), bare=True),
    ])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [question] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [question], {question.name: "LinkedIn"})

    assert question.options == ("Company Website", "LinkedIn")
    assert readback == {question.name: "LinkedIn"}


def test_how_did_you_hear_is_searched_for_its_answer_never_read():
    # Reading its sources took 14 s on Adobe (live): the engine searches the prompt for the answer instead.
    steps = [("My Information", [
        Field("source", "How Did You Hear About Us?", "prompt", True, ("Company Website", "LinkedIn"), bare=True),
    ])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [question] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [question], {question.name: "LinkedIn"})

    assert question.options == ()
    assert readback == {question.name: "LinkedIn"}


def test_fills_a_panel_of_each_repeating_section_per_entry_and_reads_each_back():
    # Snap's My Experience requires Work Experience and Education, each showing
    # one empty panel; its dates are MM/YYYY (or YYYY) spin buttons (seen live).
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=EXPERIENCE_STEPS) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            questions, _answers, readback = fill_all(filler, page, questions, ANSWERS | EXPERIENCE)
            filler.submit(page)

    shown = {q.label: readback[q.name] for q in questions if q.name in readback}
    # Workday's search for the major picked its one match, in its own wording, for the Pre-submit check to see.
    assert {label: shown[label] for label in EXPERIENCE} == EXPERIENCE | {"Education 1 / Field of Study": "Computer and Information Science"}
    assert "Websites (entries)" in [q.label for q in questions]  # a section nothing answers gets no panel
    [sent] = server.submissions
    assert sent.application["workExperience"] == [
        {"jobTitle": "Software Engineer Intern, Onboard Systems", "companyName": "Hitachi Rail", "location": "Woodbury, NY",
         "currentlyWorkHere": False, "startDate": "06/2026", "endDate": "08/2026", "roleDescription": ""},
        {"jobTitle": "Software Engineer Intern", "companyName": "Cloud Data Pro", "location": "Remote",
         "currentlyWorkHere": False, "startDate": "06/2024", "endDate": "08/2024", "roleDescription": ""},
    ]
    assert sent.application["education"] == [
        {"schoolName": "Stony Brook University", "degree": "B.S.", "fieldOfStudy": ["Computer and Information Science"],
         "gradeAverage": "3.77", "firstYearAttended": "2024", "lastYearAttended": "2028"},
    ]
    assert sent.application["websites"] == []
    assert sent.files["resumeAttachments"] == ONE_PAGER.read_bytes()  # "Upload a file", in the group titled Resume/CV


def test_entries_filled_again_on_a_later_visit_are_kept():
    # NVIDIA keeps only the entries changed on a visit; typed again unchanged, Cloud Data Pro was dropped (seen live).
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=EXPERIENCE_STEPS, drops_untouched=True) as server, \
            OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            questions, answers, _ = fill_all(filler, page, questions, ANSWERS | EXPERIENCE)
            page.goto(f"https://{CACI}/__fake__/apply/2")  # My Experience again, as a second rehearsal finds it
            filler.fill(page, questions, answers)
            filler.submit(page)

    [sent] = server.submissions
    assert [job["companyName"] for job in sent.application["workExperience"]] == ["Hitachi Rail", "Cloud Data Pro"]


def test_a_searched_major_is_the_tenants_own_computer_science_where_it_has_one():
    # Beside the wordings Lisul accepts where a tenant has none (AmFam's, live).
    majors = (*FIELDS_OF_STUDY, "Computer Science", "Computer Science and Engineering")
    education = replace(EDUCATION, fields=tuple(replace(f, options=majors) if f.key == "fieldOfStudy" else f
                                                 for f in EDUCATION.fields))
    title, sections = MY_EXPERIENCE
    steps = [STEPS[0], (title, [education if s is EDUCATION else s for s in sections]), *STEPS[2:]]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            questions, _answers, readback = fill_all(filler, page, questions, ANSWERS | EXPERIENCE)

    shown = {q.label: readback[q.name] for q in questions if q.name in readback}
    assert shown["Education 1 / Field of Study"] == "Computer Science"


def test_a_searched_tree_whose_categories_list_only_their_first_choices_is_searched():
    # Applied Materials' Field of Study lists "Partial List (First 500 Entries)" and "All", each
    # showing only its first choices: read as the whole list, it had no Computer Science, and was
    # left empty, so My Experience wouldn't save (seen live).
    majors = ("Accounting", "Actuarial Science", "Advertising", "Computer Engineering", "Computer Science",
              "Computer Science and Engineering", "Mathematics")
    field = Field("fieldOfStudy", "Field of Study", "prompt", True, majors, search=True,
                  tree=(("Partial List (First 500 Entries)", majors[:5]), ("All", majors)))
    steps = [("My Experience", [field])]

    def apply_once():
        keychain = InMemoryKeychain()
        filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))
        with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
            [major] = filler.question_set(CACI_URL, site)
            with site.open(CACI_URL) as page:
                readback = filler.fill(page, [major], {major.name: "Computer Science"})
                filler.submit(page)
        return major.options, readback[major.name], server.submissions[0].application["fieldOfStudy"]

    assert apply_once() == ((), "Computer Science", ["Computer Science"])
    assert apply_once() == ((), "Computer Science", ["Computer Science"])  # the tenant's saved tree says to search it


def test_a_search_offering_its_value_twice_in_different_case_picks_the_one_written_as_it():
    # Applied Materials' Field of Study search offers both "Computer science" and "Computer Science" (seen live).
    majors = ("Computer and Information Science", "Computer science", "Computer Science", "Computer Science and Engineering")
    steps = [("My Experience", [Field("fieldOfStudy", "Field of Study", "prompt", True, majors, search=True, opens_empty=True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [major] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [major], {major.name: "Computer Science"})
            filler.submit(page)

    assert readback == {major.name: "Computer Science"}
    assert server.submissions[0].application["fieldOfStudy"] == ["Computer Science"]


def test_continues_an_application_its_worker_profile_already_started():
    # Snap's posting offers Continue Application, not Apply, to a Worker profile
    # that started the application in an earlier rehearsal (seen live).
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, in_progress=True) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)

    assert questions[0].label == "How Did You Hear About Us?"
    assert server.created == [] and server.sign_ins == []


def test_a_step_workday_wont_leave_is_a_handoff_naming_what_it_wants():
    steps = [("My Information", [Field("legalName--firstName", "First Name", "text", True),
                                 Field("legalName--middleName", "Middle Name", "text", True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page, pytest.raises(Handoff, match="won't leave its 'My Information' step.*Middle Name"):
            filler.fill(page, questions, {questions[0].name: "Test"})


# Field AI's attestation (the engine's research forms), on a Workday step (KAN-676).
CERTIFY = "I certify that the information provided in this application is true, complete, and accurate to the best of my knowledge."


def test_a_required_attestation_stops_the_form_on_its_step_with_one_ask_and_is_never_ticked():
    steps = [("Voluntary Disclosures", [Field("legalName--firstName", "First Name", "text", True),
                                        Field("certify", CERTIFY, "checkbox", True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            with pytest.raises(Handoff) as stopped:
                filler.fill(page, questions, {questions[0].name: "Test"})
            assert not page.get_by_label(CERTIFY).is_checked()

    assert str(stopped.value) == f"Tick '{CERTIFY}' yourself on this page, then press Resume: Apply never attests or signs for you."


def test_fills_a_follow_up_question_workday_shows_once_its_question_is_answered():
    spouse = "Is your current U.S. work authorization based on your status as a spouse of an H-1B, L-1, or E-1/E-2/E-3 visa holder?"
    steps = [("Application Questions", [
        Field("authorized", "Are you legally authorized to work in the United States?", "dropdown", True, ("Yes", "No")),
        Field("spouse", spouse, "dropdown", True, ("Yes", "No"), shown_if=("authorized", "Yes")),
    ])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            questions, _, _readback = fill_all(filler, page, questions, ANSWERS | {spouse: "No"})
            filler.submit(page)

    assert [q.label for q in questions] == ["Are you legally authorized to work in the United States?", spouse]
    [sent] = server.submissions
    assert (sent.application["authorized"], sent.application["spouse"]) == ("Yes", "No")


def test_a_step_filled_again_keeps_its_resume_attached_once():
    # RTX's uploader takes several files: an application continued later already had the résumé (seen live).
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            questions, answers, _ = fill_all(filler, page, questions)
            page.goto(page.url.replace("/apply/6", "/apply/2"))  # back to My Experience
            readback = filler.fill(page, questions, answers)

    resume = next(q.name for q in questions if q.label == "Resume/CV")
    assert readback[resume] == "one-pager.pdf"


def test_searches_a_prompt_that_lists_no_items_until_searched():
    # AmFam's School or University lists only "No Items." when opened (seen live).
    steps = [("My Experience", [Field("school", "School or University", "prompt", True,
                                      ("Stony Brook University", "Stony Brook School", "Ohio State University"),
                                      search=True, opens_empty=True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [school] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [school], {school.name: "Stony Brook University"})

    assert school.options == ()
    assert readback == {school.name: "Stony Brook University"}


def test_picks_a_nested_prompts_answer_from_inside_its_category_and_reads_it_back():
    # Workday's own How Did You Hear About Us? lists categories first; each opens
    # its own list of sources (seen live: left empty, the step wouldn't save).
    steps = [("My Information", [
        Field("source", SOURCE, "prompt", True,
              tree=(("University", ("Career Fair", "Professor")),
                    ("Website", ("Company Website", "Workday.com")),
                    ("Job Board", ("Indeed", "LinkedIn")),
                    ("Other", ()))),
    ])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [source] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [source], {source.name: "Company Website"})
            filler.submit(page)

    assert source.options == ("Career Fair", "Professor", "Company Website", "Workday.com", "Indeed", "LinkedIn", "Other")
    assert readback == {source.name: "Company Website"}
    assert server.submissions[0].application["source"] == ["Company Website"]


def test_reads_a_nested_prompt_whose_category_holds_a_choice_of_its_own_name():
    # Axiom's Employee Referral category lists Employee Referral among its sources (seen live).
    steps = [("My Information", [
        Field("source", SOURCE, "prompt", True,
              tree=(("Career Websites", ("Corporate Website",)),
                    ("Employee Referral", ("Connection In The Company", "Employee Referral")),
                    ("Job Sites", ("Indeed", "LinkedIn")))),
    ])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [source] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [source], {source.name: "Corporate Website"})

    assert source.options == ("Corporate Website", "Connection In The Company", "Employee Referral", "Indeed", "LinkedIn")
    assert readback == {source.name: "Corporate Website"}


SOURCES = (("University", ("Career Fair", "Professor")),
           ("Website", ("Company Website", "Workday.com")),
           ("Job Board", ("Indeed", "LinkedIn")),
           ("Other", ()))


def apply_once(tree, answer):
    """One Application's nested Source prompt, on a new Filler: its options,
    readback, what was sent, and how many categories Workday was asked to open."""
    steps = [("My Information", [Field("source", SOURCE, "prompt", True, tree=tree)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))
    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [source] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            read = page.evaluate("Number(sessionStorage.categoriesOpened || 0)")
            readback = filler.fill(page, [source], {source.name: answer})
            opened = page.evaluate("Number(sessionStorage.categoriesOpened || 0)")
            filler.submit(page)
    return source.options, readback, server.submissions[0].application["source"], read, opened


def test_a_later_application_on_the_tenant_picks_from_its_saved_categories_without_opening_each():
    # Workday's own How Did You Hear About Us? took 14 s to read, category by category (Adobe, live).
    first = apply_once(SOURCES, "Company Website")
    options, readback, sent, read, opened = apply_once(SOURCES, "Company Website")

    assert first[3] == 3  # the first read opened each category with choices
    assert options == first[0]
    assert read == 0 and opened == 1  # only the answer's own category, to pick it
    assert readback == {f"My Information / {SOURCE}": "Company Website"}
    assert sent == ["Company Website"]


def test_a_saved_choice_moved_to_another_category_is_found_by_reading_the_categories_again():
    apply_once(SOURCES, "Company Website")
    moved = (("University", ("Career Fair", "Professor")),
             ("Website", ("Workday.com",)),
             ("Job Board", ("Company Website", "Indeed", "LinkedIn")),
             ("Other", ()))
    _, readback, sent, _, _ = apply_once(moved, "Company Website")
    options, _, _, read, _ = apply_once(moved, "LinkedIn")

    assert readback == {f"My Information / {SOURCE}": "Company Website"}
    assert sent == ["Company Website"]
    assert read == 0  # the tree read again was saved
    assert options == ("Career Fair", "Professor", "Workday.com", "Company Website", "Indeed", "LinkedIn", "Other")


def test_picks_a_searched_choice_whose_words_are_split_by_tabs():
    # Workday's own tenant lists a user-typed "Stony\tBrook\tUniversity", which reads with spaces (seen live).
    steps = [("My Experience", [Field("school", "School or University", "prompt", True,
                                      ("NY Stony Brook University", "Stony\tBrook\tState\tUniversity", "Stony\tBrook\tUniversity"),
                                      search=True, opens_empty=True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [school] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [school], {school.name: "Stony Brook University"})

    assert readback == {school.name: "Stony Brook University"}


def test_picks_each_skill_from_workdays_catalog_and_leaves_out_one_it_lacks():
    # NVIDIA's skills prompt holds many, each searched; its catalog names a language its own way, and
    # skills picked before are taken off first (seen live).
    steps = [("My Experience", [Field("skills", "Type to Add Skills", "prompt", False,
                                      ("C", "C (Programming Language)", "C++ Programming Language", "Docker",
                                       "Docker (Software)", "Dockerfile", "Python (Programming Language)", "Python Numpy",
                                       "Embedded Rust", "GNU Debugger"),
                                      chosen=("Dockerfile", "Python Numpy"), search=True, many=True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [skills] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            # Workday picks a search's one match itself: "Embedded Rust" is not Rust (Salesforce's "Embedded C++", live).
            # A skill's other names are tried in turn: this catalog has no "GDB" (Workday's own, live).
            readback = filler.fill(page, [skills], {skills.name: ["C++", "Rust", "Python", "GDB|GNU Debugger", "Docker",
                                                                 "Claude Code"]})
            filler.submit(page)

    assert skills.kind == "multi_select"
    assert readback == {skills.name: ["C++", "Python", "GDB|GNU Debugger", "Docker"]}
    assert server.submissions[0].application["skills"] == ["C++ Programming Language", "Python (Programming Language)",
                                                           "GNU Debugger", "Docker"]


def test_a_skill_whose_search_found_nothing_is_searched_again():
    # Workday's own tenant found Linux on one run and nothing for it on the next (seen live).
    steps = [("My Experience", [Field("skills", "Type to Add Skills", "prompt", False, ("Linux", "Python (Programming Language)"),
                                      search=True, many=True, lost=1)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [skills] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [skills], {skills.name: ["Linux", "Python"]})

    assert readback == {skills.name: ["Python", "Linux"]}


def test_reads_the_choices_of_a_dropdown_slow_to_open():
    # NVIDIA's ethnicity list took longer than a prompt's wait to open, and read as having no choices (seen live).
    steps = [("Voluntary Disclosures", [Field("ethnicity", "What is your ethnicity?", "dropdown", True,
                                              ("Asian (Not Hispanic or Latino) (United States of America)", "White"), slow=6)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [ethnicity] = filler.question_set(CACI_URL, site)

    assert ethnicity.options == ("Asian (Not Hispanic or Latino) (United States of America)", "White")


def test_the_skills_list_left_open_is_closed_before_save_and_continue():
    # Workday's skills list stays open after a pick, and a click on Save and Continue only closed it (Salesforce, live).
    steps = [("My Experience", [Field("skills", "Type to Add Skills", "prompt", False, ("Linux", "Python (Programming Language)"),
                                      search=True, many=True)]),
             ("Application Questions", [Field("why", "Why?", "text", False)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [skills] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            with pytest.raises(MoreQuestions):  # the next step's question: Save and Continue went through
                filler.fill(page, [skills], {skills.name: ["Linux", "Python"]})


def test_a_save_and_continue_click_workday_lost_is_made_again():
    # Applied Materials disabled the button a moment as its My Experience loaded, and the click was lost (seen live).
    steps = [("My Information", [Field("legalName--firstName", "First Name", "text", True)]),
             ("Application Questions", [Field("why", "Why?", "text", False)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps, dropped_saves=1) as server, OnePage(server) as site:
        [name] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            with pytest.raises(MoreQuestions):  # the next step's question: Save and Continue went through
                filler.fill(page, [name], {name.name: "Test"})


def test_a_step_workday_refused_as_missing_picks_it_shows_is_filled_once_more():
    # ASML's Application Questions showed each pick, yet Save and Continue found two required answers empty (live).
    steps = [("Application Questions", [Field("education", "What is your highest level of education?", "dropdown", True,
                                              ("High School or GED", "Bachelor’s degree"))]),
             ("Voluntary Disclosures", [Field("why", "Why?", "text", False)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps, lost_picks=1) as server, OnePage(server) as site:
        [education] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            with pytest.raises(MoreQuestions):  # the next step's question: the second Save and Continue went through
                filler.fill(page, [education], {education.name: "Bachelor’s degree"})

    assert server.saved("caci.wd1.myworkdayjobs.com")["education"] == "Bachelor’s degree"


def test_an_error_workday_flashes_before_the_next_step_is_no_handoff():
    # Adobe showed "Upload a file ... is required" mid-save, then went on to the next step (seen live).
    steps = [("My Information", [Field("legalName--firstName", "First Name", "text", True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps, flashes_error=True) as server, OnePage(server) as site:
        [name] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            readback = filler.fill(page, [name], {name.name: "Test"})

    assert readback == {name.name: "Test"}


def test_a_checkbox_confirming_the_statement_above_is_named_by_its_group():
    # Adobe's Terms and Conditions box says only "Check this box to confirm the statement above." (seen live).
    steps = [("Voluntary Disclosures", [Field("acceptTermsAndAgreements", "Check this box to confirm the statement above.",
                                              "checkbox", True, group="Terms and Conditions")])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [terms] = filler.question_set(CACI_URL, site)

    assert terms.label == "Terms and Conditions: Check this box to confirm the statement above."


def test_filling_ends_once_the_review_step_has_shown_its_answers():
    # NVIDIA's Review showed a placeholder a moment after its step name, which the record's screenshot caught (seen live).
    steps = [("My Information", [Field("legalName--firstName", "First Name", "text", True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps, review_delay=2) as server, OnePage(server) as site:
        [name] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            filler.fill(page, [name], {name.name: "Test"})
            shown = page.locator("[data-automation-id=applyFlowReviewPage]").count()

    assert shown


def test_a_step_workday_failed_to_show_is_reloaded():
    # Salesforce's My Information showed "Something went wrong. Please refresh the page" once (seen live).
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, went_wrong=1) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)

    assert questions[0].label == "How Did You Hear About Us?"


class _StuckOn(WorkdayFiller):
    """A Workday Filler whose own code fails on one field, as a click that timed out would."""

    def __init__(self, accounts, rescue, label):
        super().__init__(accounts, rescue)
        self._stuck = label

    def _put(self, page, q, box, value, fresh=False):
        if q.label == self._stuck:
            raise FillError(f"{q.label}: the click timed out")
        super()._put(page, q, box, value, fresh)


class _TimedOutOn(_StuckOn):
    """A Workday Filler whose engine call for one field a plain Worker doesn't answer in time (NVIDIA's, live)."""

    def _put(self, page, q, box, value, fresh=False):
        if q.label == self._stuck:
            raise PortTimeoutError("engine.call: no answer from plain Worker 1 in 60 s")
        WorkdayFiller._put(self, page, q, box, value, fresh)


def _stuck_on_why(rescue_says, filler_class=None):
    steps = [("Application Questions", [Field("why", "Why?", "text", True)]),
             ("Voluntary Disclosures", [Field("next", "Next?", "text", False)])]
    keychain = InMemoryKeychain()
    accounts = Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI")
    claude = FakeClaude(driver=rescue_says)
    filler = (filler_class or _StuckOn)(accounts, Rescue(claude) if rescue_says else None, "Why?")
    with FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps) as server, OnePage(server) as site:
        [why] = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            try:
                filler.fill(page, [why], {why.name: "Because"})
            except MoreQuestions as more:
                return filler, claude, more
    raise AssertionError("the form never went on to its next step")


def test_a_field_the_filler_fails_on_is_filled_by_claude_and_the_form_goes_on():
    def fills_it(page, schema, prompt, files):
        page.locator("[data-automation-id=formField-why] input").fill("Because")
        return {"blocked": False, "why": "", "shown": ["Because"]}

    filler, claude, more = _stuck_on_why(fills_it)

    assert [q.label for q in more.questions] == ["Next?"]  # Save and Continue went through
    [call] = claude.calls
    assert "<field>Why?</field>" in call["prompt"] and '"Because"' in call["prompt"]
    [note] = filler.rescued
    assert note.startswith("Why?: the Filler failed (FillError")


def test_a_field_claude_cannot_fill_either_fails_as_before():
    with pytest.raises(FillError):
        _stuck_on_why(lambda page, schema, prompt, files: {"blocked": True, "why": "no such field", "shown": []})


def test_a_field_whose_engine_call_times_out_is_handed_to_claude_and_the_form_goes_on():
    def fills_it(page, schema, prompt, files):
        page.locator("[data-automation-id=formField-why] input").fill("Because")
        return {"blocked": False, "why": "", "shown": ["Because"]}

    filler, _, more = _stuck_on_why(fills_it, _TimedOutOn)

    assert [q.label for q in more.questions] == ["Next?"]
    [note] = filler.rescued
    assert note.startswith("Why?: the Filler failed (PortTimeoutError")


def test_a_field_whose_engine_call_times_out_unrescued_is_a_fill_error_naming_it():
    # A rehearsal skips a FillError's field and goes on; the timeout itself had ended the whole Application.
    with pytest.raises(FillError, match=r"^Why\?: the Fill engine didn't finish it in time"):
        _stuck_on_why(None, _TimedOutOn)


def test_a_step_that_goes_on_only_by_sending_is_left_for_lisul_to_submit(monkeypatch):
    def engine(page, name, *args):
        raise Handoff("Workday's 'Questions' step goes on only with a button that would send the application, which the engine never clicks")

    monkeypatch.setattr(workday.fill_engine, "call", engine)
    with pytest.raises(Handoff, match=r"would send the application.*Apply didn't click it: check the form and submit it yourself"):
        workday.next_step(None, "Questions")


def test_a_submitted_notice_counts_when_a_hidden_copy_of_its_words_comes_first():
    # Zillow, 2026-11-03: Lisul's own Submit went unseen, so the rehearsal kept it as held.
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content('<div hidden>Application submitted</div><h2>Thanks for applying!</h2>')
        assert workday.confirmed(page)
        page.set_content('<div hidden>Application submitted</div><h2>Review</h2>')
        assert not workday.confirmed(page)
        browser.close()
