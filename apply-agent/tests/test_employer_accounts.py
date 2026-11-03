"""Seam 1 for signing in: whole `apply run`s on Workday postings (the fake
Workday of tests/fake_workday.py, real up to sign-in), with a fake mailbox and
a fake Keychain. Employer accounts, verification mail, returning sign-ins,
Sign in with Google, and every Handoff rule."""

import json
import shutil
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml
from conftest import FIXTURES, FORMS
from fake_workday import STEPS, FakeWorkdayServer, Field
from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from test_matches import feed_record

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.keychain import InMemoryKeychain
from apply.notify import RecordingNotifier
from apply.tracker import EmployerAccount, InMemoryTracker

PROFILE = FIXTURES / "planner-profile.yaml"
EMAIL = "test.person@example.com"
CACI_FORM = FORMS / "workday-caci"
CACI_URL = "https://caci.wd1.myworkdayjobs.com/external/job/Florham-Park-NJ-US/Software-Engineering-Intern---Summer-2027_332543"
CACI = "caci.wd1.myworkdayjobs.com"
# Xcel Energy's tenant offers Sign in with Google (and LinkedIn, and email).
XCEL_FORM = FORMS / "workday-xcel"
XCEL_URL = "https://xcelenergy.wd1.myworkdayjobs.com/External/job/Denver-CO-80205/Data-Science-Intern-CO--MN_JR116327-1"
NOW = datetime(2026, 10, 15, 9, 30)


class World:
    """Everything outside Apply that a sign-in touches, kept across runs."""

    def __init__(self, keychain: InMemoryKeychain | None = None):
        # The profile is copied, since a run saves Lisul's Missing fact answers into it.
        self._home = tempfile.TemporaryDirectory()
        home = Path(self._home.name)
        profile = yaml.safe_load(PROFILE.read_text())
        profile["files"]["resume_pdf"] = str(FIXTURES / "one-pager.pdf")
        (home / "profile.yaml").write_text(yaml.safe_dump(profile, sort_keys=False))
        shutil.copy(FIXTURES / "policies.yaml", home / "policies.yaml")
        self.profile = home / "profile.yaml"
        self.clock = FakeClock(NOW)
        self.mailbox = FakeMailbox(self.clock)
        self.keychain = keychain or InMemoryKeychain()
        self.tracker = InMemoryTracker()
        self.notifier = RecordingNotifier()
        self.claude = FakeClaude()

    def run(self, server, *records: dict, requests=(), args=()):
        for url in requests:
            self.tracker.paste_request(url)
        main(["run", "--profile", str(self.profile), *args], adapters=Adapters(
            feed=SimplifyFeed(lambda: json.dumps(list(records)).encode()),
            tracker=self.tracker, site=server, claude=self.claude, mailbox=self.mailbox,
            usage=ScriptedUsage(), clock=self.clock, notifier=self.notifier, keychain=self.keychain,
        ))
        return self.tracker.rows()


def caci(n: int = 0) -> dict:
    """The CACI posting as a Match; n > 0 makes another Posting of the same form."""
    return feed_record(id=f"caci-{n}", company_name="CACI", title=f"Software Engineering Intern {n or ''}".strip(),
                   url=CACI_URL + (f"?copy={n}" if n else ""))


def test_a_workday_match_gets_an_employer_account_with_its_password_in_keychain_and_is_submitted():
    world = World()

    # Workday drops the first Create Account click (seen live): it is clicked again, making one account.
    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, ignored_clicks=1) as server:
        [row] = world.run(server, caci())

    assert (row.status, row.job_system, row.reason) == ("submitted", "workday", "")
    [made] = server.created
    assert made["email"] == EMAIL
    assert made["keychain"] == made["password"] == world.keychain.password(CACI)  # saved before the form was sent
    assert world.tracker.employer_accounts() == [EmployerAccount("CACI", CACI, EMAIL, date(2026, 10, 15))]
    [sent] = server.submissions
    assert sent.application["legalName--firstName"] == "Test"
    assert sent.files["resumeAttachments"] == (FIXTURES / "one-pager.pdf").read_bytes()
    assert world.notifier.sent[-1][1].endswith("1 new Employer account")


def test_a_verification_email_missing_after_about_two_minutes_needs_lisul_and_is_never_resent():
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, verify_email=(CACI,),
                           links_lost=True) as server:
        [row] = world.run(server, caci())

    assert row.status == "handoff"
    assert "no verification email from myworkday.com or otp.workday.com came within about 2 minutes" in row.reason
    assert server.resends == 0
    assert world.clock.now() - NOW >= timedelta(minutes=2)
    # The account exists, so it is listed, and its password is in Keychain.
    assert [a.site for a in world.tracker.employer_accounts()] == [CACI]
    assert world.keychain.password(CACI) == server.account(CACI, EMAIL)["password"]
    assert server.submissions == []


def test_a_sign_in_click_workday_drops_is_clicked_again_with_the_keychain_password():
    world = World(InMemoryKeychain({CACI: "Kept-Pa55word!"}))

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, accounts={(CACI, EMAIL): "Kept-Pa55word!"},
                           ignored_clicks=1) as server:
        [row] = world.run(server, caci())

    assert row.status == "submitted"
    assert server.sign_ins == [(CACI, EMAIL, True)]
    assert server.created == [] and world.tracker.employer_accounts() == []  # no new account


def test_a_failed_password_sign_in_is_a_handoff_and_that_password_is_never_tried_again():
    world = World(InMemoryKeychain({CACI: "Stale-Pa55word!"}))

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, accounts={(CACI, EMAIL): "Changed-Pa55word!"}) as server:
        first = world.run(server, caci(1), caci(2), args=["--workers", "1"])
        later = world.run(server, caci(1), caci(2), caci(3))

    assert [row.status for row in first] == ["handoff", "handoff"]
    assert "Sign-in failed at caci.wd1.myworkdayjobs.com: Workday said: Wrong email address or password" in first[0].reason
    assert "won't try that password again" in first[1].reason
    assert {row.application_id: row.status for row in later}["caci-3"] == "handoff"
    assert server.sign_ins == [(CACI, EMAIL, False)]  # one try, in all
    assert server.submissions == []


def test_an_account_lisul_made_himself_gets_a_new_password_through_gmail_and_is_submitted():
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox,
                           accounts={(CACI, EMAIL): "Made-By-Hand1!"}) as server:
        [row] = world.run(server, caci())

    assert row.status == "submitted", row.reason
    [reset] = server.resets
    assert reset["email"] == EMAIL
    password = world.keychain.password(CACI)
    assert reset["keychain"] == password != "Made-By-Hand1!"  # in Keychain before the reset was asked for
    assert server.account(CACI, EMAIL)["password"] == password
    assert server.created == [] and server.sign_ins == [(CACI, EMAIL, True)]
    assert [a.site for a in world.tracker.employer_accounts()] == [CACI]
    assert len(server.submissions) == 1


def test_without_gmail_an_account_keychain_has_no_password_for_is_a_handoff_and_is_not_reset():
    world = World()
    world.mailbox = FakeMailbox(world.clock, set_up=False)

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox,
                           accounts={(CACI, EMAIL): "Made-By-Hand1!"}) as server:
        [row] = world.run(server, caci())

    assert row.status == "handoff"
    assert f"{CACI} already has an account for {EMAIL}, and Keychain has no password for it" in row.reason
    assert "Gmail isn't set up" in row.reason
    assert server.resets == []
    assert server.sign_ins == [] and world.tracker.employer_accounts() == []


def test_a_reset_link_that_never_comes_is_a_handoff_and_that_password_is_never_tried():
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, links_lost=True,
                           accounts={(CACI, EMAIL): "Made-By-Hand1!"}) as server:
        [row] = world.run(server, caci())

    assert row.status == "handoff"
    assert row.reason.startswith(f"Sign-in failed at {CACI}: the password reset didn't finish")
    assert "no verification email from myworkday.com or otp.workday.com came" in row.reason
    assert len(server.resets) == 1  # asked for once, never again
    assert server.account(CACI, EMAIL)["password"] == "Made-By-Hand1!"
    assert server.sign_ins == [] and server.submissions == []


def xcel() -> dict:
    return feed_record(id="xcel", company_name="Xcel Energy", title="Data Science Intern", url=XCEL_URL)


def test_sign_in_with_google_is_used_where_offered_by_picking_lisuls_account():
    world = World()

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="pick") as server:
        [row] = world.run(server, xcel())

    assert row.status == "submitted"
    assert server.created == [] and server.sign_ins == []
    assert world.tracker.employer_accounts() == []
    assert world.keychain.password("xcelenergy.wd1.myworkdayjobs.com") is None
    [sent] = server.submissions
    assert sent.application["legalName--firstName"] == "Test"


def test_google_asking_for_more_than_an_account_pick_is_a_handoff():
    world = World()

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="password") as server:
        [row] = world.run(server, xcel())

    assert row.status == "handoff"
    assert "Google asked for more than an account pick (a password)" in row.reason
    assert "sign the Worker profiles in to Google again by hand" in row.reason
    assert server.created == [] and server.submissions == []


def test_google_refusing_the_browser_is_needs_sign_in_at_once():
    # Seen live (KLA, 2026-11-03): after the account pick, Google showed "This browser or app may
    # not be secure" on /signin/rejected, and Apply waited there 30 s and failed.
    world = World()

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="rejected") as server:
        started = time.monotonic()
        [row] = world.run(server, xcel())

    assert row.status == "handoff"
    assert row.reason.startswith("Needs sign-in: Google refused Sign in with Google")
    assert time.monotonic() - started < 20  # no wait for a page that never comes
    assert server.created == [] and server.submissions == []


def test_a_missing_fact_on_a_later_workday_step_waits_for_lisul_then_the_next_run_signs_back_in_and_submits():
    question = "Which Workday-only fact would you like to share?"
    steps = [*STEPS[:2], ("Application Questions", [*STEPS[2][1], Field("extra", question, "text", True)]), *STEPS[3:]]
    world = World()
    world.claude = FakeClaude(needs_lisul=[question])  # a one-off question Claude can't answer from his facts

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, steps=steps) as server:
        [held] = world.run(server, caci())
        world.tracker.edit_as_lisul("caci-0", answer="Forty-two")
        [row] = world.run(server, caci())

    assert (held.status, held.missing_fact) == ("missing fact", question)
    assert row.status == "submitted"
    assert len(server.created) == 1  # the account made on the first run
    assert server.sign_ins == [(CACI, EMAIL, True)]  # the second run signed in with its Keychain password
    [sent] = server.submissions
    assert sent.application["extra"] == "Forty-two"


def test_a_slow_return_from_google_is_waited_for():
    # Seen live (Snap, 2026-10-15): a Worker profile that used Sign in with Google before goes straight back,
    # and Workday sat on applyManually?ssoProvider=google for over 20 s before the first step.
    world = World()

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="auto", google_delay=25) as server:
        [row] = world.run(server, xcel())

    assert row.status == "submitted", row.reason
