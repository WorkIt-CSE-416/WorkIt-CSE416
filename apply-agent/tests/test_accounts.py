"""Accounts: resetting the password of an Employer account Lisul made himself,
which Keychain has none for. With a fake Keychain and a fake mailbox."""

from datetime import datetime, timedelta

import pytest
from fakes import FakeClock, FakeMailbox

from apply.accounts import MAIL_WAIT, Accounts
from apply.keychain import InMemoryKeychain
from apply.model import Handoff

SITE = "caci.wd1.myworkdayjobs.com"
EMAIL = "test.person@example.com"
NOW = datetime(2026, 10, 15, 9, 30)


def test_a_reset_password_is_in_keychain_before_the_site_is_asked_for_the_reset():
    keychain = InMemoryKeychain()
    accounts = Accounts(keychain, FakeMailbox(), FakeClock(NOW), EMAIL, "CACI")

    password = accounts.reset_password(SITE)

    assert keychain.password(SITE) == password
    assert len(password) >= 12


def test_without_gmail_a_code_is_never_waited_for_and_the_handoff_needs_sign_in_saying_why():
    mailbox = FakeMailbox(set_up=False)
    accounts = Accounts(InMemoryKeychain(), mailbox, FakeClock(NOW), EMAIL, "CACI")

    with pytest.raises(Handoff) as handoff:
        accounts.code("from:(icims.com)", NOW)
    assert str(handoff.value) == ("Needs sign-in: Gmail isn't set up for Apply: no Gmail app password in Keychain, "
                                  "so the verification code can't be read.")
    assert mailbox.looks == 0


def test_without_gmail_no_password_is_reset_and_the_handoff_says_why():
    keychain = InMemoryKeychain()
    accounts = Accounts(keychain, FakeMailbox(set_up=False), FakeClock(NOW), EMAIL, "CACI")

    with pytest.raises(Handoff) as handoff:
        accounts.reset_password(SITE)
    assert str(handoff.value).startswith(
        f"{SITE} already has an account for {EMAIL}, and Keychain has no password for it. "
        "Apply resets its password through Gmail, but Gmail isn't set up"
    )
    assert keychain.password(SITE) is None


def test_a_code_that_never_comes_is_waited_for_about_10_minutes_once_then_needs_lisul():
    # American Express on Oracle (live): Apply asked for a new code after a wait. It never asks again now.
    mailbox = FakeMailbox()
    clock = FakeClock(NOW)
    accounts = Accounts(InMemoryKeychain(), mailbox, clock, EMAIL, "CACI")

    with pytest.raises(Handoff) as handoff:
        accounts.code("from:(icims.com)", NOW)

    assert str(handoff.value).startswith("Needs sign-in: Type the emailed code: no verification code from icims.com")
    assert clock.now() - NOW >= MAIL_WAIT >= timedelta(minutes=10)
    assert "came within about 10 minutes" in str(handoff.value)


def test_a_code_that_comes_after_minutes_is_still_read():
    # JPMorgan on Oracle (live): the mail took about 2.5 minutes, past the old 2-minute wait.
    mailbox = FakeMailbox()

    def mail_comes_late():
        if clock.now() - NOW >= timedelta(minutes=9, seconds=30):
            mailbox.deliver("from:(icims.com)", code="482913")

    clock = FakeClock(NOW, on_sleep=mail_comes_late)
    accounts = Accounts(InMemoryKeychain(), mailbox, clock, EMAIL, "CACI")

    assert accounts.code("from:(icims.com)", NOW) == "482913"
