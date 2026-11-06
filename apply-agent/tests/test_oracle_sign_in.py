"""Seam 1 for Oracle's sign-in: whole `apply run`s on a saved Oracle posting
(real up to its email step; tests/fake_oracle.py), with a fake mailbox. Oracle
has no Filler, so once signed in by plain code (its emailed one-time code,
zero tokens) Claude fill fills the form; FakeClaude's
OracleDriver plays Haiku there."""

import json
import re
import time
from datetime import timedelta

from conftest import FIXTURES, FORMS
from fake_oracle import FakeOracleServer
from fakes import FakeClaude
from test_employer_accounts import NOW, World
from test_matches import feed_record

MACYS_FORM = FORMS / "oracle-macys"
MACYS_URL = "https://ebwh.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/91780"
QUESTIONS = [
    {"label": "First Name", "kind": "text", "required": True, "options": []},
    {"label": "Last Name", "kind": "text", "required": True, "options": []},
    {"label": "Phone Number", "kind": "text", "required": True, "options": []},
    {"label": "Resume", "kind": "file", "required": True, "options": []},
]


def oracle_driver(page, schema: dict, prompt: str, files: list) -> dict:
    """Plays Haiku on the fake Oracle form, already signed in to."""
    if "questions" in schema["properties"]:
        return {"blocked": False, "why": "", "questions": QUESTIONS}
    fields = json.loads(re.search(r"<fields>(.*?)</fields>", prompt, re.DOTALL)[1])
    by_name = {f.name: f for f in files}
    for field in fields:
        if field["answer"] in by_name:
            page.locator("input[type=file]").set_input_files(by_name[field["answer"]])
        else:
            page.get_by_label(field["question"], exact=True).fill(field["answer"])
    return {"blocked": False, "why": "", "submit_button": "Submit",
            "filled": [{"field": f["field"], "shown": [f["answer"]]} for f in fields]}


def macys() -> dict:
    return feed_record(id="macys", company_name="Macy's", title="Software Engineer Intern", url=MACYS_URL)


def run(world: World, server: FakeOracleServer, claude: FakeClaude):
    world.claude = claude
    [row] = world.run(server, macys())
    return row


def test_an_oracle_posting_is_signed_in_to_with_the_code_mailed_to_gmail_then_filled_and_submitted():
    world = World()
    claude = FakeClaude(driver=oracle_driver)

    with FakeOracleServer(MACYS_FORM, mailbox=world.mailbox) as server:
        row = run(world, server, claude)

    assert (row.status, row.job_system) == ("submitted", "oracle")
    assert row.reason.startswith("Claude fill: 2 sessions")  # it drove only once signed in
    [email_step] = server.emails
    assert (email_step["email"], email_step["accepted"], email_step["honeypot"]) == ("test.person@example.com", True, "")
    assert server.tried_codes == server.codes_sent  # the code from Gmail, typed once
    [sent] = server.submissions
    assert sent.application["first-name"] == "Test"
    assert sent.files["resume"] == (FIXTURES / "one-pager.pdf").read_bytes()
    assert world.tracker.employer_accounts() == []  # an emailed code is not an account


def test_a_returning_candidate_confirms_their_last_name_before_the_code():
    world = World()

    with FakeOracleServer(MACYS_FORM, mailbox=world.mailbox, returning=True) as server:
        row = run(world, server, FakeClaude(driver=oracle_driver))

    assert row.status == "submitted"
    assert len(server.tried_codes) == 1


def test_a_first_time_candidate_oracle_asks_no_code_of_goes_straight_to_the_form():
    world = World()

    with FakeOracleServer(MACYS_FORM, mailbox=world.mailbox, verify=None) as server:
        row = run(world, server, FakeClaude(driver=oracle_driver))

    assert row.status == "submitted"
    assert world.mailbox.looks == 0


def test_a_code_sent_by_text_message_is_a_handoff_before_claude_spends_a_token():
    world = World()
    claude = FakeClaude(driver=oracle_driver)

    with FakeOracleServer(MACYS_FORM, mailbox=world.mailbox, verify="sms") as server:
        row = run(world, server, claude)

    assert row.status == "handoff"
    assert "text message" in row.reason
    assert claude.calls == [] and server.submissions == []


def test_a_code_missing_after_about_two_minutes_needs_lisul_and_send_new_code_is_never_clicked():
    world = World()
    claude = FakeClaude(driver=oracle_driver)

    with FakeOracleServer(MACYS_FORM, mailbox=world.mailbox, codes_lost=True) as server:
        row = run(world, server, claude)

    assert row.status == "handoff"
    assert "Type the emailed code: no verification code" in row.reason
    assert server.resends == 0
    assert world.clock.now() - NOW >= timedelta(minutes=2)
    assert server.tried_codes == [] and claude.calls == []


def test_the_cookie_banner_over_the_email_step_is_declined_before_next():
    # American Express's Oracle site (seen live): the banner took the click on Next, and sign-in timed out.
    from playwright.sync_api import sync_playwright

    from apply import oracle

    banner = ('<div class="cookie-consent-modal" style="position:fixed;inset:0;background:#fff">Our Use of Cookies'
              '<button onclick="this.parentElement.style.display=\'none\'">Reject All</button><button>Accept All</button></div>'
              '<button onclick="document.title=\'next\'">Next</button>')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page()
        page.set_content(banner)
        oracle._decline_cookies(page)
        page.get_by_role("button", name="Next").click(timeout=2000)
        assert page.title() == "next"
        browser.close()


def test_a_form_lisul_signed_in_to_himself_is_not_signed_in_to_again():
    """On a pause he signed in himself; Resume finds the form's own email field, which can't be edited (KAN-636)."""
    from playwright.sync_api import sync_playwright

    from apply import oracle

    class NoAccounts:
        @property
        def login(self):
            raise AssertionError("no sign-in on a form already open")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content('<label>Email <input type="email" value="lisul@example.com" readonly></label>'
                         '<button>Next</button>')
        oracle.sign_in(page, NoAccounts(), "Elvitigala", agree_to_terms=True)
        browser.close()


def test_resume_on_a_form_section_goes_on_at_once():
    """JPMorgan (live): Resume on section 4 waited 30 s for an email box or an Apply button, then failed (KAN-680)."""
    from playwright.sync_api import sync_playwright

    from apply import oracle

    class NoAccounts:
        @property
        def login(self):
            raise AssertionError("no sign-in on a form already open")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("**/*", lambda route: route.fulfill(content_type="text/html", body="<h1>More About You</h1><button>Next</button>"))
        page.goto("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/1/apply/section/4")
        began = time.monotonic()
        oracle.sign_in(page, NoAccounts(), "Elvitigala", agree_to_terms=True)
        assert time.monotonic() - began < 5
        browser.close()


def test_oracles_code_is_searched_by_its_senders_not_by_any_code_subject():
    # JPMorgan (live): the code came from workflow.mail.us2.cloud.oracle.com, and an Amazon code
    # mailed meanwhile matched the old subject-only search.
    from apply.oracle import MAIL_SEARCH
    assert "from:(oracle.com OR oraclecloud.com)" in MAIL_SEARCH
    assert 'subject:"confirm your identity"' in MAIL_SEARCH and "subject:(code" not in MAIL_SEARCH
