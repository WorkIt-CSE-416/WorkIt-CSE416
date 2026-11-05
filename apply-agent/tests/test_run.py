"""Seam 1: one whole `apply run`, with fakes for every outside system."""

import shutil
from datetime import date, datetime
from pathlib import Path
from urllib.error import HTTPError

from conftest import (
    ARC_FORM,
    ARC_URL,
    FIXTURES,
    IMMUTA_FORM,
    IMMUTA_URL,
    SKYDIO_FORM,
    SKYDIO_URL,
)
from fake_lever import FakeLeverServer
from fakes import (
    FakeClaude,
    FakeClock,
    FakeJobServer,
    FakeMailbox,
    RecordingBoard,
    ScriptedUsage,
)
from test_matches import feed_record
from test_requests import run as run_requests

from apply import orchestrator
from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.notify import RecordingNotifier
from apply.repair import RepairRequests
from apply.tracker import InMemoryTracker

ARC_ID = "6e2de8e6-b0dd-45d3-915d-9fc952cc4a7f"
IMMUTA_ID = "d5f1160b-114b-4a0e-b196-adf32447203e"
IMMUTA_WORK_AUTH_CARD = "cards[db60ba3f-3128-46de-8310-9d3a73d8a6c8]"


def run(job_server, feed: str = "feed.json", board=None, profile=FIXTURES / "profile.yaml", **more) -> InMemoryTracker:
    tracker = InMemoryTracker()
    adapters = Adapters(
        feed=SimplifyFeed((FIXTURES / feed).read_bytes),
        tracker=tracker,
        site=job_server,
        claude=FakeClaude(),
        mailbox=FakeMailbox(),
        usage=ScriptedUsage(),
        clock=FakeClock(datetime(2026, 10, 15, 9, 30)),
        **({"board": board} if board else {}),
        **more,
    )
    main(["run", "--profile", str(profile)], adapters=adapters)
    return tracker


def a_profile(folder, policies: str):
    """The test Applicant profile with a policies.yaml beside it that adds `policies`."""
    folder.mkdir()
    for name in ("profile.yaml", "one-pager.pdf"):
        shutil.copy(FIXTURES / name, folder / name)
    (folder / "policies.yaml").write_text((FIXTURES / "policies.yaml").read_text() + policies)
    return folder / "profile.yaml"


def a_headed_profile(folder):
    """The test Applicant profile with a policies.yaml beside it that runs the Workers headed."""
    return a_profile(folder, "worker_headless: false\n")


def test_run_submits_a_greenhouse_match_and_tracks_it(job_server, one_pager):
    tracker = run(job_server)

    [row] = tracker.rows()
    assert (row.application_id, row.company, row.role) == (ARC_ID, "Arc", "Software Engineer Intern")
    assert (row.posting_url, row.job_system) == (ARC_URL, "greenhouse")
    assert row.status == "submitted"
    assert row.date_applied == date(2026, 10, 15)

    [sent] = job_server.submissions
    application = sent.application
    assert (application["first_name"], application["last_name"]) == ("Test", "Person")
    assert application["email"] == "test.person@example.com"
    answers = application["answers_attributes"]
    assert answers["18871502008"]["boolean_value"] == 1  # authorized to work in the US
    assert answers["18871503008"]["boolean_value"] == 0  # needs no sponsorship
    assert sent.files["resume"] == one_pager.read_bytes()


def test_run_gives_the_form_the_postings_tailored_resume(job_server, one_pager, monkeypatch, tmp_path):
    # KAN-547: WorkIt has a tailored resume for Arc's posting, so Arc's form gets it, by the profile's resume name.
    from apply import tailored

    monkeypatch.setattr(tailored, "TAILORED", tmp_path / "tailored")
    tailored_pdf = b"%PDF-1.7 the resume tailored to Arc"

    tracker = run(job_server, tailored=lambda posting: tailored_pdf if posting.url == ARC_URL else None)

    assert tracker.rows()[0].status == "submitted"
    [sent] = job_server.submissions
    assert sent.files["resume"] == tailored_pdf
    assert one_pager.read_bytes() != tailored_pdf  # the profile's own resume is unchanged


def test_a_readback_mismatch_holds_the_application_and_never_submits():
    with FakeJobServer(ARC_FORM, garble="email") as job_server:
        tracker = run(job_server)

    [row] = tracker.rows()
    assert row.status == "held"
    assert "Email" in row.reason
    assert row.date_applied is None
    assert job_server.submissions == []


def test_a_required_field_the_question_set_missed_holds_the_application():
    # Harvey (2026-10-16): the form asked 22 required questions and the Question set held 20.
    government = "6740d716-7398-44bc-acc7-f6c9ab74edd5"  # Skydio's "Prior US Government Employment?"
    with FakeJobServer(SKYDIO_FORM, unlisted=(government,)) as ashby_server:
        tracker = run(ashby_server, feed="feed-skydio.json")

    [row] = tracker.rows()
    assert row.status == "held"
    assert "Pre-submit check failed" in row.reason and "Prior US Government Employment?" in row.reason
    assert ashby_server.submissions == []


def test_a_captcha_challenge_after_the_submit_click_is_a_handoff():
    with FakeJobServer(ARC_FORM, challenge=True) as job_server:
        tracker = run(job_server)

    [row] = tracker.rows()
    assert row.status == "handoff"
    assert "captcha" in row.reason
    assert row.bot_signals == "headless: captcha"  # how the browser ran, and what suggests it was taken for a bot
    assert job_server.submissions == []


def test_a_captcha_after_the_submit_click_waits_for_lisul_then_is_submitted(tmp_path):
    # Lisul (2026-11-03): "for the submission i'll do the captcha too just notify me".
    profile = a_profile(tmp_path / "mine", "phone_push: true\ncaptcha_wait_minutes: 1\n")
    phone = RecordingNotifier()
    with FakeJobServer(ARC_FORM, challenge="solved") as job_server:
        tracker = run(job_server, profile=profile, phone=phone)

    [row] = tracker.rows()
    assert row.status == "submitted", row.reason
    assert phone.sent[0] == ("Apply: do the captcha", "Do the captcha on Arc. Apply goes on by itself once it's done.")
    assert len(job_server.submissions) == 1


def test_a_row_notes_a_headed_workers_bot_signals_as_headed(tmp_path):
    with FakeJobServer(ARC_FORM, challenge=True) as job_server:
        tracker = run(job_server, profile=a_headed_profile(tmp_path / "mine"))

    [row] = tracker.rows()
    assert row.bot_signals == "headed: captcha"


def test_a_submitted_row_notes_how_its_browser_ran_even_with_no_bot_signal(job_server, one_pager):
    tracker = run(job_server)

    [row] = tracker.rows()
    assert row.status == "submitted"
    assert row.bot_signals == "headless"


def test_a_lever_captcha_challenge_after_the_submit_click_is_a_handoff():
    with FakeLeverServer(IMMUTA_FORM, parse_delay=0.2, challenge=True) as lever_server:
        tracker = run(lever_server, feed="feed-lever.json")

    [row] = tracker.rows()
    assert row.status == "handoff"
    assert "captcha" in row.reason
    assert lever_server.submissions == []


def test_an_ashby_refusal_after_the_submit_click_is_a_handoff_naming_it():
    # Ashby may refuse a form sent from an automated browser (reCAPTCHA scored it low).
    refusal = "Your application submission was flagged as possible spam."
    with FakeJobServer(SKYDIO_FORM, refuse=refusal) as ashby_server:
        tracker = run(ashby_server, feed="feed-skydio.json")

    [row] = tracker.rows()
    assert row.status == "handoff"
    assert f"Ashby refused the submission: {refusal}" in row.reason
    assert row.bot_signals == "headless: refused"
    assert row.date_applied is None
    assert ashby_server.submissions == []


def test_an_ashby_block_message_after_the_submit_click_is_a_handoff_naming_it():
    # An employer's own block on Ashby, such as a limit on applications, shows in place of the success page.
    block = "<p>You have reached the limit of applications to this company.</p>"
    with FakeJobServer(SKYDIO_FORM, block=block) as ashby_server:
        tracker = run(ashby_server, feed="feed-skydio.json")

    [row] = tracker.rows()
    assert row.status == "handoff"
    assert "Ashby refused the submission: You have reached the limit of applications to this company" in row.reason
    assert row.bot_signals == "headless"  # the employer's own rule, not a bot check


def test_run_submits_an_ashby_match_and_tracks_it(ashby_server, one_pager):
    tracker = run(ashby_server, feed="feed-skydio.json")

    [row] = tracker.rows()
    assert (row.company, row.role, row.posting_url, row.job_system) == (
        "Skydio", "Software Engineer Intern", SKYDIO_URL, "ashby"
    )
    assert row.status == "submitted"
    assert row.date_applied == date(2026, 10, 15)

    [sent] = ashby_server.submissions
    application = sent.application
    assert application["_systemfield_name"] == "Test Person"
    assert application["_systemfield_email"] == "test.person@example.com"
    assert application["6165f03b-05a6-4df2-be8d-7a7cda5b110c"] == "5550100199"  # Phone Number: the national number, as the engine plans every phone
    assert application["c844e287-5fe4-4294-9317-9f17ca09f26e"] == "https://www.linkedin.com/in/test-person"
    assert application["e3b7defc-c91c-4b8a-bde2-b838f2ed0a6f"] == ["May 2027"]  # start month(s), a multi-select
    assert application["6740d716-7398-44bc-acc7-f6c9ab74edd5"] is False  # prior US government employment
    assert sent.files["_systemfield_resume"] == one_pager.read_bytes()


def test_run_submits_a_lever_match_and_tracks_it(lever_server, one_pager):
    tracker = run(lever_server, feed="feed-lever.json")

    [row] = tracker.rows()
    assert (row.application_id, row.company) == (IMMUTA_ID, "Immuta")
    assert (row.posting_url, row.job_system) == (IMMUTA_URL, "lever")
    assert row.status == "submitted", row.reason
    assert row.date_applied == date(2026, 10, 15)

    [sent] = lever_server.submissions
    application = sent.application
    assert (application["name"], application["email"]) == ("Test Person", "test.person@example.com")
    assert application["phone"] == "5550100199"  # the national number
    assert application["location"] == "Columbus, OH, USA"
    assert application["urls[LinkedIn]"] == "https://www.linkedin.com/in/test-person"
    assert application[f"{IMMUTA_WORK_AUTH_CARD}[field0]"] == "Yes"  # authorized to work in the US
    assert application[f"{IMMUTA_WORK_AUTH_CARD}[field1]"] == "No"  # needs no sponsorship
    assert application["consent[store]"] == "1"  # agrees to the privacy policy
    assert sent.files["resume"] == one_pager.read_bytes()


class Gone:
    """Every job system answers 404: the Postings closed after the Feed was read."""

    def __init__(self):
        self.opened: list[str] = []

    def fetch(self, url, body=None):
        raise HTTPError(url, 404, "Not Found", {}, None)

    def open(self, url, worker=0):
        self.opened.append(url)
        raise AssertionError("a closed Posting's form is never opened")


def test_a_posting_closed_since_the_feed_was_read_is_skipped_as_closed(monkeypatch):
    site = Gone()

    rows = run_requests(
        monkeypatch,
        feed_record(id="match", url="https://job-boards.greenhouse.io/acme/jobs/1"),
        requests=["https://jobs.lever.co/beta/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab"],
        site=site, fillers=(),
    )

    assert [(row.posting_url, row.status) for row in rows] == [
        ("https://jobs.lever.co/beta/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab", "closed"),
        ("https://job-boards.greenhouse.io/acme/jobs/1", "closed"),
    ]
    assert all(row.reason.startswith("Closed") for row in rows)
    assert site.opened == []


def test_the_dashboard_tile_of_each_worker_says_what_it_applied_to_and_how_it_ended(job_server):
    board = RecordingBoard()

    run(job_server, board=board)

    files = board.captions[0].pop("files")  # a kept copy of each file the form was sent
    assert files and all(Path(f["path"]).is_file() for f in files)
    assert board.captions[0].pop("posting_url").startswith("http")  # so the window can link the Posting
    assert board.captions[0].pop("application_id")
    assert board.captions[0].pop("verifying") is False  # it was verified before it was sent
    assert board.captions[0].pop("verification")["state"] == "verified"
    assert board.captions == {0: {"company": "Arc", "role": "Software Engineer Intern", "job_system": "greenhouse",
                                  "status": "submitted", "line": "submitted", "why": "", "drafted": [],
                                  "choices": {}, "required": {}, "essay": ""}}


def test_a_failed_application_and_a_wrong_answer_leave_repair_requests(monkeypatch, tmp_path):
    def blow_up(*args, **kwargs):
        raise KeyError("school--0")

    repairs = RepairRequests(tmp_path)
    with FakeJobServer(ARC_FORM, garble="email") as job_server:
        run(job_server, repairs=repairs)  # the page drops a letter of the email
    [wrong] = repairs.waiting()
    assert wrong.kind == "wrong answer" and "Email" in wrong.problems[0]

    monkeypatch.setattr(orchestrator, "by_filler", blow_up)
    with FakeJobServer(ARC_FORM) as job_server:
        tracker = run(job_server, repairs=RepairRequests(tmp_path / "failed"))
    [row] = tracker.rows()
    assert row.status == "failed"
    [failure] = RepairRequests(tmp_path / "failed").waiting()
    assert failure.failure == "KeyError: 'school--0'"
    assert failure.applications == [{"id": ARC_ID, "url": ARC_URL}]
    assert "in blow_up" in failure.traceback


def test_a_setup_error_fails_its_application_but_leaves_no_repair_request(monkeypatch, tmp_path):
    from apply.adapters import SetupError

    def logged_out(*args, **kwargs):
        raise SetupError("Claude isn't logged in: run `claude auth login` in a terminal, then try again")

    monkeypatch.setattr(orchestrator, "by_filler", logged_out)
    repairs = RepairRequests(tmp_path)
    with FakeJobServer(ARC_FORM) as job_server:
        tracker = run(job_server, repairs=repairs)
    [row] = tracker.rows()
    assert row.status == "failed" and "claude auth login" in row.reason
    assert repairs.all() == []
