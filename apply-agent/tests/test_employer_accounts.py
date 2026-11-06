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

import pytest
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
from apply.workday import WorkdayFiller

PROFILE = FIXTURES / "planner-profile.yaml"
EMAIL = "test.person@example.com"
CACI_FORM = FORMS / "workday-caci"
CACI_URL = "https://caci.wd1.myworkdayjobs.com/external/job/Florham-Park-NJ-US/Software-Engineering-Intern---Summer-2027_332543"
CACI = "caci.wd1.myworkdayjobs.com"
# Xcel Energy's tenant offers Sign in with Google (and LinkedIn, and email).
XCEL_FORM = FORMS / "workday-xcel"
XCEL_URL = "https://xcelenergy.wd1.myworkdayjobs.com/External/job/Denver-CO-80205/Data-Science-Intern-CO--MN_JR116327-1"
XCEL = "xcelenergy.wd1.myworkdayjobs.com"
GOOGLE = {"workday_sign_in": "google"}  # policies.yaml: Sign in with Google where the tenant offers it
NOW = datetime(2026, 10, 15, 9, 30)


class World:
    """Everything outside Apply that a sign-in touches, kept across runs."""

    def __init__(self, keychain: InMemoryKeychain | None = None, policies: dict | None = None):
        """`policies` are laid over the test policies."""
        # The profile is copied, since a run saves Lisul's Missing fact answers into it.
        self._home = tempfile.TemporaryDirectory()
        home = Path(self._home.name)
        profile = yaml.safe_load(PROFILE.read_text())
        profile["files"]["resume_pdf"] = str(FIXTURES / "one-pager.pdf")
        (home / "profile.yaml").write_text(yaml.safe_dump(profile, sort_keys=False))
        shutil.copy(FIXTURES / "policies.yaml", home / "policies.yaml")
        if policies:
            with (home / "policies.yaml").open("a") as f:
                f.write(yaml.safe_dump(policies))
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

    assert row.status == "handoff", row.reason
    assert "no verification email from myworkday.com or otp.workday.com came within about 10 minutes" in row.reason
    assert server.resends == 0
    assert world.clock.now() - NOW >= timedelta(minutes=10)
    # The account exists, so it is listed, and its password is in Keychain.
    assert [a.site for a in world.tracker.employer_accounts()] == [CACI]
    assert world.keychain.password(CACI) == server.account(CACI, EMAIL)["password"]
    assert server.submissions == []


def test_a_create_account_workday_answers_with_its_bare_sign_in_view_made_the_account_and_signs_in_with_it():
    world = World()

    # Visa's and Northrop's tenants (live): Workday's answer made the account (a root widget), and its own code
    # then loads the bare Sign In view, with no notice. The new password signs in there.
    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, to_sign_in=True) as server:
        [row] = world.run(server, caci())

    assert (row.status, row.reason) == ("submitted", "")
    [made] = server.created
    assert world.keychain.password(CACI) == made["password"]  # kept, not forgotten
    assert server.sign_ins == [(CACI, EMAIL, True)] and server.resets == []
    assert [a.site for a in world.tracker.employer_accounts()] == [CACI]


def test_create_account_back_at_sign_in_for_an_account_that_exists_resets_its_password_once():
    # ASML (live, 2026-11-03): Lisul had an account; Create Account showed Sign In with no error.
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, exists_quietly=True,
                           accounts={(CACI, EMAIL): "Made-By-Hand1!"}) as server:
        [row] = world.run(server, caci())

    assert row.status == "submitted", row.reason
    [reset] = server.resets
    assert reset["keychain"] == world.keychain.password(CACI) == server.account(CACI, EMAIL)["password"]
    assert len(server.submissions) == 1


def test_a_new_account_workday_sends_to_its_verify_page_is_verified_through_gmail_then_signed_in():
    world = World()

    # Zillow's tenant (live): Create Account goes by way of /login/warning to the bare Sign In view.
    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, verify_email=(CACI,),
                           to_sign_in=True) as server:
        [row] = world.run(server, caci())

    assert (row.status, row.reason) == ("submitted", "")
    assert server.account(CACI, EMAIL)["verified"]
    assert server.sign_ins == [(CACI, EMAIL, True)]  # only once verified
    assert server.resends == 0


def test_a_sign_in_to_an_account_not_verified_yet_needs_lisul_and_is_no_failed_password():
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, verify_email=(CACI,),
                           to_sign_in=True, links_lost=True) as server:
        world.run(server, caci())  # the link never comes
        row = {row.application_id: row for row in world.run(server, caci(1))}["caci-1"]

    assert row.status == "handoff", row.reason
    assert "has not been verified" in row.reason and "Verify the account" in row.reason
    assert "won't try that password again" not in row.reason
    assert server.sign_ins == [(CACI, EMAIL, True)] and server.resends == 0


def test_an_account_an_earlier_run_made_is_verified_through_the_link_gmail_still_has():
    world = World(InMemoryKeychain({CACI: "Kept-Pa55word!"}))

    # Zillow's (live): an earlier run made the account, and its link came, but it was never opened.
    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox,
                           accounts={(CACI, EMAIL): "Kept-Pa55word!"}) as server:
        server.account(CACI, EMAIL)["verified"] = False
        server._send_link(CACI, EMAIL)
        world.clock.sleep_until(NOW + timedelta(hours=10))
        [row] = world.run(server, caci())

    assert (row.status, row.reason) == ("submitted", "")
    assert server.account(CACI, EMAIL)["verified"]
    assert server.sign_ins == [(CACI, EMAIL, True), (CACI, EMAIL, True)]  # refused unverified, then in
    assert server.resends == 0 and server.created == []


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


def test_an_already_exists_that_only_workdays_answer_says_is_read_from_it(monkeypatch):
    # Workday's answer to Create Account carries its refusal ({"type": "ERROR", "message": ...}), which a
    # tenant's page may never show: Apply reads it there, and resets the password as for a shown one.
    monkeypatch.setattr(WorkdayFiller, "_may_exist", lambda *a: pytest.fail("the answer's refusal went unread"))
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, hides_errors=True,
                           accounts={(CACI, EMAIL): "Made-By-Hand1!"}) as server:
        [row] = world.run(server, caci())

    assert row.status == "submitted", row.reason
    assert len(server.resets) == 1 and server.created == []


def test_without_gmail_an_account_keychain_has_no_password_for_is_a_handoff_and_is_not_reset():
    world = World()
    world.mailbox = FakeMailbox(world.clock, set_up=False)

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox,
                           accounts={(CACI, EMAIL): "Made-By-Hand1!"}) as server:
        [row] = world.run(server, caci())

    assert row.status == "handoff", row.reason
    assert f"{CACI} already has an account for {EMAIL}, and Keychain has no password for it" in row.reason
    assert "Gmail isn't set up" in row.reason
    assert server.resets == []
    assert server.sign_ins == [] and world.tracker.employer_accounts() == []


def test_a_reset_link_that_never_comes_is_a_handoff_and_that_password_is_never_tried():
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, links_lost=True,
                           accounts={(CACI, EMAIL): "Made-By-Hand1!"}) as server:
        [row] = world.run(server, caci())

    assert row.status == "handoff", row.reason
    assert row.reason.startswith(f"Sign-in failed at {CACI}: the password reset didn't finish")
    assert "no verification email from myworkday.com or otp.workday.com came" in row.reason
    assert len(server.resets) == 1  # asked for once, never again
    assert server.account(CACI, EMAIL)["password"] == "Made-By-Hand1!"
    assert server.sign_ins == [] and server.submissions == []


def xcel() -> dict:
    return feed_record(id="xcel", company_name="Xcel Energy", title="Data Science Intern", url=XCEL_URL)


def test_by_default_a_tenant_that_offers_google_gets_an_employer_account_by_email():
    # Seen live (ASML, KLA, 2026-11-03): Google asked for a passkey after the account pick. So Apply makes
    # the account with email and password, and reads its verification link from Gmail once.
    world = World()

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, mailbox=world.mailbox, google="passkey",
                           verify_email=(XCEL,)) as server:
        [row] = world.run(server, xcel())

    assert row.status == "submitted", row.reason
    [made] = server.created
    assert made["email"] == EMAIL and made["keychain"] == made["password"] == world.keychain.password(XCEL)
    assert server.resends == 0
    assert [a.site for a in world.tracker.employer_accounts()] == [XCEL]
    assert len(server.submissions) == 1


def test_an_account_made_with_google_is_needs_sign_in_and_its_password_is_never_reset():
    world = World()  # Keychain has no password for the tenant: Lisul made the account with Google

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, mailbox=world.mailbox,
                           accounts={(XCEL, EMAIL): "Made-With-Google1!"}) as server:
        [row] = world.run(server, xcel())

    assert row.status == "handoff", row.reason
    assert row.reason.startswith("Needs sign-in: Xcel Energy's Workday account was made with Google; "
                                 "sign in once yourself, or reset its password"), row.reason
    assert server.resets == [] and server.sign_ins == []  # never Forgot your password?, which mails Lisul
    assert world.keychain.password(XCEL) is None and world.tracker.employer_accounts() == []
    assert server.submissions == []


def test_sign_in_with_google_is_used_where_offered_by_picking_lisuls_account():
    world = World(policies=GOOGLE)

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="pick") as server:
        [row] = world.run(server, xcel())

    assert row.status == "submitted"
    assert server.created == [] and server.sign_ins == []
    assert world.tracker.employer_accounts() == []
    assert world.keychain.password("xcelenergy.wd1.myworkdayjobs.com") is None
    [sent] = server.submissions
    assert sent.application["legalName--firstName"] == "Test"


def test_google_asking_for_more_than_an_account_pick_is_a_handoff():
    world = World(policies=GOOGLE)

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="password") as server:
        [row] = world.run(server, xcel())

    assert row.status == "handoff", row.reason
    assert "Google asked for more than an account pick (a password)" in row.reason
    assert "sign the Worker profiles in to Google again by hand" in row.reason
    assert server.created == [] and server.submissions == []


def test_google_asking_for_a_passkey_is_a_handoff_at_once():
    # Seen live (KLA, 2026-11-03): after the account pick, Google asked for a passkey, a page with
    # no box to type in, and Apply waited there 30 s and failed.
    world = World(policies=GOOGLE)

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="passkey") as server:
        started = time.monotonic()
        [row] = world.run(server, xcel())

    assert row.status == "handoff", row.reason
    assert "Google asked for more than an account pick (a passkey)" in row.reason
    assert time.monotonic() - started < 20
    assert server.created == [] and server.submissions == []


def test_google_refusing_the_browser_is_needs_sign_in_at_once():
    # Seen live (KLA, 2026-11-03): after the account pick, Google showed "This browser or app may
    # not be secure" on /signin/rejected, and Apply waited there 30 s and failed.
    world = World(policies=GOOGLE)

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="rejected") as server:
        started = time.monotonic()
        [row] = world.run(server, xcel())

    assert row.status == "handoff", row.reason
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
    world = World(policies=GOOGLE)

    with FakeWorkdayServer(XCEL_FORM, keychain=world.keychain, google="auto", google_delay=25) as server:
        [row] = world.run(server, xcel())

    assert row.status == "submitted", row.reason
