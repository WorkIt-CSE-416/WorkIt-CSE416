"""Apply writes to the student's Applications Tracker (KAN-544), against a
fake WorkIt (fake_workit.py): a submit is Applied with the file sent as its
Sent resume, a Handoff, a Missing fact or a Hold is Needs you (never Queued:
WorkIt's extension fills queued applications).
WorkIt down: the write waits in the data folder and goes on the next send."""

import dataclasses
import datetime
import json
import time
from pathlib import Path

import pytest
from fake_tracker import FakeTracker
from fake_workit import FakeWorkIt

from apply import workit
from apply.workit import WaitingWrites, WorkIt, Write

LOCKHEED = "https://lockheedmartin.eightfold.ai/careers/job/7123456"
PDF = b"%PDF-1.7 Test Person's resume"


def logged_in(fake: FakeWorkIt, tmp_path: Path) -> WorkIt:
    client = WorkIt(fake.site, tmp_path / "workit-login.json")
    workit.login(client, lambda url, accept: accept(fake.cookies(fake.session())))
    return client


def resume(tmp_path: Path) -> str:
    path = tmp_path / "sent" / "Test_Person_Resume.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PDF)
    return str(path)


def write(stage: str, **fields) -> Write:
    return Write(**{"application_id": "request-1", "link": LOCKHEED, "company": "Lockheed Martin",
                    "title": "Software Engineer Intern", "stage": stage, **fields})


@pytest.fixture
def fake():
    """The fake WorkIt, with its Applications Tracker (fake_tracker.py) as `fake.tracker`."""
    with FakeWorkIt() as fake:
        fake.tracker = FakeTracker(fake)
        yield fake


def test_a_submit_is_applied_with_the_file_sent_as_its_sent_resume(fake, tmp_path):
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    said = writes.send(write("applied", resume=resume(tmp_path)))

    assert fake.tracker.tracked() == [{"link": LOCKHEED, "company": "Lockheed Martin", "stage": "applied",
                               "sent_resume": "Test_Person_Resume.pdf"}]
    assert [sent.content for sent in fake.tracker.sent.values()] == [PDF]
    assert said == "in your Applications Tracker as Applied"
    assert writes.waiting() == []


def test_a_handoff_missing_fact_or_hold_is_needs_you(fake, tmp_path):
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    assert writes.send(write("needs_you")) == "in your Applications Tracker as Needs you"
    assert [row["stage"] for row in fake.tracker.tracked()] == ["needs_you"]


def test_the_writes_read_the_students_id_once(fake, tmp_path):
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")
    before = sum(seen.path == "/auth/me" for seen in fake.requests)

    writes.send(write("needs_you"))
    writes.send(write("applied", resume=resume(tmp_path)))

    assert writes.client.applicant_id() == fake.account["id"]
    assert sum(seen.path == "/auth/me" for seen in fake.requests) == before + 1


def test_a_later_status_for_the_same_job_moves_the_same_row(fake, tmp_path):
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    writes.send(write("needs_you"))
    writes.send(write("applied", resume=resume(tmp_path)))
    writes.send(write("applied", resume=resume(tmp_path)))  # sent twice: still one Sent resume

    assert [(row["stage"], row["sent_resume"]) for row in fake.tracker.tracked()] == [("applied", "Test_Person_Resume.pdf")]
    assert len(fake.tracker.sent) == 1


def test_a_submit_leaves_a_job_already_past_applied_as_it_is(fake, tmp_path):
    job = fake.tracker.listed(LOCKHEED, "Lockheed Martin", "Software Engineer Intern")
    fake.tracker.applied_before(job, "interviewing")
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    assert writes.send(write("applied", resume=resume(tmp_path))) == "already interviewing in your Applications Tracker"
    assert [(row["stage"], row["sent_resume"]) for row in fake.tracker.tracked()] == [("interviewing", None)]
    assert fake.tracker.sent == {}


def test_a_submit_makes_the_calls_of_record_applied(fake, tmp_path):
    """One write sequence (WorkIt.record_applied): add by link, the Sent resume, the stage, the resume's link."""
    client = logged_in(fake, tmp_path)
    start = len(fake.requests)
    WaitingWrites(client, tmp_path / "workit-queue.json").send(write("applied", resume=resume(tmp_path)))
    submit = [(seen.method, seen.path) for seen in fake.requests[start:] if seen.path != "/auth/me"]
    fake.tracker.applications.clear()
    start = len(fake.requests)
    client.record_applied(LOCKHEED, "Lockheed Martin", "Software Engineer Intern", Path(resume(tmp_path)))

    assert [(seen.method, seen.path) for seen in fake.requests[start:]] == submit
    assert [method for method, _ in submit] == ["POST", "POST", "PUT", "POST"]


def test_a_submit_with_no_file_kept_is_applied_with_no_sent_resume(fake, tmp_path):
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    writes.send(write("applied", resume=str(tmp_path / "gone.pdf")))

    assert [(row["stage"], row["sent_resume"]) for row in fake.tracker.tracked()] == [("applied", None)]


def test_needs_you_never_takes_back_a_job_already_applied_to(fake, tmp_path):
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")
    writes.send(write("applied"))

    assert writes.send(write("needs_you")) == "already Applied in your Applications Tracker"
    assert [row["stage"] for row in fake.tracker.tracked()] == ["applied"]
    assert writes.waiting() == []


def test_with_workit_down_the_write_waits_and_the_next_send_takes_it(fake, tmp_path):
    client = logged_in(fake, tmp_path)
    # WorkIt's API does not answer (nothing listens on port 9).
    no_api = dataclasses.replace(fake.site, api="http://127.0.0.1:9")
    down = WaitingWrites(WorkIt(no_api, tmp_path / "workit-login.json"), tmp_path / "workit-queue.json")

    said = down.send(write("applied", resume=resume(tmp_path)))

    assert said.startswith("kept to send to your Applications Tracker later")
    assert fake.tracker.tracked() == []
    assert [(w.company, w.stage) for w in down.waiting()] == [("Lockheed Martin", "applied")]
    # The next run, with WorkIt back: the waiting write goes first.
    again = WaitingWrites(client, tmp_path / "workit-queue.json")
    assert again.flush() == []
    assert [(row["stage"], row["sent_resume"]) for row in fake.tracker.tracked()] == [("applied", "Test_Person_Resume.pdf")]
    assert again.waiting() == []


def test_with_no_login_the_write_waits_for_apply_login(fake, tmp_path):
    writes = WaitingWrites(WorkIt(fake.site, tmp_path / "workit-login.json"), tmp_path / "workit-queue.json")

    assert "apply login" in writes.send(write("needs_you"))
    assert [w.stage for w in writes.waiting()] == ["needs_you"]
    assert fake.tracker.tracked() == []


def test_a_waiting_write_is_replaced_by_a_later_one_for_the_same_application(fake, tmp_path):
    writes = WaitingWrites(WorkIt(fake.site, tmp_path / "workit-login.json"), tmp_path / "workit-queue.json")
    writes.send(write("needs_you"))
    writes.send(write("applied"))
    writes.send(write("needs_you", application_id="request-2", link=LOCKHEED + "7"))

    assert [(w.application_id, w.stage) for w in writes.waiting()] == [("request-1", "applied"), ("request-2", "needs_you")]


def test_a_hold_kept_as_queued_by_an_older_apply_goes_as_needs_you(fake, tmp_path):
    queue = tmp_path / "workit-queue.json"
    queue.write_text(json.dumps([dataclasses.asdict(write("queued"))]))

    assert WaitingWrites(logged_in(fake, tmp_path), queue).flush() == []
    assert [row["stage"] for row in fake.tracker.tracked()] == ["needs_you"]


def test_a_write_past_the_daily_cap_waits_until_the_next_utc_day(fake, tmp_path, monkeypatch):
    fake.tracker.capped = True
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")
    tomorrow = datetime.datetime.combine(datetime.datetime.now(datetime.UTC).date() + datetime.timedelta(days=1),
                                         datetime.time(), datetime.UTC).timestamp()

    assert "daily cap" in writes.send(write("needs_you"))
    assert [(w.stage, w.not_before) for w in writes.waiting()] == [("needs_you", tomorrow)]
    # Before the cap resets, a flush does not ask WorkIt again.
    asked = len(fake.requests)
    assert writes.flush() == []
    assert len(fake.requests) == asked
    # The next day it goes.
    fake.tracker.capped = False
    monkeypatch.setattr(workit.time, "time", lambda: tomorrow + 1)
    assert writes.flush() == []
    assert [row["stage"] for row in fake.tracker.tracked()] == ["needs_you"]
    assert writes.waiting() == []


def test_a_write_past_the_daily_cap_waits_as_retry_after_says(fake, tmp_path):
    fake.tracker.capped, fake.tracker.retry_after = True, "120"
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")
    start = time.time()

    writes.send(write("applied", resume=resume(tmp_path)))
    writes.send(write("needs_you", application_id="request-2", link=LOCKHEED + "7"))

    assert [w.application_id for w in writes.waiting()] == ["request-1", "request-2"]
    assert all(start + 119 <= w.not_before <= time.time() + 121 for w in writes.waiting())


def test_a_write_workit_refuses_is_dropped_and_said(fake, tmp_path):
    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    word_file = tmp_path / "Resume.docx"
    word_file.write_bytes(b"PK\x03\x04 a Word file")  # WorkIt keeps only a PDF as a sent file: 422

    said = writes.send(write("applied", resume=str(word_file)))

    assert said.startswith("not in your Applications Tracker: WorkIt refused it")
    assert writes.waiting() == []


# --- Apply's Tracker writes each status to the Applications Tracker ----------


def row(status, **fields):
    from apply.tracker import Row

    return Row(**{"application_id": "request-1", "company": "Lockheed Martin", "role": "Software Engineer Intern",
                  "posting_url": LOCKHEED, "job_system": "eightfold", "status": status, **fields})


def recording(fake, tmp_path, resume_of=lambda application_id: ""):
    from apply.tracker import InMemoryTracker, WorkItTracker

    writes = WaitingWrites(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")
    return WorkItTracker(InMemoryTracker(), writes, resume_of)


def test_a_submitted_row_is_applied_with_the_file_sent(fake, tmp_path):
    from apply.model import Status

    sent = resume(tmp_path)
    tracker = recording(fake, tmp_path, lambda application_id: sent if application_id == "request-1" else "")

    tracker.add(row(Status.SUBMITTED))

    assert [(r["stage"], r["sent_resume"]) for r in fake.tracker.tracked()] == [("applied", "Test_Person_Resume.pdf")]
    assert tracker.get("request-1").status == Status.SUBMITTED  # Apply's own row is kept as before


def test_each_status_moves_the_one_row_of_its_job(fake, tmp_path):
    from apply.model import Status

    tracker = recording(fake, tmp_path)
    tracker.add(row(Status.FILLING))
    assert fake.tracker.tracked() == []  # filling is not a stage on the tracker

    for status, stage in [(Status.HELD, "needs_you"), (Status.HANDOFF, "needs_you"),
                          (Status.MISSING_FACT, "needs_you"), (Status.SUBMITTED, "applied")]:
        tracker.update("request-1", status=status)
        assert [r["stage"] for r in fake.tracker.tracked()] == [stage]


def test_a_failed_closed_or_queued_application_and_a_note_send_nothing(fake, tmp_path):
    from apply.model import Status

    tracker = recording(fake, tmp_path)
    tracker.add(row(Status.HELD))
    sent = len(fake.requests)
    tracker.update("request-1", reason="Held again after your approval")  # no new status
    tracker.add(row(Status.FAILED, application_id="request-2", posting_url=LOCKHEED + "2"))
    tracker.add(row(Status.CLOSED, application_id="request-3", posting_url=LOCKHEED + "3"))
    tracker.update("request-2", status=Status.QUEUED)

    assert len(fake.requests) == sent


def test_a_write_that_breaks_never_stops_the_run(fake, tmp_path, capsys):
    from apply.model import Status
    from apply.tracker import InMemoryTracker, WorkItTracker

    class Broken:
        def send(self, write):
            raise RuntimeError("disk full")

    tracker = WorkItTracker(InMemoryTracker(), Broken(), lambda application_id: "")
    tracker.add(row(Status.SUBMITTED))

    assert tracker.get("request-1").status == Status.SUBMITTED
    assert "disk full" in capsys.readouterr().err


def test_the_resume_sent_is_found_in_the_applications_sent_folder(tmp_path):
    from apply.worker import keep_sent, sent_resume

    sent = tmp_path / "home" / "sent"

    def given(name: str, day: str, application_id: str = "request-1a2b") -> Path:
        path = tmp_path / "files" / name
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(b"%PDF " + name.encode() + day.encode())
        return keep_sent(sent / day / f"lockheed-martin-{application_id}", path)  # as worker.sent_folder names it

    assert sent_resume("request-1a2b", "Test_Person_Resume.pdf", sent) == ""
    given("Test_Person_Transcript.pdf", "2026-11-01")
    given("Test_Person_Resume.pdf", "2026-11-01")
    newest = given("Test_Person_Resume.pdf", "2026-11-02")
    given("Test_Person_Resume.pdf", "2026-11-03", "request-other")

    assert sent_resume("request-1a2b", "Test_Person_Resume.pdf", sent) == str(newest)
    # A profile resume renamed since: the file named as a resume
    assert sent_resume("request-1a2b", "CV.pdf", sent) == str(newest)
    # Only a transcript was sent: no resume
    given("Test_Person_Transcript.pdf", "2026-11-04", "request-3")
    assert sent_resume("request-3", "Test_Person_Resume.pdf", sent) == ""
