"""Apply writes to the student's Applications Tracker (KAN-544), against a
fake WorkIt (fake_workit.py): a submit is Applied with the file sent as its
Sent resume, a Handoff or a Missing fact is Needs you, a Hold is Queued.
WorkIt down: the write waits in the data folder and goes on the next send."""

import dataclasses
from pathlib import Path

import pytest
from fake_workit import FakeWorkIt

from apply import workit
from apply.workit import Outbox, WorkIt, Write

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
    with FakeWorkIt(tracker=True) as fake:
        yield fake


def test_a_submit_is_applied_with_the_file_sent_as_its_sent_resume(fake, tmp_path):
    outbox = Outbox(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    said = outbox.send(write("applied", resume=resume(tmp_path)))

    assert fake.tracked() == [{"link": LOCKHEED, "company": "Lockheed Martin", "stage": "applied",
                               "sent_resume": "Test_Person_Resume.pdf"}]
    assert [sent["data"] for sent in fake.sent_resumes.values()] == [PDF]
    assert said == "in your Applications Tracker as Applied"
    assert outbox.waiting() == []


@pytest.mark.parametrize("stage, shown", [("needs_you", "Needs you"), ("queued", "Queued")])
def test_a_handoff_or_missing_fact_is_needs_you_and_a_hold_is_queued(fake, tmp_path, stage, shown):
    outbox = Outbox(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    assert outbox.send(write(stage)) == f"in your Applications Tracker as {shown}"
    assert [row["stage"] for row in fake.tracked()] == [stage]


def test_a_later_status_for_the_same_job_moves_the_same_row(fake, tmp_path):
    outbox = Outbox(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    outbox.send(write("queued"))
    outbox.send(write("needs_you"))
    outbox.send(write("applied", resume=resume(tmp_path)))
    outbox.send(write("applied", resume=resume(tmp_path)))  # sent twice: still one Sent resume

    assert [(row["stage"], row["sent_resume"]) for row in fake.tracked()] == [("applied", "Test_Person_Resume.pdf")]
    assert len(fake.sent_resumes) == 1


def test_a_submit_with_no_file_kept_is_applied_with_no_sent_resume(fake, tmp_path):
    outbox = Outbox(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    outbox.send(write("applied", resume=str(tmp_path / "gone.pdf")))

    assert [(row["stage"], row["sent_resume"]) for row in fake.tracked()] == [("applied", None)]


def test_needs_you_never_takes_back_a_job_already_applied_to(fake, tmp_path):
    outbox = Outbox(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")
    outbox.send(write("applied"))

    assert outbox.send(write("needs_you")) == "already Applied in your Applications Tracker"
    assert [row["stage"] for row in fake.tracked()] == ["applied"]
    assert outbox.waiting() == []


def test_with_workit_down_the_write_waits_and_the_next_send_takes_it(fake, tmp_path):
    client = logged_in(fake, tmp_path)
    # WorkIt's API does not answer (nothing listens on port 9).
    no_api = dataclasses.replace(fake.site, api="http://127.0.0.1:9")
    down = Outbox(WorkIt(no_api, tmp_path / "workit-login.json"), tmp_path / "workit-queue.json")

    said = down.send(write("applied", resume=resume(tmp_path)))

    assert said.startswith("kept to send to your Applications Tracker later")
    assert fake.tracked() == []
    assert [(w.company, w.stage) for w in down.waiting()] == [("Lockheed Martin", "applied")]
    # The next run, with WorkIt back: the waiting write goes first.
    again = Outbox(client, tmp_path / "workit-queue.json")
    assert again.flush() == []
    assert [(row["stage"], row["sent_resume"]) for row in fake.tracked()] == [("applied", "Test_Person_Resume.pdf")]
    assert again.waiting() == []


def test_with_no_login_the_write_waits_for_apply_login(fake, tmp_path):
    outbox = Outbox(WorkIt(fake.site, tmp_path / "workit-login.json"), tmp_path / "workit-queue.json")

    assert "apply login" in outbox.send(write("queued"))
    assert [w.stage for w in outbox.waiting()] == ["queued"]
    assert fake.tracked() == []


def test_a_waiting_write_is_replaced_by_a_later_one_for_the_same_application(fake, tmp_path):
    outbox = Outbox(WorkIt(fake.site, tmp_path / "workit-login.json"), tmp_path / "workit-queue.json")
    outbox.send(write("queued"))
    outbox.send(write("needs_you"))
    outbox.send(write("queued", application_id="request-2", link=LOCKHEED + "7"))

    assert [(w.application_id, w.stage) for w in outbox.waiting()] == [("request-1", "needs_you"), ("request-2", "queued")]


def test_a_write_workit_refuses_is_dropped_and_said(fake, tmp_path):
    outbox = Outbox(logged_in(fake, tmp_path), tmp_path / "workit-queue.json")

    said = outbox.send(write("queued", company=""))

    assert said.startswith("not in your Applications Tracker: WorkIt refused it")
    assert outbox.waiting() == []
