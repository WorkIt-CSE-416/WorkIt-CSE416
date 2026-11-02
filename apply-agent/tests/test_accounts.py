"""Accounts: resetting the password of an Employer account Lisul made himself,
which Keychain has none for. With a fake Keychain and a fake mailbox."""

from datetime import datetime

import pytest

from apply.accounts import Accounts
from apply.keychain import InMemoryKeychain
from apply.model import Handoff

from fakes import FakeClock, FakeMailbox

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
        accounts.code("from:(icims.com)", NOW, lambda: pytest.fail("asked for the code again"))
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
