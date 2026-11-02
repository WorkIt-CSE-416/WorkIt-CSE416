"""Known sign-in walls (TikTok, ByteDance, iCIMS): without Gmail set up, a
Posting behind one is a Handoff before any Claude call, unless Lisul signed
the Worker profiles in to that site with `apply sign-in`, and then it fills
as usual. With Gmail, Claude fill goes on and signs in there."""

import json
from contextlib import contextmanager
from datetime import datetime

from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from playwright.sync_api import sync_playwright
from test_matches import feed_record
from test_run_answers import profile_with

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.tracker import InMemoryTracker, Row

TIKTOK = "https://lifeattiktok.com/search/7668642761473902901"


class PagesSite:
    """A JobSite serving the given HTML at each URL. Every other request fails,
    so nothing reaches a live site; `opened` lists every page opened."""

    def __init__(self, pages: dict[str, str] | None = None):
        self._pages = pages or {}
        self.opened: list[str] = []

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        raise LookupError(f"nothing saved at {url}")

    @contextmanager
    def open(self, url: str, worker: int = 0):
        self.opened.append(url)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context()
            context.route("**/*", lambda route: route.fulfill(content_type="text/html", body=self._pages[route.request.url])
                          if route.request.url in self._pages else route.abort())
            try:
                page = context.new_page()
                page.goto(url)
                yield page
            finally:
                browser.close()


def closed_posting(page, schema, prompt, files) -> dict:
    """Plays Haiku reading a page that says the Posting is closed."""
    return {"page": "closed posting", "why": "the role is filled", "questions": [], "blocked": False}


def run(tmp_path, site, *records: dict, claude: FakeClaude, signed_in=frozenset(), gmail=False) -> list[Row]:
    tracker = InMemoryTracker()
    main(
        ["run", "--profile", str(profile_with(tmp_path))],
        adapters=Adapters(
            feed=SimplifyFeed(lambda: json.dumps(list(records)).encode()),
            tracker=tracker,
            site=site,
            claude=claude,
            mailbox=FakeMailbox(set_up=gmail),
            usage=ScriptedUsage(),
            clock=FakeClock(datetime(2026, 10, 15, 9, 30)),
            signed_in=signed_in,
        ),
    )
    return tracker.rows()


def test_a_tiktok_match_is_a_handoff_before_any_claude_call(tmp_path):
    site, claude = PagesSite(), FakeClaude(driver=closed_posting)

    [row] = run(tmp_path, site, feed_record(id="tiktok", company_name="TikTok", url=TIKTOK), claude=claude)

    assert row.status == "handoff"
    assert "TikTok" in row.reason and f"apply sign-in {TIKTOK}" in row.reason
    assert "Gmail isn't set up" in row.reason
    assert claude.calls == [] and site.opened == []


def test_with_gmail_set_up_claude_fill_goes_on_behind_a_wall_to_sign_in_there(tmp_path):
    site = PagesSite({TIKTOK: "<h1>Software Engineer Intern</h1><p>This role is filled.</p>"})
    claude = FakeClaude(driver=closed_posting)

    [row] = run(tmp_path, site, feed_record(id="tiktok", company_name="TikTok", url=TIKTOK), claude=claude, gmail=True)

    assert site.opened == [TIKTOK] and len(claude.calls) == 1
    assert row.status == "closed"


def test_a_tiktok_match_fills_as_usual_once_lisul_signed_in_to_tiktok(tmp_path):
    site = PagesSite({TIKTOK: "<h1>Software Engineer Intern</h1><p>This role is filled.</p>"})
    claude = FakeClaude(driver=closed_posting)

    [row] = run(tmp_path, site, feed_record(id="tiktok", company_name="TikTok", url=TIKTOK), claude=claude,
                signed_in=frozenset({"lifeattiktok.com"}))

    assert site.opened == [TIKTOK] and len(claude.calls) == 1  # Claude fill read the page
    assert row.status == "closed"


def test_each_icims_employer_needs_its_own_sign_in(tmp_path):
    shure = "https://careersus-shure.icims.com/jobs/1234/software-intern/job"
    claude = FakeClaude(driver=closed_posting)

    [row] = run(tmp_path, PagesSite(), feed_record(id="shure", url=shure), claude=claude,
                signed_in=frozenset({"careers-peraton.icims.com"}))

    assert row.status == "handoff"
    assert "iCIMS account at careersus-shure.icims.com" in row.reason
    assert claude.calls == []


AMD = "https://careers.amd.com/jobs/91170?icims=1"
AMD_ICIMS = "https://careers-amd.icims.com/jobs/91170/login"
AMD_PAGE = (f'<h1>Software Intern</h1><p>Build GPUs.</p><a href="/jobs">All jobs</a>'
            f'<a class="btn" href="{AMD_ICIMS}">Apply Now</a>')


def test_a_posting_whose_apply_link_leads_to_a_sign_in_wall_is_a_handoff_before_any_claude_call(tmp_path):
    site, claude = PagesSite({AMD: AMD_PAGE}), FakeClaude(driver=closed_posting)

    [row] = run(tmp_path, site, feed_record(id="amd", company_name="AMD", url=AMD), claude=claude)

    assert row.status == "handoff"
    assert "iCIMS account at careers-amd.icims.com" in row.reason and f"apply sign-in {AMD_ICIMS}" in row.reason
    assert claude.calls == []


def test_a_posting_that_lands_on_a_sign_in_wall_is_a_handoff_before_any_claude_call(tmp_path):
    redirect = '<script>location.replace("https://careers-amd.icims.com/jobs/91170/login")</script>'
    site = PagesSite({AMD: redirect, AMD_ICIMS: "<h1>Login | GDPR</h1>"})
    claude = FakeClaude(driver=closed_posting)

    [row] = run(tmp_path, site, feed_record(id="amd", company_name="AMD", url=AMD), claude=claude)

    assert row.status == "handoff" and "careers-amd.icims.com" in row.reason
    assert claude.calls == []


def test_the_apply_link_to_a_signed_in_site_fills_as_usual(tmp_path):
    site, claude = PagesSite({AMD: AMD_PAGE}), FakeClaude(driver=closed_posting)

    [row] = run(tmp_path, site, feed_record(id="amd", company_name="AMD", url=AMD), claude=claude,
                signed_in=frozenset({"careers-amd.icims.com"}))

    assert row.status == "closed" and len(claude.calls) == 1
