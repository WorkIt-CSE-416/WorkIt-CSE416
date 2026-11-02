"""The Applications tab cleanup: it changes only how the tab looks, never what
Apply reads from it."""

import threading

from trackers import FakeSpreadsheet

from apply.model import Status
from apply.sheet import APPLICATIONS, TABS, SheetTracker, locked, tidy_applications
from apply.tracker import Row


def filled_sheet(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS, blank_rows=3)
    tracker = SheetTracker(spreadsheet, lock=tmp_path / "tracker.lock")
    for application_id, status in [("a", Status.SUBMITTED), ("b", Status.HELD), ("c", Status.FAILED)]:
        tracker.add(Row(application_id, "Acme", "Intern", f"https://example.com/{application_id}",
                        "greenhouse", Status.FILLING))
        tracker.update(application_id, status=status)
    return spreadsheet


def test_tidying_the_applications_tab_changes_no_header_or_value(tmp_path):
    spreadsheet = filled_sheet(tmp_path)
    before = spreadsheet.worksheet(APPLICATIONS).get_all_values()

    tidy_applications(spreadsheet, lock=tmp_path / "tracker.lock")
    tidy_applications(spreadsheet, lock=tmp_path / "tracker.lock")

    assert spreadsheet.worksheet(APPLICATIONS).get_all_values() == before
    assert before[0] == TABS[APPLICATIONS]


def test_tidying_again_does_not_stack_status_colors(tmp_path):
    spreadsheet = filled_sheet(tmp_path)
    lisuls = {"ranges": [{"sheetId": 0, "startColumnIndex": 1, "endColumnIndex": 2}],
              "booleanRule": {"condition": {"type": "TEXT_CONTAINS", "values": [{"userEnteredValue": "Acme"}]}}}
    spreadsheet.batch_update({"requests": [{"addConditionalFormatRule": {"index": 0, "rule": lisuls}}]})

    tidy_applications(spreadsheet, lock=tmp_path / "tracker.lock")
    once = spreadsheet.fetch_sheet_metadata()["sheets"][0]["conditionalFormats"]
    tidy_applications(spreadsheet, lock=tmp_path / "tracker.lock")
    twice = spreadsheet.fetch_sheet_metadata()["sheets"][0]["conditionalFormats"]

    assert len(once) == 5  # submitted, held, missing fact and failed, plus Lisul's own rule
    assert twice == once


def test_tidying_waits_for_the_trackers_write_lock(tmp_path):
    spreadsheet, lock = filled_sheet(tmp_path), tmp_path / "tracker.lock"
    tidy = threading.Thread(target=tidy_applications, args=(spreadsheet,), kwargs={"lock": lock})

    with locked(lock):
        tidy.start()
        tidy.join(timeout=0.3)
        assert tidy.is_alive()  # another writer holds the lock
        assert spreadsheet.requests == []
    tidy.join(timeout=5)

    assert not tidy.is_alive()
    assert spreadsheet.requests
