"""Seam 1 for Records: whole `apply run`s, read off the Tracker rows and the
Records they link to."""

import json
from datetime import datetime

import pytest
from conftest import ARC_FORM, FIXTURES
from fakes import FakeClaude, FakeClock, FakeJobServer, FakeMailbox, ScriptedUsage
from test_matches import NoBrowser, feed_record

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS
from apply.model import Question
from apply.records import InMemoryRecords
from apply.tracker import InMemoryTracker

PNG = b"\x89PNG\r\n\x1a\n"


def run(job_server, records: InMemoryRecords, feed: bytes | None = None) -> InMemoryTracker:
    tracker = InMemoryTracker()
    main(
        ["run", "--profile", str(FIXTURES / "profile.yaml")],
        adapters=Adapters(
            feed=SimplifyFeed(lambda: feed or (FIXTURES / "feed.json").read_bytes()),
            tracker=tracker,
            site=job_server,
            claude=FakeClaude(),
            mailbox=FakeMailbox(),
            usage=ScriptedUsage(),
            clock=FakeClock(datetime(2026, 10, 15, 9, 30)),
            records=records,
        ),
    )
    return tracker


def answers(records: InMemoryRecords, link: str) -> dict[str, dict]:
    """The Record's answers by the form's field id."""
    return {a["field"]: a for a in json.loads(records.files(link)["answers.json"])}


@pytest.mark.usefixtures("blank_optionals_noted")
def test_a_submitted_application_links_its_record(job_server):
    records = InMemoryRecords()
    tracker = run(job_server, records)

    [row] = tracker.rows()
    assert row.status == "submitted"
    record = records.files(row.record)
    assert record["form.png"].startswith(PNG)
    assert record["after-submit.png"].startswith(PNG)  # the page the submit led to
    assert "(after-submit.png)" in record["README.md"].decode()
    email = answers(records, row.record)["email"]
    assert (email["planned"], email["on_page"]) == ("test.person@example.com", "test.person@example.com")
    assert answers(records, row.record)["resume"]["on_page"] == "one-pager.pdf"
    verification = json.loads(record["verification.json"])
    assert verification["state"] == "verified"
    assert f"- Verification: {verification['label']}" in record["README.md"].decode()


@pytest.mark.usefixtures("blank_optionals_noted")
def test_a_held_application_links_its_record_with_what_the_page_shows():
    records = InMemoryRecords()
    with FakeJobServer(ARC_FORM, garble="email") as job_server:
        tracker = run(job_server, records)

    [row] = tracker.rows()
    assert row.status == "held"
    email = answers(records, row.record)["email"]
    assert (email["planned"], email["on_page"]) == ("test.person@example.com", "test.person@example.co")
    assert records.files(row.record)["form.png"].startswith(PNG)
    verification = json.loads(records.files(row.record)["verification.json"])
    assert verification["state"] == "flagged"
    assert [(f["field"], f["kind"]) for f in verification["flags"] if f["holds"]] == [("Email", "readback")]
    assert "## Verification" in records.files(row.record)["README.md"].decode()


class SignUpFormFiller:
    """A form that also creates an Employer account, so it asks for a password."""

    PASSWORD = "Tr0ub4dor&3-never-recorded"

    def question_set(self, url, site):
        return [
            Question("email", "Email", "text"),
            Question("resume", "Resume", "file"),
            Question("password", "Create a password", "text"),
            Question("password_confirm", "Confirm Password", "text"),
        ]

    def fill(self, page, questions, answers):
        typed = {name: getattr(value, "name", value) for name, value in answers.items()}
        return typed | {"password": self.PASSWORD, "password_confirm": self.PASSWORD}

    def submit(self, page):
        pass


def test_nothing_secret_is_written_to_a_record(monkeypatch):
    monkeypatch.setitem(FILLERS, "other", SignUpFormFiller())
    records = InMemoryRecords()
    tracker = run(NoBrowser(), records, feed=json.dumps([feed_record()]).encode())

    [row] = tracker.rows()
    assert row.status == "submitted", row.reason
    written = b"".join(records.files(row.record).values())
    assert SignUpFormFiller.PASSWORD.encode() not in written
    assert str(FIXTURES).encode() not in written  # files by name, not their path on Lisul's Mac
    assert answers(records, row.record)["password"]["on_page"] == "(secret, not recorded)"


class BrokenRecords:
    def save(self, record):
        raise OSError("disk full")


def test_a_record_that_cannot_be_saved_never_loses_the_tracker_row(monkeypatch):
    monkeypatch.setitem(FILLERS, "other", SignUpFormFiller())
    tracker = run(NoBrowser(), BrokenRecords(), feed=json.dumps([feed_record()]).encode())

    [row] = tracker.rows()
    assert row.status == "submitted"
    assert row.record == ""
    assert "Record not saved: disk full" in row.reason
