"""Seam 1 for Requests: whole `apply run`s with links Lisul pasted into the
Requests tab (or added with `apply add`), read off the Tracker rows.

As in test_matches.py, job systems are filled by a stand-in Filler with an
empty form unless a test says otherwise, so most runs need no browser.
"""

import json
from contextlib import contextmanager
from datetime import date

from conftest import FIXTURES
from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from test_matches import NOW, BlankPage, EmptyFormFiller, feed_record, tracked

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import LIVE, SimplifyFeed
from apply.fillers import FILLERS
from apply.model import Status
from apply.request import request_id, resolve
from apply.tracker import InMemoryTracker, Row


class Pages:
    """A JobSite that serves saved pages to `fetch` and never opens a form."""

    def __init__(self, pages: dict[str, bytes] | None = None):
        self.pages = pages or {}
        self.fetched: list[str] = []

    def fetch(self, url, body=None):
        self.fetched.append(url)
        if url not in self.pages:
            raise LookupError(url)
        return self.pages[url]

    @contextmanager
    def open(self, url, worker=0):
        yield BlankPage()


def run(monkeypatch, *records: dict, requests: list[str] = (), tracker: InMemoryTracker | None = None,
        site=None, fillers=("other",), args=()) -> list[Row]:
    """One `apply run` over a Feed of `records`, with `requests` pasted into the
    Requests tab first. `fillers` names the job systems that have a Filler.
    Returns the rows it added, in order."""
    for job_system in fillers:
        monkeypatch.setitem(FILLERS, job_system, EmptyFormFiller())
    tracker = tracker or InMemoryTracker()
    for url in requests:
        tracker.paste_request(url)
    before = {row.application_id for row in tracker.rows()}
    main(
        ["run", "--profile", str(FIXTURES / "profile.yaml"), *args],
        adapters=Adapters(
            feed=SimplifyFeed(lambda: json.dumps(list(records)).encode()),
            tracker=tracker,
            site=site or Pages(),
            claude=FakeClaude(),
            mailbox=FakeMailbox(),
            usage=ScriptedUsage(),
            clock=FakeClock(NOW),
        ),
    )
    return [row for row in tracker.rows() if row.application_id not in before]


def test_requests_are_applied_to_first_in_the_order_pasted_then_leave_the_requests_tab(monkeypatch):
    tracker = InMemoryTracker()

    rows = run(
        monkeypatch,
        feed_record(id="match", url="https://jobs.example.com/match/1"),
        requests=["https://jobs.example.com/first/1", "https://jobs.example.com/second/2"],
        tracker=tracker,
    )

    assert [row.posting_url for row in rows] == [
        "https://jobs.example.com/first/1", "https://jobs.example.com/second/2", "https://jobs.example.com/match/1",
    ]
    assert [row.status for row in rows] == ["submitted"] * 3
    assert rows[0].date_applied == NOW.date()
    assert tracker.requests() == []


def test_a_request_skips_the_match_filters_and_the_per_company_cap(monkeypatch):
    # NOW is 2026-10-15; Acme has had its 3 Applications this week.
    tracker = InMemoryTracker()
    for n in (1, 2, 3):
        tracker.add(tracked(f"acme {n}", f"https://jobs.example.com/acme/{n}", company="Acme", role=f"Intern {n}",
                            date_applied=date(2026, 10, 14)))

    rows = run(
        monkeypatch,
        feed_record(id="acme in london", company_name="Acme", url="https://jobs.example.com/acme/4",
                locations=["London, UK"], category="Product"),
        requests=["https://jobs.example.com/acme/4", "https://jobs.example.com/acme/5"],
        tracker=tracker,
    )

    assert [(row.posting_url, row.status) for row in rows] == [
        ("https://jobs.example.com/acme/4", "submitted"), ("https://jobs.example.com/acme/5", "submitted"),
    ]


def greenhouse_requests(company: str, *jobs: int) -> tuple[list[str], Pages]:
    """Request links to Greenhouse jobs at `company`, and a site whose Job Board API names them."""
    board = company.casefold().replace(" ", "")
    links = [f"https://job-boards.greenhouse.io/{board}/jobs/{job}" for job in jobs]
    return links, Pages({
        f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job}?questions=true":
            json.dumps({"company_name": company, "title": f"Software Engineer Intern {job}"}).encode()
        for job in jobs
    })


def test_a_request_over_an_employer_limit_is_applied_to_anyway_with_a_warning(monkeypatch, capsys):
    # policies.yaml: ElevenLabs takes 1 Application in any 90 days, and one went in 30 days before NOW.
    tracker = InMemoryTracker()
    tracker.add(tracked("elevenlabs", "https://jobs.example.com/elevenlabs/1", company="ElevenLabs",
                        date_applied=date(2026, 9, 15)))
    links, site = greenhouse_requests("ElevenLabs", 123)

    [row] = run(monkeypatch, requests=links, tracker=tracker, site=site, fillers=("greenhouse",))

    assert row.status == "submitted"
    assert "ElevenLabs takes at most 1 applications in any 90 days" in row.reason
    warning = capsys.readouterr().err
    assert "Software Engineer Intern 123 at ElevenLabs" in warning
    assert "ElevenLabs takes at most 1 applications in any 90 days" in warning


def test_a_request_counts_the_applications_this_run_made_before_it(monkeypatch):
    # policies.yaml: Thinking Machines takes 1 Application in any 182 days. Neither Request is over it alone.
    links, site = greenhouse_requests("Thinking Machines", 1, 2)

    rows = run(monkeypatch, requests=links, site=site, fillers=("greenhouse",), args=("--workers", "1"))

    assert [row.status for row in rows] == ["submitted", "submitted"]
    assert "Thinking Machines takes at most" not in rows[0].reason
    assert "Thinking Machines takes at most 1 applications in any 182 days" in rows[1].reason


def test_a_request_for_a_posting_already_applied_to_is_refused_and_leaves_the_requests_tab(monkeypatch):
    tracker = InMemoryTracker()
    tracker.add(tracked("applied", "https://jobs.example.com/acme/1"))
    tracker.add(tracked("held", "https://jobs.lever.co/beta/abc", status=Status.HELD, date_applied=None))

    rows = run(
        monkeypatch,
        requests=[
            "https://jobs.example.com/acme/1/apply?utm_source=LinkedIn",
            "https://jobs.lever.co/beta/abc",
            "https://jobs.example.com/acme/2",
            "https://jobs.example.com/acme/2/",
        ],
        tracker=tracker,
    )

    assert [row.posting_url for row in rows] == ["https://jobs.example.com/acme/2"]
    assert tracker.requests() == []


def test_a_request_that_is_not_a_link_to_a_posting_is_failed(monkeypatch):
    tracker = InMemoryTracker()

    not_postings = [
        "Acme SWE intern, apply by Friday",
        "mailto:jobs@acme.com",
        "https://www.linkedin.com/company/lowe-s-home-improvement/",
    ]

    rows = run(monkeypatch, requests=not_postings, tracker=tracker)

    assert [(row.posting_url, row.status) for row in rows] == [(link, "failed") for link in not_postings]
    assert all("not a link to a job posting" in row.reason.lower() for row in rows)
    assert tracker.requests() == []


# Saved logged out on 2026-10-15 from https://www.linkedin.com/jobs/view/4467485195.
# Its Apply button opens a sign-in box; the page never names the employer's form.
LOWES_ON_LINKEDIN = (FIXTURES / "linkedin" / "lowes-swe-intern.html").read_bytes()


def test_a_linkedin_link_that_hides_the_employers_form_is_a_handoff(monkeypatch):
    site = Pages({"https://www.linkedin.com/jobs/view/4467485195": LOWES_ON_LINKEDIN})

    [row] = run(monkeypatch, requests=["https://www.linkedin.com/jobs/search/?currentJobId=4467485195&keywords=intern"],
                site=site)

    assert row.status == "handoff"
    assert (row.company, row.role) == ("Lowe's Companies, Inc.", "Software Engineer – Undergrad Internship – Summer 2027")
    assert row.posting_url == "https://www.linkedin.com/jobs/view/4467485195"
    assert "sign" in row.reason
    assert site.fetched == ["https://www.linkedin.com/jobs/view/4467485195"]


def test_a_linkedin_link_that_names_the_employers_form_is_applied_to_there(monkeypatch):
    # LinkedIn's older logged-out pages carried the employer's link like this.
    page = LOWES_ON_LINKEDIN.replace(b"</body>", (
        b'<code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/4467485195'
        b'?url=https%3A%2F%2Fjob-boards%2Egreenhouse%2Eio%2Flowes%2Fjobs%2F123%3Fgh_src%3Dlinkedin&amp;urlHash=x1"-->'
        b"</code></body>"
    ))
    site = Pages({"https://www.linkedin.com/jobs/view/4467485195": page})

    [row] = run(monkeypatch, requests=["https://www.linkedin.com/jobs/view/4467485195/"], site=site,
                fillers=("greenhouse",))

    assert (row.posting_url, row.job_system, row.status) == (
        "https://job-boards.greenhouse.io/lowes/jobs/123?gh_src=linkedin", "greenhouse", "submitted",
    )
    assert (row.company, row.role) == ("Lowe's Companies, Inc.", "Software Engineer – Undergrad Internship – Summer 2027")


def test_a_handshake_link_is_a_handoff_since_handshake_shows_postings_only_after_sign_in(monkeypatch):
    site = Pages()

    rows = run(monkeypatch, site=site, requests=[
        "https://app.joinhandshake.com/stu/jobs/9876543?searchId=abc",
        "https://stonybrook.joinhandshake.com/jobs/1234567",
    ])

    assert [(row.posting_url, row.status) for row in rows] == [
        ("https://app.joinhandshake.com/stu/jobs/9876543?searchId=abc", "handoff"),
        ("https://stonybrook.joinhandshake.com/jobs/1234567", "handoff"),
    ]
    assert all("sign" in row.reason for row in rows)
    assert site.fetched == []


def test_a_request_apply_cannot_read_is_failed_and_the_run_goes_on(monkeypatch):
    tracker = InMemoryTracker()

    rows = run(monkeypatch, tracker=tracker, requests=[
        "https://job-boards.greenhouse.io/arcboatcompany",  # the company's board, not one job
        "https://jobs.example.com/acme/1",
    ])

    assert [(row.posting_url, row.status) for row in rows] == [
        ("https://job-boards.greenhouse.io/arcboatcompany", "failed"), ("https://jobs.example.com/acme/1", "submitted"),
    ]
    assert rows[0].reason
    assert tracker.requests() == []


def test_a_job_system_link_to_no_one_posting_is_failed_before_anything_is_read(monkeypatch):
    site = Pages()
    boards = [
        "https://job-boards.greenhouse.io/arcboatcompany",
        "https://jobs.lever.co/immuta",
        "https://jobs.ashbyhq.com/skydio",
        "https://cvshealth.wd1.myworkdayjobs.com/en-US/CVS_Health_Careers",
    ]

    rows = run(monkeypatch, requests=boards, site=site, fillers=())

    assert [(row.posting_url, row.status) for row in rows] == [(link, "failed") for link in boards]
    assert all("not a link to a job posting" in row.reason.lower() for row in rows)
    assert site.fetched == []


class PastesMidRun(EmptyFormFiller):
    """Lisul pastes a Request while the first Application is being submitted."""

    def __init__(self, tracker: InMemoryTracker, url: str):
        self.tracker, self.url = tracker, url

    def submit(self, page):
        if self.url:
            self.tracker.paste_request(self.url)
            self.url = None


def test_a_request_pasted_during_a_run_goes_ahead_of_the_matches_left(monkeypatch):
    tracker = InMemoryTracker()
    monkeypatch.setitem(FILLERS, "other", PastesMidRun(tracker, "https://jobs.example.com/c/3?utm_source=Simplify"))

    rows = run(
        monkeypatch,
        feed_record(id="a", url="https://jobs.example.com/a/1", date_posted=3_000),
        feed_record(id="b", url="https://jobs.example.com/b/2", date_posted=2_000),
        feed_record(id="c", url="https://jobs.example.com/c/3", date_posted=1_000),
        fillers=(),
        tracker=tracker,
        args=["--workers", "1"],
    )

    assert [row.posting_url for row in rows] == [
        "https://jobs.example.com/a/1", "https://jobs.example.com/c/3?utm_source=Simplify", "https://jobs.example.com/b/2",
    ]
    assert tracker.requests() == []


def test_apply_add_queues_every_link_given_for_the_next_check(monkeypatch, capsys):
    tracker = InMemoryTracker()
    tracker.paste_request("https://jobs.example.com/pasted/1")
    links = ["https://jobs.example.com/a/1", "https://jobs.example.com/b/2", "https://jobs.example.com/c/3"]

    main(["add", *links], adapters=Adapters(
        feed=SimplifyFeed(lambda: b"[]"), tracker=tracker, site=Pages(), claude=FakeClaude(),
        mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(NOW),
    ))

    assert tracker.requests() == ["https://jobs.example.com/pasted/1", *links]
    assert tracker.rows() == []
    assert "3 Requests" in capsys.readouterr().out

    rows = run(monkeypatch, tracker=tracker)
    assert [row.posting_url for row in rows] == ["https://jobs.example.com/pasted/1", *links]


def test_the_five_minute_check_applies_to_waiting_requests_and_no_match(monkeypatch):
    tracker = InMemoryTracker()

    rows = run(monkeypatch, feed_record(id="match"), requests=["https://jobs.example.com/a/1"], tracker=tracker,
               args=["--requests-only"])

    assert [row.posting_url for row in rows] == ["https://jobs.example.com/a/1"]
    assert tracker.requests() == []


def test_a_linkedin_page_that_will_not_load_logged_out_is_still_a_handoff(monkeypatch):
    tracker = InMemoryTracker()

    rows = run(monkeypatch, site=Pages(), tracker=tracker, requests=[
        "https://www.linkedin.com/jobs/view/4467485195", "https://jobs.example.com/a/1",
    ])

    assert [(row.posting_url, row.status) for row in rows] == [
        ("https://www.linkedin.com/jobs/view/4467485195", "handoff"), ("https://jobs.example.com/a/1", "submitted"),
    ]
    assert tracker.requests() == []


def test_an_interrupted_runs_requests_are_resumed_first_and_none_is_submitted_twice(monkeypatch):
    tracker = InMemoryTracker()
    for url, status, reason in [
        ("https://jobs.example.com/queued/1", Status.QUEUED, ""),
        ("https://jobs.example.com/submitting/2", Status.FILLING, "submitting"),
    ]:
        tracker.add(Row(application_id=request_id(url), company="", role="", posting_url=url, job_system="other",
                        status=status, reason=reason))

    run(monkeypatch, feed_record(id="match", url="https://jobs.example.com/match/3"), tracker=tracker, args=["--workers", "1"])

    assert [(row.posting_url, row.status) for row in tracker.rows()] == [
        ("https://jobs.example.com/queued/1", "submitted"),
        ("https://jobs.example.com/submitting/2", "handoff"),
        ("https://jobs.example.com/match/3", "submitted"),
    ]


class CountsReads(InMemoryTracker):
    """Counts reads of the Applications tab: live, each `rows` or `get` reads the whole Sheet."""

    def __init__(self):
        super().__init__()
        self.reads = 0

    def rows(self):
        self.reads += 1
        return super().rows()

    def get(self, application_id):
        self.reads += 1
        return super().get(application_id)


def test_a_run_reads_the_tracker_as_often_for_many_matches_and_requests_as_for_one(monkeypatch):
    def reads(count: int) -> int:
        tracker = CountsReads()
        rows = run(
            monkeypatch,
            *(feed_record(id=f"match {n}", url=f"https://jobs.example.com/m{n}/1", company_name=f"Co {n}") for n in range(count)),
            requests=[f"https://jobs.example.com/r{n}/1" for n in range(count)],
            tracker=tracker,
        )
        assert len(rows) == 2 * count
        return tracker.reads

    assert reads(6) == reads(1)


def test_a_pasted_workday_link_is_named_from_the_feed_by_its_req():
    # Workday's own pages name no company ("2100 NVIDIA USA", live); the Feed lists the req under another career site.
    pasted = ("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/"
              "NVIDIA-2027-Internships--Software-Engineering_JR2023495")
    listed = feed_record(company_name="NVIDIA", title="2027 Internships: Software Engineering",
                         url="https://nvidia.wd5.myworkdayjobs.com/en-US/University/job/NVIDIA-2027-Internships_JR2023495-1")
    site = Pages({LIVE: json.dumps([feed_record(), listed]).encode()})

    posting, result = resolve(pasted, site)

    assert (posting.company, posting.title, posting.url, result) == ("NVIDIA", "2027 Internships: Software Engineering", pasted, None)


def test_a_pasted_workday_link_the_feed_lacks_is_named_by_workdays_job_api():
    # ASML's posting isn't in the Feed; its job API names the legal entity "ASML US, LP. (US30)" (live).
    pasted = ("https://asml.wd3.myworkdayjobs.com/en-US/asmlext1/job/San-Jose-CA-USA/"
              "Internship---Software-Engineer-In-Test--MOD-_J-00354568")
    api = "https://asml.wd3.myworkdayjobs.com/wday/cxs/asml/asmlext1/job/San-Jose-CA-USA/Internship---Software-Engineer-In-Test--MOD-_J-00354568"
    job = {"hiringOrganization": {"name": "ASML US, LP. (US30)"},
           "jobPostingInfo": {"title": "Internship - Software Engineer In Test (MOD)", "location": "San Jose, CA, USA"}}
    site = Pages({LIVE: json.dumps([feed_record()]).encode(), api: json.dumps(job).encode()})

    posting, result = resolve(pasted, site)

    assert (posting.company, posting.title, result) == ("ASML", "Internship - Software Engineer In Test (MOD)", None)
