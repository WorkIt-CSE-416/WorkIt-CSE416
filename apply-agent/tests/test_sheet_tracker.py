"""What only the Google Sheet Tracker must survive: several processes writing
at once, and Lisul sorting and filtering the Sheet while they write."""

import multiprocessing
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest
from trackers import FakeSpreadsheet, tracker_and_lisul

from apply.model import Outcome, Status
from apply.sheet import ANSWERS, APPLICATIONS, TABS, SheetTracker
from apply.tracker import AnswerRow, Row


def row(application_id: str) -> Row:
    return Row(application_id, "Acme", "Intern", f"https://example.com/{application_id}", "greenhouse", Status.FILLING)


def write_rows(folder: Path, lock: Path, writer: int, count: int) -> None:
    tracker = SheetTracker(FakeSpreadsheet(folder, TABS), lock=lock)
    for i in range(count):
        tracker.add(row(f"{writer}-{i}"))
        tracker.update(f"{writer}-{i}", status=Status.SUBMITTED)


def test_concurrent_writers_lose_no_rows(tmp_path):
    folder, lock = tmp_path / "sheet", tmp_path / "tracker.lock"
    FakeSpreadsheet(folder, TABS)
    spawn = multiprocessing.get_context("spawn")
    writers = [spawn.Process(target=write_rows, args=(folder, lock, writer, 15)) for writer in range(4)]
    for writer in writers:
        writer.start()
    for writer in writers:
        writer.join()

    rows = SheetTracker(FakeSpreadsheet(folder, TABS), lock=lock).rows()
    assert sorted(r.application_id for r in rows) == sorted(f"{w}-{i}" for w in range(4) for i in range(15))
    assert {r.status for r in rows} == {Status.SUBMITTED}


@pytest.mark.parametrize("kind", ["sheet", "live-sheet"])
def test_sorting_the_sheet_between_writes_misplaces_nothing(kind, tmp_path):
    with tracker_and_lisul(kind, tmp_path) as (tracker, lisul):
        for application_id, company in [("a", "Arc"), ("b", "Bolt"), ("c", "Cohere")]:
            tracker.add(Row(application_id, company, "Intern", f"https://example.com/{application_id}",
                            "greenhouse", Status.HELD))

        lisul.sort_by("Company", descending=True)
        lisul.edit("a", approve=True)
        tracker.update("a", status=Status.SUBMITTED)
        lisul.sort_by("Status")
        tracker.update("c", status=Status.HANDOFF, reason="captcha")

        rows = {row.application_id: row for row in tracker.rows()}
        assert (rows["a"].company, rows["a"].status, rows["a"].approve) == ("Arc", Status.SUBMITTED, True)
        assert (rows["b"].company, rows["b"].status, rows["b"].approve) == ("Bolt", Status.HELD, False)
        assert (rows["c"].company, rows["c"].status, rows["c"].reason) == ("Cohere", Status.HANDOFF, "captcha")
        assert [row.application_id for row in tracker.rows()] != ["a", "b", "c"]  # the sort really moved rows


def test_a_sheet_set_up_before_a_column_existed_gets_it_on_first_write(tmp_path):
    before = [h for h in TABS[APPLICATIONS] if h not in ("Confirmation received", "Suggested outcome")]
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", {**TABS, APPLICATIONS: before})
    tracker = SheetTracker(spreadsheet, lock=tmp_path / "tracker.lock")
    tracker.add(row("a"))
    tracker.add(row("b"))

    tracker.update("a", suggested_outcome=Outcome.OA)
    tracker.update("b", confirmation_received=date(2026, 10, 16), status=Status.SUBMITTED)

    assert spreadsheet.worksheet(APPLICATIONS).row_values(1) == before + ["Suggested outcome", "Confirmation received"]
    a, b = tracker.rows()
    assert (a.suggested_outcome, a.confirmation_received, a.status) == (Outcome.OA, None, Status.FILLING)
    assert (b.suggested_outcome, b.confirmation_received, b.status) == (None, date(2026, 10, 16), Status.SUBMITTED)


def test_a_sheet_laid_out_before_the_bot_signals_column_gets_it_on_first_update(tmp_path):
    older = {**TABS, APPLICATIONS: [h for h in TABS[APPLICATIONS] if h != "Bot signals"]}
    tracker = SheetTracker(FakeSpreadsheet(tmp_path / "sheet", older), lock=tmp_path / "tracker.lock")

    tracker.add(replace(row("a"), bot_signals="headless"))  # no column yet: the rest of the row still goes in
    tracker.update("a", status=Status.HANDOFF, reason="captcha", bot_signals="headless: captcha")

    [written] = tracker.rows()
    assert (written.status, written.reason, written.bot_signals) == (Status.HANDOFF, "captcha", "headless: captcha")


def test_the_bot_signals_column_reads_back(tmp_path):
    tracker = SheetTracker(FakeSpreadsheet(tmp_path / "sheet", TABS), lock=tmp_path / "tracker.lock")

    tracker.add(row("a"))
    tracker.update("a", status=Status.HANDOFF, bot_signals="headed: captcha")

    assert tracker.get("a").bot_signals == "headed: captcha"


def checkbox_sheet(tmp_path, *rows: dict[str, str]):
    """A Sheet like Lisul's: `rows` (cells by header), then blank rows holding
    only an unticked checkbox."""
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS, blank_rows=3)
    applications = spreadsheet.worksheet(APPLICATIONS)
    headers, *blanks = applications.load()
    applications.save([headers, *[[cells.get(h, "") for h in headers] for cells in rows], *blanks])
    return spreadsheet, SheetTracker(spreadsheet, lock=tmp_path / "tracker.lock")


A = {"Application ID": "a", "Company": "Acme", "Role": "Intern", "Posting": "https://example.com/a",
     "Job system": "greenhouse", "Status": "held", "Approve": "FALSE"}
BLANK = {"Approve": "FALSE"}


def test_blank_rows_holding_only_an_unticked_checkbox_are_not_rows(tmp_path):
    _, tracker = checkbox_sheet(tmp_path)

    assert tracker.rows() == []
    assert tracker.get("a") is None
    assert tracker.answers() == []


def test_an_update_after_blank_rows_lands_on_its_own_row(tmp_path):
    spreadsheet, tracker = checkbox_sheet(tmp_path, BLANK, BLANK, A)

    tracker.update("a", status=Status.SUBMITTED)

    headers, *cells = spreadsheet.worksheet(APPLICATIONS).get_all_values()
    assert [values[headers.index("Status")] for values in cells[:4]] == ["", "", "submitted", ""]
    assert [row.application_id for row in tracker.rows()] == ["a"]
    assert tracker.get("a").status == Status.SUBMITTED


def test_an_added_row_lands_in_the_first_blank_row_and_keeps_its_checkbox(tmp_path):
    spreadsheet, tracker = checkbox_sheet(tmp_path, A, BLANK, {"Approve": "TRUE"})

    tracker.add(row("b"))
    tracker.add(row("c"))

    headers, *cells = spreadsheet.worksheet(APPLICATIONS).get_all_values()
    assert len(cells) == 6  # nothing appended below the blank rows
    assert [(values[headers.index("Application ID")], values[headers.index("Approve")]) for values in cells] == [
        ("a", "FALSE"), ("b", "FALSE"), ("c", "TRUE"), ("", "FALSE"), ("", "FALSE"), ("", "FALSE"),
    ]
    assert [(r.application_id, r.company, r.approve) for r in tracker.rows()] == [
        ("a", "Acme", False), ("b", "Acme", False), ("c", "Acme", True),
    ]
    with pytest.raises(ValueError, match="b already has a row"):
        tracker.add(row("b"))


def test_an_added_row_is_appended_when_no_row_is_blank(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    tracker = SheetTracker(spreadsheet, lock=tmp_path / "tracker.lock")

    tracker.add(row("a"))
    tracker.add(row("b"))

    assert tracker.rows() == [row("a"), row("b")]


def test_an_added_answer_lands_in_the_first_blank_row(tmp_path):
    spreadsheet, tracker = checkbox_sheet(tmp_path)
    housing = AnswerRow("Housing within 30 miles?", "Yes", drafted="Yes", options=("Yes", "No"))
    skills = AnswerRow("Skill Areas", "Software", reviewed=True, drafted="Software")

    tracker.add_answer(housing)
    tracker.add_answer(skills)

    headers, *cells = spreadsheet.worksheet(ANSWERS).get_all_values()
    assert [(values[headers.index("Question")], values[headers.index("Reviewed")]) for values in cells] == [
        ("Housing within 30 miles?", "FALSE"), ("Skill Areas", "TRUE"), ("", "FALSE"),
    ]
    assert tracker.answers() == [housing, skills]


def test_the_sheets_rows_and_requests_are_copied_once_into_the_tracker_file(tmp_path):
    # KAN-544: Apply stops writing the Sheet. Its rows go into the Tracker file one time, so a run still
    # knows every job applied to (no second application) and every Hold, read leniently: a real Sheet has
    # Outcomes typed by hand and older layouts.
    from apply.sheet import REQUESTS, copy_into
    from apply.tracker import FileTracker

    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    headers = TABS[APPLICATIONS]
    cell = lambda **values: [values.get(h, "") for h in headers]
    spreadsheet.worksheet(APPLICATIONS).update([
        headers,
        cell(**{"Application ID": "arc-1", "Company": "Arc ", "Role": "Intern", "Posting": "https://a/1",
                "Job system": "greenhouse", "Status": "submitted", "Date applied": "2026-10-15",
                "Outcome": "Got an OA"}),
        cell(**{"Application ID": "glean-1", "Company": "Glean", "Role": "Intern", "Posting": "https://g/1",
                "Status": "held", "Approve": "TRUE", "Essay": "Lisul's essay", "Outcome": "interview"}),
        cell(**{"Application ID": "odd-1", "Company": "Odd", "Status": "not a status"}),
        cell(),
    ])
    spreadsheet.worksheet(REQUESTS).update([["Link"], ["https://jobs.lever.co/acme/2"]])
    tracker = FileTracker(tmp_path / "tracker.json")

    assert copy_into(spreadsheet, tracker) == 2

    arc, glean = FileTracker(tmp_path / "tracker.json").rows()
    assert (arc.application_id, arc.company, arc.status, arc.date_applied, arc.outcome) == (
        "arc-1", "Arc", Status.SUBMITTED, date(2026, 10, 15), None)
    assert (glean.status, glean.approve, glean.essay, glean.outcome) == (
        Status.HELD, True, "Lisul's essay", Outcome.INTERVIEW)
    assert tracker.requests() == ["https://jobs.lever.co/acme/2"]
