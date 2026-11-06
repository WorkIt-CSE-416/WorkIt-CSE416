"""Seam 1 for Claude fill signing in: whole `apply run`s and rehearsals on a
fake careers site with no Filler whose form opens only once signed in
(tests/fake_accounts_site.py), with a fake Keychain and a fake mailbox.
AccountDriver plays Haiku: it says what each account page is, fills its
email and names, and names its button; Apply types the password and the
code from Gmail and clicks."""

import json
import re
from datetime import timedelta

import pytest
from fake_accounts_site import CODE, SEARCH, URL, FakeAccountsSite
from fakes import FakeClaude
from test_employer_accounts import EMAIL, NOW, World
from test_matches import feed_record
from test_rehearse import adapters

from apply import account_pages, captcha, oracle, rehearsal
from apply.keychain import InMemoryKeychain
from apply.profile import ApplicantProfile
from apply.tracker import EmployerAccount

SITE = "jobs.smartrecruiters.com"
QUESTIONS = [
    {"label": "First Name", "kind": "text", "required": True, "options": []},
    {"label": "Last Name", "kind": "text", "required": True, "options": []},
    {"label": "Phone", "kind": "text", "required": True, "options": []},
]


class AccountDriver:
    """Plays Haiku on the fake site. `clicks_itself` makes it click the
    account's button itself, though told not to."""

    def __init__(self, clicks_itself: bool = False, signs_in_itself: bool = False):
        self._clicks_itself = clicks_itself
        self._signs_in_itself = signs_in_itself
        self.prompts: list[str] = []

    def __call__(self, page, schema: dict, prompt: str, files: list) -> dict:
        self.prompts.append(prompt)
        account = json.loads(re.search(r"<account>(.*?)</account>", prompt, re.DOTALL)[1])
        if page.get_by_role("link", name="Apply Now").count():
            page.get_by_role("link", name="Apply Now").click()
            page.wait_for_load_state()
        heading = page.locator("h1").inner_text()
        if page.locator(".g-recaptcha").count():
            return self._said(blocked=True, why="the sign-in page has a reCAPTCHA challenge")
        error = page.locator("[role=alert]").first.inner_text() if page.locator("[role=alert]").count() else ""
        if heading == "Sign in to apply" and account.get("no_account_at"):
            page.get_by_role("link", name="Create an account").click()
            page.wait_for_load_state()
            heading = page.locator("h1").inner_text()
        if heading == "Sign in to apply":
            page.get_by_label("Email").fill(account["email"])
            if self._signs_in_itself:
                page.get_by_role("button", name="Sign In").click()
            return self._said(account_page="sign_in", account_button="Sign In", account_error=error)
        if heading == "Create your account":
            page.get_by_label("Email").fill(account["email"])
            page.get_by_label("First name").fill(account["first_name"])
            page.get_by_label("Last name").fill(account["last_name"])
            if self._clicks_itself:
                page.get_by_role("button", name="Create Account").click()
            return self._said(account_page="sign_up", account_button="Create Account", account_error=error)
        if heading == "Check your email":
            if page.get_by_label("Verification code").count():
                return self._said(account_page="code", account_button="Verify", account_error=error)
            return self._said(account_page="link_sent")
        if "questions" in schema["properties"]:
            return self._said(questions=QUESTIONS)
        fields = json.loads(re.search(r"<fields>(.*?)</fields>", prompt, re.DOTALL)[1])
        for field in fields:
            page.get_by_label(field["question"], exact=True).fill(field["answer"])
        return self._said(submit_button="Submit Application",
                          filled=[{"field": f["field"], "shown": [f["answer"]]} for f in fields])

    @staticmethod
    def _said(**said) -> dict:
        return {"blocked": False, "why": "", "account_page": "none", "account_button": "", "account_error": "",
                "page": "application form", "questions": [], "filled": [], "submit_button": "", "next_button": "",
                "unlisted": [], **said}


def acme(n: int = 0) -> dict:
    return feed_record(id=f"acme-{n}", company_name="Acme", title=f"Software Engineer Intern {n or ''}".strip(),
                       url=URL + (f"?copy={n}" if n else ""))


def run(world: World, server, *records, driver=None):
    world.claude = FakeClaude(driver=driver or AccountDriver())
    return world.run(server, *records, args=["--workers", "1"])


def test_claude_fill_makes_an_account_reads_its_code_from_gmail_and_submits():
    world = World()
    driver = AccountDriver()

    with FakeAccountsSite(world.mailbox, world.keychain) as server:
        [row] = run(world, server, acme(), driver=driver)

    assert (row.status, row.job_system) == ("submitted", "other"), row.reason
    [made] = server.created
    assert (made["email"], made["first"], made["last"]) == (EMAIL, "Test", "Person")
    assert made["password"] == made["confirm"] == made["keychain"] == world.keychain.password(SITE)  # saved first
    assert server.codes_tried == [CODE]  # the code from Gmail, typed once
    assert server.accounts[EMAIL]["verified"]
    assert world.tracker.employer_accounts() == [EmployerAccount("Acme", SITE, EMAIL, NOW.date())]
    [sent] = server.submissions
    assert sent.application["first"] == "Test"
    # The password never reached Claude.
    assert all(world.keychain.password(SITE) not in call["prompt"] + json.dumps(call["schema"])
               for call in world.claude.calls)


def test_a_site_whose_account_apply_made_is_signed_in_to_with_its_keychain_password():
    world = World(InMemoryKeychain({SITE: "Kept-Pa55word!"}))

    with FakeAccountsSite(world.mailbox, world.keychain, accounts={EMAIL: "Kept-Pa55word!"}) as server:
        [row] = run(world, server, acme())

    assert row.status == "submitted", row.reason
    assert server.sign_ins == [(EMAIL, True)] and server.created == []
    assert world.tracker.employer_accounts() == []


def test_a_refused_password_is_a_handoff_and_that_password_is_never_tried_again():
    world = World(InMemoryKeychain({SITE: "Stale-Pa55word!"}))

    with FakeAccountsSite(world.mailbox, world.keychain, accounts={EMAIL: "Changed-Pa55word!"}) as server:
        rows = run(world, server, acme(1), acme(2))

    assert [row.status for row in rows] == ["handoff", "handoff"]
    assert all(f"Sign-in failed at {SITE}" in row.reason for row in rows)
    assert "Incorrect email or password" in rows[0].reason
    assert server.sign_ins == [(EMAIL, False)]  # one try, in all
    assert server.submissions == []


def test_an_account_lisul_made_himself_that_keychain_has_no_password_for_is_a_handoff():
    world = World()

    with FakeAccountsSite(world.mailbox, world.keychain, accounts={EMAIL: "Made-By-Hand1!"}) as server:
        [row] = run(world, server, acme())

    assert row.status == "handoff"
    assert f"{SITE} already has an account for {EMAIL}, and Keychain has no password for it" in row.reason
    assert "security add-generic-password -U -s apply-ats" in row.reason
    assert server.sign_ins == [] and server.accounts[EMAIL]["password"] == "Made-By-Hand1!"
    assert world.tracker.employer_accounts() == []


def test_a_new_account_verified_by_a_mailed_link_is_opened_and_the_application_goes_on():
    world = World()

    with FakeAccountsSite(world.mailbox, world.keychain, mail="link") as server:
        [row] = run(world, server, acme())

    assert row.status == "submitted", row.reason
    assert server.accounts[EMAIL]["verified"]
    assert server.sign_ins == [(EMAIL, True)]  # back at the Posting, with the new password
    assert [a.site for a in world.tracker.employer_accounts()] == [SITE]


def test_a_code_that_never_comes_needs_lisul_and_resend_is_never_clicked():
    world = World()
    world.mailbox.deliver = lambda *a, **k: None  # the mail is lost

    with FakeAccountsSite(world.mailbox, world.keychain) as server:
        [row] = run(world, server, acme())

    assert row.status == "handoff"
    assert "Type the emailed code: no verification code from smartrecruiters.com came within about 10 minutes" in row.reason
    assert server.resends == 0 and world.clock.now() - NOW >= timedelta(minutes=10)
    assert world.keychain.password(SITE) == server.accounts[EMAIL]["password"]
    assert server.submissions == []


def test_claude_clicking_the_accounts_button_itself_is_blocked_and_a_handoff():
    world = World()

    with FakeAccountsSite(world.mailbox, world.keychain) as server:
        [row] = run(world, server, acme(), driver=AccountDriver(clicks_itself=True))

    assert row.status == "handoff"
    assert 'blocked the "Create Account" click' in row.reason
    assert server.created == [] and world.keychain.password(SITE) is None


def test_a_captcha_on_the_sign_in_page_is_a_handoff_with_its_bot_signal():
    world = World()

    with FakeAccountsSite(world.mailbox, world.keychain, captcha=True) as server:
        [row] = run(world, server, acme())

    assert row.status == "handoff" and "reCAPTCHA" in row.reason
    assert row.bot_signals.endswith("captcha")
    assert server.created == []


@pytest.mark.parametrize("signs_in_itself", [False, True])
def test_a_sign_in_page_with_an_invisible_captcha_is_lisuls_and_its_button_is_never_pressed(signs_in_itself):
    # AMD's iCIMS (KAN-703): an invisible hCaptcha runs on the sign-in's button, so neither plain code nor
    # Claude presses it; Lisul signs in himself. Without the captcha the same sign-in goes through (above).
    world = World(InMemoryKeychain({SITE: "Kept-Pa55word!"}))

    with FakeAccountsSite(world.mailbox, world.keychain, accounts={EMAIL: "Kept-Pa55word!"},
                          invisible_captcha=True) as server:
        [row] = run(world, server, acme(), driver=AccountDriver(signs_in_itself=signs_in_itself))

    assert row.status == "handoff"
    assert captcha.SIGN_IN.format(SITE) in row.reason
    assert server.sign_ins == [] and server.submissions == []
    assert not row.bot_signals.endswith("captcha")  # nothing ran the captcha


def test_account_pages_past_their_cap_are_a_handoff(monkeypatch):
    monkeypatch.setattr(account_pages, "MAX_PAGES", 2)
    world = World()

    with FakeAccountsSite(world.mailbox, world.keychain) as server:
        [row] = run(world, server, acme())

    assert row.status == "handoff" and "more than 2 sign-in or account pages" in row.reason
    assert server.submissions == []


def test_a_rehearsal_makes_the_account_reads_the_code_and_stops_unsent(tmp_path):
    world = World()

    with FakeAccountsSite(world.mailbox, world.keychain) as server:
        done = rehearsal.rehearse([URL], adapters(server, FakeClaude(driver=AccountDriver()), keychain=world.keychain,
                                                  mailbox=world.mailbox), ApplicantProfile.load(world.profile), 1,
                                  keep_open=False, out=lambda line: None)

    [done] = done
    assert done.outcome == "ready to submit", done.why
    assert len(server.created) == 1 and server.codes_tried == [CODE]
    assert server.submissions == []


@pytest.mark.parametrize("site, search", [
    ("careers-shure.icims.com", "from:(icims.com)"),
    ("lifeattiktok.com", "from:(lifeattiktok.com OR tiktok.com OR bytedance.com)"),
    ("jobs.jobvite.com", "from:(jobvite.com)"),
    ("career4.successfactors.com", "from:(successfactors.com OR sap.com)"),
    ("acme.taleo.net", "from:(taleo.net OR oracle.com)"),
    ("careers.acme.co.uk", "from:(acme.co.uk)"),
    # JPMorgan's code came from workflow.mail.us2.cloud.oracle.com, American Express's from its own domain (live).
    ("jpmc.fa.oraclecloud.com", oracle.MAIL_SEARCH),
    (SITE, SEARCH),
])
def test_a_sites_code_is_read_only_from_its_own_or_its_job_systems_domain(site, search):
    assert account_pages.mail_search(site) == search
