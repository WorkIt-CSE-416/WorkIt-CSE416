"""Own applications: `apply applied <link>`, or a link pasted atop the Apply
window's Answers tab, adds an Application Lisul submitted himself to the
Tracker as submitted, with Claude reading the company and role off the link
and its page."""

from datetime import date

import pytest
from fakes import FakeClock, FakeMailbox, ScriptedUsage
from test_answers_tab import (  # noqa: F401 (fixtures)
    NoFrames,
    board,
    files,
    post,
    window,
)
from test_matches import NOW, feed_record
from test_requests import Pages, run

from apply.adapters import Adapters
from apply.answer_bank import AnswerBank
from apply.answers_tab import AnswersTab
from apply.cli import main
from apply.dashboard import Dashboard
from apply.feed import SimplifyFeed
from apply.model import Status
from apply.own_application import REASON, own_id
from apply.tracker import InMemoryTracker

# Cisco's thank-you page after a Workday submit: drawn by script, so a plain fetch shows nothing.
THANK_YOU = ("https://careers.cisco.com/global/en/applythankyou?status=success&jobSeqNo=CISCISGLOBAL2026800EXTERNALENGLOBAL"
             "&jobTitle=Software+Engineer+Full+Stack+%2F+Backend+II+%28Intern%29+%E2%80%93+United+States&jobId=2026800")
ROLE = "Software Engineer Full Stack / Backend II (Intern) – United States"
JOB_PAGE = "https://careers.cisco.com/global/en/job/2026800"


class Reads:
    """Plays Claude reading a link: gives `found` (else nothing) and keeps every prompt."""

    def __init__(self, **found: str):
        self.found = {"company": "", "role": "", "job_id": "", "posting_link": ""} | found
        self.prompts: list[str] = []

    def ask(self, *, model, system, prompt, schema):
        self.prompts.append(prompt)
        return dict(self.found)


def applied(*urls: str, claude: Reads, tracker: InMemoryTracker | None = None, pages: dict | None = None):
    tracker = tracker if tracker is not None else InMemoryTracker()
    main(["applied", *urls], adapters=Adapters(
        feed=SimplifyFeed(lambda: b"[]"), tracker=tracker, site=Pages(pages), claude=claude,
        mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(NOW),
    ))
    return tracker


def cisco(**found: str) -> Reads:
    return Reads(**({"company": "Cisco", "role": ROLE, "job_id": "2026800", "posting_link": JOB_PAGE} | found))


def test_a_thank_you_link_becomes_a_submitted_row_for_the_posting_it_names(capsys):
    claude = cisco()
    tracker = applied(THANK_YOU, claude=claude, pages={JOB_PAGE: b'<script>{"reqId":"2026800"}</script>'})

    [row] = tracker.rows()
    assert (row.company, row.role, row.posting_url) == ("Cisco", ROLE, JOB_PAGE)
    assert (row.status, row.date_applied, row.reason) == (Status.SUBMITTED, date(2026, 10, 15), REASON)
    assert row.application_id == own_id(JOB_PAGE)
    assert ROLE in claude.prompts[0]  # the link's parameters, decoded
    assert "Added Cisco" in capsys.readouterr().out


def test_a_posting_page_claude_names_that_does_not_load_leaves_the_pasted_link():
    tracker = applied(THANK_YOU, claude=cisco())

    assert [row.posting_url for row in tracker.rows()] == [THANK_YOU]


def test_a_posting_page_that_names_neither_the_role_nor_the_job_leaves_the_pasted_link():
    tracker = applied(THANK_YOU, claude=cisco(), pages={JOB_PAGE: b"<p>Careers at Cisco</p>"})

    assert [row.posting_url for row in tracker.rows()] == [THANK_YOU]


def test_the_same_application_pasted_twice_has_one_row(capsys):
    tracker = applied(THANK_YOU, THANK_YOU, claude=cisco())

    assert len(tracker.rows()) == 1
    assert f"Already in the Tracker: {THANK_YOU}" in capsys.readouterr().out


def test_a_link_claude_cannot_read_adds_nothing_and_says_so(capsys):
    tracker = applied("https://example.com/thanks", claude=Reads(company="Acme"))

    assert tracker.rows() == []
    assert "nothing was added" in capsys.readouterr().out


def test_a_run_never_applies_again_to_a_posting_lisul_applied_to_himself(monkeypatch):
    posting = "https://jobs.example.com/acme/7"
    tracker = applied(posting, claude=Reads(company="Acme", role="Software Engineer Intern", posting_link=posting))

    rows = run(monkeypatch, feed_record(url=posting + "?utm_source=Simplify"), tracker=tracker)

    assert rows == []


# The paste box atop the Apply window's Answers tab.

@pytest.fixture
def pasted(files):
    """The window's server, with what each link pasted into it was sent to."""
    profile, bank = files
    links: list[str] = []

    def applied(url: str) -> str:
        links.append(url)
        return f"Added Cisco, {ROLE} (2026-10-15) to the Tracker as submitted."

    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(bank), profile), applied) as board:
        yield board, links


def test_a_link_pasted_into_the_window_is_added_and_the_window_says_how(pasted, window):
    board, links = pasted
    window.goto(board.url + "/#history")

    window.click("text=Applied somewhere yourself?")  # folded away at the end of History
    window.fill("#applied-link", f"  {THANK_YOU} ")
    window.click("#applied-button")
    window.wait_for_function("document.querySelector('#applied-status').textContent.startsWith('Added')")

    assert links == [THANK_YOU]
    assert window.input_value("#applied-link") == ""


@pytest.mark.parametrize("headers", [{"X-Apply-Token": "guessed"}, {"Origin": "https://evil.example"}])
def test_a_link_from_anywhere_but_the_window_itself_is_refused(pasted, headers):
    board, links = pasted

    status, _ = post(board, "/applied", {"url": THANK_YOU}, headers)

    assert status == 403 and links == []


def test_text_that_is_not_a_link_is_refused_before_claude_reads_it(pasted):
    board, links = pasted

    status, reply = post(board, "/applied", {"url": "Cisco intern"})

    assert status == 400 and "https://" in reply["error"] and links == []


def test_without_a_tracker_to_add_to_the_window_shows_no_paste_box(board, window):
    window.goto(board.url + "/#history")

    assert window.locator("#applied-link").count() == 0
