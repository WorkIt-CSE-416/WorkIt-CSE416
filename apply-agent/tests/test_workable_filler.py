"""Seam 2: the Workable Filler against saved Workable forms."""

import json

import pytest
from conftest import ENFOS_FORM, ENFOS_URL, PERRY_FORM, PERRY_URL, SCOUT_FORM, SCOUT_URL
from fake_workable import FakeWorkableServer

from apply import workable
from apply.fillers import FILLERS
from apply.model import FillError, Posting, Question
from apply.request import resolve
from apply.workable import WorkableFiller


@pytest.fixture
def perry():
    with FakeWorkableServer(PERRY_FORM) as server:
        yield server


def test_reads_the_question_set_from_the_form_api(perry):
    questions = WorkableFiller().question_set(PERRY_URL, perry)

    assert Question("firstname", "First name", "text", True) in questions
    assert Question("phone", "Phone", "text", True) in questions
    assert Question("CA_37268", "What is your desired salary? (number)", "text", True) in questions
    assert Question("resume", "Resume", "file", True) in questions
    assert Question("cover_letter", "Cover letter", "textarea", False) in questions
    # Yes/No questions, choices of one, and checkboxes
    assert Question("CA_51108", "Are you at least 18 years of age?", "select", True, ("Yes", "No")) in questions
    assert Question("CA_47160", "Were you referred by a Perry Homes employee?", "select", True, ("Yes", "No")) in questions
    assert Question("CA_40605", "Are you a current Perry Homes employee?", "multi_select", True, ("No", "Yes")) in questions
    assert Question("QA_12404607", "What is your highest level of education completed?", "select", True, (
        "High School Diploma or GED", "Bachelor's Degree", "Associates", "Masters", "Some college",
        "Did not complete highschool")) in questions


def test_asks_each_repeating_section_as_the_planner_reads_one(perry):
    questions = WorkableFiller().question_set(PERRY_URL, perry)

    assert Question("experience", "Work Experience (entries)", "text", False) in questions
    assert Question("experience.1.title", "Work Experience 1 / Title", "text") in questions
    assert Question("experience.3.start_date", "Work Experience 3 / Start date, up to this month (MM/YYYY)", "text") in questions
    assert Question("experience.2.current", "Work Experience 2 / I currently work here", "select", False, ("Yes", "No")) in questions
    assert Question("education", "Education (entries)", "text", False) in questions
    assert Question("education.1.school", "Education 1 / School", "text") in questions
    assert Question("education.1.end_date", "Education 1 / End date, up to this month (MM/YYYY)", "text") in questions


def test_fills_and_reads_back_a_saved_form_and_stops_before_submit(perry, one_pager):
    filler = WorkableFiller()
    questions = filler.question_set(PERRY_URL, perry)
    answers = {
        "firstname": "Test",
        "lastname": "Person",
        "email": "test.person@example.com",
        "phone": "+15550100199",  # shown as 555-010-0199 beside the country it picked, +1
        "CA_36806": "Columbus",  # City
        "CA_40605": ["No"],  # a current Perry Homes employee? (checkboxes)
        "CA_51108": "Yes",  # at least 18? (Yes/No radios)
        "CA_47160": "No",  # referred by an employee? (radios)
        "CA_37268": "25",  # desired salary (a number)
        "QA_12404607": "Bachelor's Degree",  # highest education (a dropdown)
        "cover_letter": "I would like to intern at Perry Homes.\nThank you.",
        "resume": one_pager,
    }

    with perry.open(PERRY_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == {**answers, "resume": "one-pager.pdf"}
    assert perry.uploads == ["resume"]
    assert perry.submissions == []


def test_clears_the_unsent_draft_workable_restores_before_filling():
    stale = {"lastname": "Stale", "CA_36808": "Stale County", "experience": [{"id": "section-3", "title": "Stale Title"}]}
    with FakeWorkableServer(PERRY_FORM, draft={"D309E69A5B": stale}) as perry:
        filler = WorkableFiller()
        questions = filler.question_set(PERRY_URL, perry)
        with perry.open(PERRY_URL) as page:
            assert page.locator("#lastname").input_value() == "Stale"  # restored as the form opened
            readback = filler.fill(page, questions, {"firstname": "Test"})
            left = [page.locator("#lastname").input_value(), page.locator("#CA_36808").input_value(),
                    page.locator("[data-ui=experience] li").count()]

    assert readback == {"firstname": "Test"}
    assert left == ["", "", 0]


def test_blanks_what_workable_prefilled_and_nothing_answers():
    with FakeWorkableServer(SCOUT_FORM) as scout:
        filler = WorkableFiller()
        questions = filler.question_set(SCOUT_URL, scout)
        with scout.open(SCOUT_URL) as page:
            assert page.locator("#address").input_value() != ""  # guessed from where the browser is
            readback = filler.fill(page, questions, {"firstname": "Test"})
            address = page.locator("#address").input_value()

    assert readback == {"firstname": "Test"}
    assert address == ""


def test_asks_the_address_with_the_parts_workable_says_it_must_include():
    with FakeWorkableServer(SCOUT_FORM) as scout:
        filler = WorkableFiller()
        questions = filler.question_set(SCOUT_URL, scout)
        address = "1 Main St, Springfield, IL 62701, United States"
        with scout.open(SCOUT_URL) as page:
            readback = filler.fill(page, questions, {"address": address})

    assert Question("address", "Address (Include your city, region, and country)", "text", False) in questions
    assert readback == {"address": address}


def test_adds_and_fills_entries_of_each_repeating_section(perry):
    filler = WorkableFiller()
    questions = filler.question_set(PERRY_URL, perry)
    answers = {
        "experience": "2",
        "experience.1.title": "Software Engineer Intern",
        "experience.1.company": "Hitachi Rail",
        "experience.1.start_date": "06/2026",
        "experience.1.end_date": "08/2026",
        "experience.1.current": "No",
        "experience.2.title": "Research Assistant",
        "experience.2.start_date": "09/2026",
        "experience.2.current": "Yes",
        "education": "1",
        "education.1.school": "Suffolk County Community College",
        "education.1.field_of_study": "Computer Science",
        "education.1.degree": "Associate's Degree",
        "education.1.start_date": "09/2022",
        "education.1.end_date": "05/2024",
        "firstname": "Test",
    }

    with perry.open(PERRY_URL) as page:
        readback = filler.fill(page, questions, answers)
        shown = page.locator("[data-ui=experience] li").all_inner_texts()

    assert readback == answers
    # the page lists the entries in the order they are planned
    assert len(shown) == 2 and "Hitachi Rail" in shown[0] and "Research Assistant" in shown[1]


def test_lists_entries_most_recent_first_as_they_are_planned(perry):
    # RAVE: Workable puts each added entry on top, so the page read oldest first.
    filler = WorkableFiller()
    questions = filler.question_set(PERRY_URL, perry)
    jobs = [("Hitachi Rail", "06/2026", "08/2026"), ("Clever Devices", "06/2025", "08/2025"),
            ("Cloud Data Pro", "06/2024", "08/2024")]
    answers = {"experience": "3"}
    for n, (company, start, end) in enumerate(jobs, 1):
        answers |= {f"experience.{n}.title": "Software Engineer Intern", f"experience.{n}.company": company,
                    f"experience.{n}.start_date": start, f"experience.{n}.end_date": end}

    with perry.open(PERRY_URL) as page:
        readback = filler.fill(page, questions, answers)
        shown = page.locator("[data-ui=experience] li").all_inner_texts()

    assert readback == answers
    assert [company for entry in shown for company, _, _ in jobs if company in entry] == [
        "Hitachi Rail", "Clever Devices", "Cloud Data Pro"]


def test_says_which_date_workable_wont_take_before_filling(perry):
    """Workable's date picker takes no month after the current one, so an
    expected graduation can't be an Education entry's end date."""
    filler = WorkableFiller()
    questions = filler.question_set(PERRY_URL, perry)
    answers = {"education": "1", "education.1.school": "Stony Brook University", "education.1.end_date": "05/2099"}

    with perry.open(PERRY_URL) as page:
        with pytest.raises(FillError, match=r"^education\.1\.end_date: "):
            filler.fill(page, questions, answers)
        added = page.locator("[data-ui=education] li").count()

    assert added == 0


def test_submits_a_filled_form(perry, one_pager):
    filler = WorkableFiller()
    questions = filler.question_set(PERRY_URL, perry)
    answers = {
        "firstname": "Test", "lastname": "Person", "email": "test.person@example.com", "phone": "+12125551234",
        "CA_36804": "1 Main St", "CA_36806": "Columbus", "CA_36807": "OH", "CA_37968": "43004",
        "CA_40605": ["No"], "CA_51108": "Yes", "resume": one_pager, "CA_47160": "No", "CA_37268": "25",
        "QA_12404603": "No", "QA_12404604": "No", "QA_12404605": "Yes", "QA_12404606": "No",
        "QA_12404607": "Bachelor's Degree",
    }

    with perry.open(PERRY_URL) as page:
        filler.fill(page, questions, answers)
        filler.submit(page)

    [sent] = perry.submissions
    assert sent.url == "https://apply.workable.com/api/v1/jobs/D309E69A5B/apply"
    assert "Test" in json.dumps(sent.application)


def test_a_workable_posting_is_filled_by_the_workable_filler():
    posting = Posting("perry", "Perry Homes", "2027 Summer Internship - Options Analyst", PERRY_URL)

    assert posting.job_system == "workable"
    assert isinstance(FILLERS[posting.job_system], WorkableFiller)


def test_a_request_for_a_workable_posting_is_named_as_workable_names_it(perry):
    posting, stop = resolve(PERRY_URL, perry)
    _, board = resolve("https://apply.workable.com/perryhomes/", perry)

    assert stop is None
    assert (posting.company, posting.title) == ("Perry Homes", "2027 Summer Internship - Options Analyst")
    assert board.status == "failed" and "not a link to a job posting" in board.reason.lower()


def test_waits_for_a_slow_upload_to_be_stored_before_reading_it_back(one_pager):
    # Scout, ENFOS: the form was read back, and its screenshot taken, while the résumé still uploaded.
    with FakeWorkableServer(PERRY_FORM, storage_delay=3_000) as slow:
        filler = WorkableFiller()
        questions = filler.question_set(PERRY_URL, slow)

        with slow.open(PERRY_URL) as page:
            readback = filler.fill(page, questions, {"resume": one_pager})
            stored = slow.stored

    assert stored == 1
    assert readback == {"resume": "one-pager.pdf"}


def test_an_upload_workable_never_finishes_is_named_as_unfilled(monkeypatch, one_pager):
    monkeypatch.setattr(workable, "SHOWN_WAIT", 500)
    with FakeWorkableServer(PERRY_FORM, storage_delay=5_000) as slow:
        filler = WorkableFiller()
        questions = filler.question_set(PERRY_URL, slow)

        with slow.open(PERRY_URL) as page, pytest.raises(FillError, match="^resume: .*one-pager.pdf"):
            filler.fill(page, questions, {"resume": one_pager})


def test_reads_back_a_long_file_name_whole(perry, one_pager, tmp_path):
    """Workable shows a long name in two parts, so its end stays in view."""
    resume = tmp_path / "Test_Person_Resume.pdf"
    resume.write_bytes(one_pager.read_bytes())
    filler = WorkableFiller()
    questions = filler.question_set(PERRY_URL, perry)

    with perry.open(PERRY_URL) as page:
        readback = filler.fill(page, questions, {"resume": resume})

    assert readback == {"resume": "Test_Person_Resume.pdf"}


def test_reads_back_a_number_as_it_was_typed_though_workable_shows_it_grouped(perry):
    filler = WorkableFiller()
    questions = filler.question_set(PERRY_URL, perry)

    with perry.open(PERRY_URL) as page:
        readback = filler.fill(page, questions, {"CA_37268": "62400"})
        shown = page.locator("input[data-ui=CA_37268]").input_value()

    assert shown == "62,400"
    assert readback == {"CA_37268": "62400"}


def test_an_answer_after_a_field_workable_rejects_still_lands(perry):
    """Leaving a number field that holds words shows an error under it, which
    moves the next question down as it is clicked."""
    filler = WorkableFiller()
    questions = filler.question_set(PERRY_URL, perry)
    answers = {"CA_37268": "Open to the posted range", "QA_12404603": "No"}

    with perry.open(PERRY_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == {"CA_37268": "", "QA_12404603": "No"}


def test_fills_a_date_question_from_a_date_of_the_profile():
    with FakeWorkableServer(ENFOS_FORM) as enfos:
        filler = WorkableFiller()
        questions = filler.question_set(ENFOS_URL, enfos)
        with enfos.open(ENFOS_URL) as page:
            readback = filler.fill(page, questions, {"QA_12403883": "2027-05-26"})
            shown = page.locator('input[name="QA_12403883"]').input_value()

    assert Question("QA_12403883", "What is your earliest available start date? (YYYY-MM-DD)", "text", True) in questions
    assert readback == {"QA_12403883": "2027-05-26"}
    assert shown == "05/26/2027"  # as Workable's date box writes it
