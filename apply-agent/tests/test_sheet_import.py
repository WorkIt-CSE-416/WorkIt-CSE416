"""`apply import-sheet` (KAN-545): the Tracker Sheet into WorkIt's Applications Tracker, one time,
against a fake WorkIt (fake_workit.py, fake_tracker.py) and a sample Tracker Sheet
(fixtures/tracker-sheet.csv, the real Sheet's columns)."""

import csv
import io
from datetime import date

import pytest
from conftest import FIXTURES
from fake_tracker import FakeTracker
from fake_workit import FakeWorkIt

from apply import sheet_import, workit
from apply.workit import WorkIt

CELLS = list(csv.reader((FIXTURES / "tracker-sheet.csv").open()))

ACME = "https://boards.greenhouse.io/acme/jobs/8000001"  # the Sheet has its embed link
COBALT = "https://jobs.ashbyhq.com/cobalt/11111111-2222-4333-8444-555555555555/application"  # as the scraper keeps it
DYNAMO = "https://jobs.lever.co/dynamo/22222222-3333-4444-8555-666666666666"
IRIS = "https://boards.greenhouse.io/iris/jobs/9000009"

DRY_RUN = """\
Dry run: nothing is written yet. 11 rows in the Tracker Sheet.

Add to the Applications Tracker (7):
  row 2: Acme | Software Engineer Intern (Summer 2027) | applied | 2026-10-17 | resume: yes | listed | https://job-boards.greenhouse.io/embed/job_app?for=acme&token=8000001
  row 3: Bolt Aerospace | Software Engineer Intern - Summer 2027 | interviewing | 2026-10-20 | resume: no | not listed: WorkIt keeps it as an added job | https://bolt.eightfold.ai/careers/job/990000000001
  row 5: Dynamo | Platform Intern | rejected | 2026-10-19 | resume: yes | listed | https://jobs.lever.co/dynamo/22222222-3333-4444-8555-666666666666
  row 6: Ember | Data Intern | applied | 2026-10-21 | resume: no | not listed: WorkIt keeps it as an added job | https://ember.wd5.myworkdayjobs.com/Early_Career/job/NYC/Data-Intern_JR-1
  row 7: Flux | Embedded Intern | applied | 2026-10-17 | resume: no | not listed: WorkIt keeps it as an added job | https://careers.flux.com/global/en/job/2026800
  row 10: Iris | Infra Intern | applied | 2026-11-02 | resume: no | listed, on your tracker at saved | https://boards.greenhouse.io/iris/jobs/9000009
  row 11: Jade | Mobile Intern | applied | today | resume: no | not listed: WorkIt keeps it as an added job | https://jobs.lever.co/jade/44444444-5555-4666-8777-888888888888

Check these (2): added, but the Sheet did not say everything:
  row 7: Flux | Embedded Intern | Outcome "callback soon" is not one the import knows: it goes in as applied
  row 11: Jade | Mobile Intern | no Date applied: WorkIt dates it today

Skip (4):
  row 4: Cobalt | Backend Intern | already in WorkIt at offer: the import does not change it
  row 8: Gale | Robotics Intern | not submitted (missing fact)
  row 9: Helix | Frontend Intern | not submitted (queued)
  row 12: Acme | Software Engineer Intern (Summer 2027) | the same job as row 2
"""


@pytest.fixture
def workit_tracker(tmp_path):
    """A signed-in student whose WorkIt lists Acme, Cobalt, Dynamo and Iris; Cobalt is at offer from the
    extension, Iris saved from the Jobs page."""
    with FakeWorkIt() as fake:
        tracker = FakeTracker(fake)
        tracker.listed(ACME, "Acme", "Software Engineer Intern (Summer 2027)")
        tracker.applied_before(tracker.listed(COBALT, "Cobalt", "Backend Intern"), "offer")
        tracker.listed(DYNAMO, "Dynamo", "Platform Intern")
        tracker.applied_before(tracker.listed(IRIS, "Iris", "Infra Intern"), "saved")
        client = WorkIt(fake.site, tmp_path / "workit-login.json")
        workit.login(client, lambda url, accept: accept(fake.cookies(fake.session())))
        fake.requests.clear()
        yield fake, tracker, client


@pytest.fixture
def sent(tmp_path):
    """Apply's sent folder: Acme's resume and cover letter, Dynamo's resume, and only a cover letter for Iris."""
    folder = tmp_path / "sent"
    for day, name, files in [
        ("2026-10-17", "acme-request-0000000000a1", ["Test_Person_Resume.pdf", "Test_Person_Cover_Letter.pdf"]),
        ("2026-10-19", "dynamo-request-0000000000d4", ["Test_Person_Resume.pdf"]),
        ("2026-11-02", "iris-request-000000000009", ["Test_Person_Cover_Letter.pdf"]),
    ]:
        (folder / day / name).mkdir(parents=True)
        for file in files:
            (folder / day / name / file).write_bytes(f"%PDF {name} {file}".encode())
    return folder


def run(client, sent, answer="yes", dry_run=False):
    out = io.StringIO()
    status = sheet_import.run(CELLS, client, sent, approve=lambda prompt: answer, out=out, dry_run=dry_run)
    return status, out.getvalue()


def writes(fake):
    return [seen for seen in fake.requests if seen.method != "GET" and seen.path != "/jobs/listed-by-link"]


def test_the_dry_run_lists_every_add_stage_date_resume_and_skip_and_writes_nothing(workit_tracker, sent):
    fake, tracker, client = workit_tracker
    status, out = run(client, sent, dry_run=True)

    assert status == 0
    assert out == DRY_RUN
    assert writes(fake) == []
    assert len(tracker.applications) == 2


def test_no_approval_writes_nothing(workit_tracker, sent):
    fake, _, client = workit_tracker
    status, out = run(client, sent, answer="no")

    assert status == 0
    assert out.endswith("Nothing written.\n")
    assert writes(fake) == []


def test_after_approval_it_writes_them_and_a_second_run_adds_nothing(workit_tracker, sent):
    fake, tracker, client = workit_tracker
    status, out = run(client, sent)

    assert status == 0
    assert out.endswith("Done: 7 added, 0 failed. Run it again to retry: it skips what is in WorkIt.\n")
    got = {tracker.postings[job].company: (a.stage, a.applied_at, "added" if tracker.postings[job].added else "listed",
                                           tracker.sent[a.sent_resume_id].content if a.sent_resume_id else None)
           for job, a in tracker.applications.items()}
    assert got == {
        "Acme": ("applied", "2026-10-17T12:00:00+00:00", "listed",
                 b"%PDF acme-request-0000000000a1 Test_Person_Resume.pdf"),
        "Bolt Aerospace": ("interviewing", "2026-10-20T12:00:00+00:00", "added", None),
        "Cobalt": ("offer", "2026-09-01T15:00:00+00:00", "listed", None),  # never changed
        "Dynamo": ("rejected", "2026-10-19T12:00:00+00:00", "listed",
                   b"%PDF dynamo-request-0000000000d4 Test_Person_Resume.pdf"),
        "Ember": ("applied", "2026-10-21T12:00:00+00:00", "added", None),
        "Flux": ("applied", "2026-10-17T12:00:00+00:00", "added", None),
        "Iris": ("applied", "2026-11-02T12:00:00+00:00", "listed", None),
        "Jade": ("applied", "2026-11-02T20:00:00+00:00", "added", None),  # the fake's today
    }

    fake.requests.clear()
    status, out = run(client, sent)
    assert status == 0
    assert "Add to the Applications Tracker (0):" in out
    assert "row 2: Acme | Software Engineer Intern (Summer 2027) | already in WorkIt at applied" in out
    assert "row 3: Bolt Aerospace | Software Engineer Intern - Summer 2027 | already in WorkIt at interviewing" in out
    assert writes(fake) == []
    assert len(tracker.applications) == 8 and len(tracker.postings) == 8


def test_an_application_applied_in_workit_between_the_dry_run_and_the_write_is_left_as_it_is(
        workit_tracker, sent):
    _, tracker, client = workit_tracker
    steps = sheet_import.plan(sheet_import.sheet_rows(CELLS), client, sent)
    tracker.applied_before(tracker.find(DYNAMO).id, "interviewing")  # the extension, meanwhile

    out = io.StringIO()
    assert sheet_import.write(steps, client, out) == (6, 0)
    assert "row 5: Dynamo | Platform Intern: already in WorkIt at interviewing, left as it is" in out.getvalue()
    assert tracker.applications[tracker.find(DYNAMO).id].stage == "interviewing"
    assert tracker.applications[tracker.find(DYNAMO).id].sent_resume_id is None


def test_a_refused_row_is_listed_and_the_others_still_go_in(workit_tracker, sent):
    fake, tracker, client = workit_tracker
    from fake_workit import Reply
    fake.route("POST", "/jobs/added-by-link", lambda seen, fake: Reply(409, {
        "detail": "That link is a company's own job posting on WorkIt."}) if "ember" in seen.body["url"]
        else tracker._added_by_link(seen))

    status, out = run(client, sent)
    assert status == 1
    assert ("row 6: Ember | Data Intern: FAILED: POST /jobs/added-by-link: 409 That link is a company's own job "
            "posting on WorkIt.") in out
    assert out.endswith("Done: 6 added, 1 failed. Run it again to retry: it skips what is in WorkIt.\n")


def test_the_resume_is_the_one_kept_on_the_day_it_was_applied(tmp_path):
    sent = tmp_path / "sent"
    for day, file in [("2026-10-16", "Resume.pdf"), ("2026-10-17", "Resume.pdf"), ("2026-10-18", "Other.pdf")]:
        (sent / day / "acme-request-1").mkdir(parents=True)
        (sent / day / "acme-request-1" / file).write_bytes(day.encode())
    (sent / "2026-10-17" / "acme-request-11").mkdir()
    (sent / "2026-10-17" / "acme-request-11" / "Resume.pdf").write_bytes(b"another Application")

    assert sheet_import.sent_resume(sent, "request-1", date(2026, 10, 17)).read_bytes() == b"2026-10-17"
    assert sheet_import.sent_resume(sent, "request-1", None).read_bytes() == b"2026-10-17"  # the newest with one
    assert sheet_import.sent_resume(sent, "request-2", date(2026, 10, 17)) is None


def test_a_link_matches_as_workit_matches_it():
    key = sheet_import.job_key
    assert key("https://job-boards.greenhouse.io/embed/job_app?for=acme&token=8000001") == key(ACME)
    assert key("https://www.Example.com/jobs/1/?src=x#top") == key("http://example.com/jobs/1")
    assert key("https://example.com/jobs/1") != key("https://example.com/jobs/2")
