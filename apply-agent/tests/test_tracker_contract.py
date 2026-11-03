"""The Tracker contract. Every Tracker passes it: the in-memory fake used by
whole-run tests, the Tracker file in the data folder (KAN-544), the Google Sheet Tracker over a fake spreadsheet (empty, and
with blank rows that hold only an unticked checkbox, as Lisul's Sheet has), and
the Google Sheet Tracker over a real scratch Sheet (skipped without credentials)."""

from datetime import date

import pytest
from trackers import tracker_and_lisul

from apply.model import Outcome, Status
from apply.tracker import AnswerRow, EmployerAccount, Row


@pytest.fixture(params=["memory", "file", "sheet", "checkbox-sheet", "live-sheet"])
def both(request, tmp_path):
    with tracker_and_lisul(request.param, tmp_path) as pair:
        yield pair


@pytest.fixture
def tracker(both):
    return both[0]


@pytest.fixture
def lisul(both):
    """Lisul editing the Tracker by hand."""
    return both[1]


def arc(**fields) -> Row:
    return Row(**{
        "application_id": "arc-1",
        "company": "Arc",
        "role": "Software Engineer Intern",
        "posting_url": "https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008",
        "job_system": "greenhouse",
        "status": Status.SUBMITTED,
        "date_applied": date(2026, 10, 15),
        **fields,
    })


def test_an_added_row_reads_back_by_application_id(tracker):
    tracker.add(arc())
    tracker.add(arc(application_id="glean-1", company="Glean", status=Status.HELD,
                    date_applied=None, reason="Target company"))

    assert tracker.get("arc-1") == arc()
    assert tracker.get("glean-1").reason == "Target company"
    assert tracker.get("glean-1").date_applied is None
    assert [row.application_id for row in tracker.rows()] == ["arc-1", "glean-1"]
    assert tracker.get("nope") is None


def test_an_update_keeps_lisuls_edits(tracker, lisul):
    tracker.add(arc(status=Status.HELD, date_applied=None, essay="Claude's draft"))
    lisul.edit("arc-1", essay="Lisul's essay", approve=True)

    tracker.update("arc-1", status=Status.SUBMITTED, date_applied=date(2026, 10, 16), record="https://example.com/r/1")
    lisul.edit("arc-1", outcome=Outcome.INTERVIEW)

    assert tracker.get("arc-1") == arc(
        status=Status.SUBMITTED, date_applied=date(2026, 10, 16), record="https://example.com/r/1",
        essay="Lisul's essay", approve=True, outcome=Outcome.INTERVIEW,
    )


def test_a_missing_fact_takes_lisuls_answer(tracker, lisul):
    tracker.add(arc(status=Status.FILLING, date_applied=None))
    tracker.update("arc-1", status=Status.MISSING_FACT, missing_fact="What is your expected GPA?")
    lisul.edit("arc-1", answer="3.9")

    row = tracker.get("arc-1")
    assert (row.status, row.missing_fact, row.answer) == (Status.MISSING_FACT, "What is your expected GPA?", "3.9")
    assert (row.approve, row.outcome) == (False, None)


def test_lisuls_answer_typed_in_the_apply_window_lands_in_his_answer_cell_alone(tracker):
    tracker.add(arc(status=Status.MISSING_FACT, date_applied=None, missing_fact="What is your expected GPA?"))
    tracker.answer("arc-1", "3.9")

    row = tracker.get("arc-1")
    assert (row.status, row.answer, row.approve) == (Status.MISSING_FACT, "3.9", False)
    with pytest.raises(KeyError):
        tracker.answer("nope", "3.9")


def _approves(tracker):
    if not hasattr(tracker, "approve"):
        pytest.skip("the retired Tracker Sheet takes no approval (ADR 0007)")


def test_lisul_approves_a_hold_in_the_apply_window(tracker):
    _approves(tracker)
    tracker.add(arc(status=Status.HELD, date_applied=None, essay="Claude's draft"))
    tracker.approve("arc-1")

    row = tracker.get("arc-1")
    assert (row.status, row.approve, row.essay) == (Status.HELD, True, "Claude's draft")
    with pytest.raises(KeyError):
        tracker.approve("nope")


def test_lisul_edits_a_held_essay_and_approves_it_in_the_apply_window(tracker):
    _approves(tracker)
    tracker.add(arc(status=Status.HELD, date_applied=None, essay="## Why Arc?\nClaude's draft"))
    tracker.approve("arc-1", essay="## Why Arc?\nLisul's own words")

    row = tracker.get("arc-1")
    assert (row.status, row.approve, row.essay) == (Status.HELD, True, "## Why Arc?\nLisul's own words")


@pytest.mark.parametrize("field, value", [
    ("approve", True), ("outcome", Outcome.OFFER), ("answer", "3.9"),
])
def test_lisuls_columns_are_never_written(tracker, field, value):
    with pytest.raises(ValueError, match=field):
        tracker.add(arc(**{field: value}))
    tracker.add(arc())
    with pytest.raises(ValueError, match=field):
        tracker.update("arc-1", **{field: value})
    assert tracker.rows() == [arc()]


def test_the_essay_on_a_held_row_is_lisuls(tracker):
    tracker.add(arc(status=Status.FILLING, date_applied=None))
    tracker.update("arc-1", status=Status.HELD, essay="Claude's draft")

    with pytest.raises(ValueError, match="essay"):
        tracker.update("arc-1", essay="Another draft")
    assert tracker.get("arc-1").essay == "Claude's draft"


def test_apply_suggests_an_outcome_beside_lisuls_and_notes_a_confirmation(tracker, lisul):
    tracker.add(arc())
    lisul.edit("arc-1", outcome=Outcome.REJECTED)

    tracker.update("arc-1", suggested_outcome=Outcome.INTERVIEW, confirmation_received=date(2026, 10, 16))

    row = tracker.get("arc-1")
    assert (row.outcome, row.suggested_outcome, row.confirmation_received) == (
        Outcome.REJECTED, Outcome.INTERVIEW, date(2026, 10, 16),
    )


def test_an_unknown_application_cant_be_updated(tracker):
    with pytest.raises(KeyError):
        tracker.update("nope", status=Status.FAILED)


def test_an_application_gets_one_row(tracker):
    tracker.add(arc())
    with pytest.raises(ValueError, match="arc-1"):
        tracker.add(arc(status=Status.FAILED))

    assert tracker.rows() == [arc()]


def test_a_request_waits_in_the_requests_tab_until_removed(tracker, lisul):
    lisul.paste_request("https://jobs.ashbyhq.com/acme/1")
    lisul.paste_request(" https://jobs.lever.co/acme/2 ")

    assert tracker.requests() == ["https://jobs.ashbyhq.com/acme/1", "https://jobs.lever.co/acme/2"]
    tracker.remove_request("https://jobs.ashbyhq.com/acme/1")
    tracker.remove_request("https://jobs.ashbyhq.com/acme/1")
    assert tracker.requests() == ["https://jobs.lever.co/acme/2"]


def test_requests_apply_adds_wait_in_the_requests_tab_with_lisuls(tracker, lisul):
    lisul.paste_request("https://jobs.ashbyhq.com/acme/1")
    tracker.add_request(" https://jobs.lever.co/acme/2 ")
    tracker.add_request("https://www.linkedin.com/jobs/view/4467485195")

    assert tracker.requests() == [
        "https://jobs.ashbyhq.com/acme/1", "https://jobs.lever.co/acme/2", "https://www.linkedin.com/jobs/view/4467485195",
    ]


def test_new_employer_accounts_are_listed(tracker):
    nvidia = EmployerAccount("NVIDIA", "https://nvidia.wd5.myworkdayjobs.com", "lisul@example.com", date(2026, 10, 15))
    ibm = EmployerAccount("IBM", "https://careers.ibm.com", "lisul@example.com", date(2026, 10, 16))
    tracker.add_employer_account(nvidia)
    tracker.add_employer_account(ibm)

    assert tracker.employer_accounts() == [nvidia, ibm]


HOUSING = AnswerRow("Do you have housing within 30 miles of our office?", "Yes", drafted="Yes", options=("Yes", "No"),
                    company="MetOx", first_seen=date(2026, 10, 16))
SKILLS = AnswerRow("Skill Areas (Select all that apply)", "Software; Robotics", drafted="Software; Robotics",
                   options=("Finance", "Software", "Robotics"), company="Gas South", first_seen=date(2026, 10, 16))


def test_answers_claude_drafted_are_listed_in_the_answers_tab(tracker):
    tracker.add_answer(HOUSING)
    tracker.add_answer(SKILLS)

    assert tracker.answers() == [HOUSING, SKILLS]


def test_lisul_edits_an_answer_and_ticks_it_reviewed_in_the_answers_tab(tracker, lisul):
    tracker.add_answer(HOUSING)
    tracker.add_answer(SKILLS)

    lisul.edit_answer(HOUSING.question, answer="No", reviewed=True)

    assert tracker.answers() == [
        AnswerRow(HOUSING.question, "No", True, "Yes", ("Yes", "No"), "MetOx", date(2026, 10, 16)), SKILLS,
    ]


def test_the_tracker_file_keeps_every_row_between_runs(tmp_path):
    from apply.tracker import FileTracker

    first = FileTracker(tmp_path / "tracker.json")
    first.add(arc(suggested_outcome=Outcome.OA, confirmation_received=date(2026, 10, 17)))
    first.add_request("https://jobs.lever.co/acme/2")
    first.add_answer(SKILLS)
    first.add_employer_account(EmployerAccount("IBM", "https://careers.ibm.com", "lisul@example.com", date(2026, 10, 16)))

    again = FileTracker(tmp_path / "tracker.json")
    assert again.rows() == [arc(suggested_outcome=Outcome.OA, confirmation_received=date(2026, 10, 17))]
    assert (again.requests(), again.answers()) == (["https://jobs.lever.co/acme/2"], [SKILLS])
    assert again.employer_accounts()[0].site == "https://careers.ibm.com"
