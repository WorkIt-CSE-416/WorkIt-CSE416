"""The Apply window's Accounts tab (KAN-591): each Employer account Apply made, with Copy password and
Open sign-in page. The password stays in Keychain (a fake one here): only the server reads it, for the
clipboard. Needs no browser."""

import json
import urllib.error
import urllib.request
from datetime import date

import pytest

from apply.accounts_tab import AccountsTab
from apply.dashboard import Dashboard, NoFrames
from apply.keychain import InMemoryKeychain
from apply.tracker import EmployerAccount

ASML = EmployerAccount("ASML", "asml.wd3.myworkdayjobs.com", "lisul@example.com", date(2026, 11, 2))
KLA = EmployerAccount("KLA", "wd5.myworkdaysite.com/kla", "lisul@example.com", date(2026, 11, 3))
PASSWORD = "Fake-Keychain-Pw-7x!Q"  # a made-up password in a fake Keychain: never a real one


def call(board, path, body=None, token=None, origin=None):
    """(status, JSON reply) of one request to the window's server, as the page sends it."""
    headers = {"X-Apply-Token": board.token if token is None else token}
    if origin:
        headers["Origin"] = origin
    data = None if body is None else json.dumps(body).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(board.url + path, data, headers)) as reply:
            return reply.status, reply.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def window(tab):
    return Dashboard(0, NoFrames(), accounts=tab)


def test_the_tab_lists_every_employer_account_apply_made():
    tab = AccountsTab(lambda: [ASML, KLA], InMemoryKeychain({ASML.site: PASSWORD}))
    with window(tab) as board:
        status, body = call(board, "/accounts")

    assert status == 200
    assert [(a["company"], a["site"], a["login"], a["created"]) for a in json.loads(body)["accounts"]] == [
        ("KLA", "wd5.myworkdaysite.com/kla", "lisul@example.com", "2026-11-03"),
        ("ASML", "asml.wd3.myworkdayjobs.com", "lisul@example.com", "2026-11-02"),
    ]  # newest first
    assert PASSWORD not in body


def test_only_the_window_may_list_them():
    tab = AccountsTab(lambda: [ASML], InMemoryKeychain())
    with window(tab) as board:
        assert call(board, "/accounts", token="guessed")[0] == 403
        assert call(board, "/accounts", origin="https://evil.example")[0] == 403


class FakeClipboard:
    """The Mac's clipboard, held in memory."""

    def __init__(self, text: str = "what Lisul copied before"):
        self.text = text

    def write(self, text: str) -> None:
        self.text = text

    def read(self) -> str:
        return self.text


def copying(accounts=(ASML,), passwords=None):
    """A tab over a fake Keychain and clipboard, and the clears it set to run later, as (seconds, clear)."""
    clipboard, later = FakeClipboard(), []
    keychain = InMemoryKeychain({ASML.site: PASSWORD} if passwords is None else passwords)
    tab = AccountsTab(lambda: list(accounts), keychain, clipboard=clipboard, later=lambda s, f: later.append((s, f)))
    return tab, clipboard, later


def test_copy_password_puts_it_on_the_clipboard_and_nowhere_else(capsys):
    tab, clipboard, _ = copying()
    with window(tab) as board:
        status, body = call(board, "/accounts/copy", {"site": ASML.site})
        page = board.page()
        assert clipboard.text == PASSWORD

    assert status == 200
    assert "Paste it within a minute" in json.loads(body)["message"]
    printed = capsys.readouterr()
    for shown in (body, page, printed.out, printed.err):
        assert PASSWORD not in shown


@pytest.mark.parametrize("token, origin", [("guessed", None), (None, "https://evil.example")])
def test_only_the_window_may_copy_a_password(token, origin):
    tab, clipboard, _ = copying()
    with window(tab) as board:
        status, body = call(board, "/accounts/copy", {"site": ASML.site}, token=token, origin=origin)

    assert status == 403
    assert clipboard.text == "what Lisul copied before"
    assert PASSWORD not in body


def test_a_site_apply_did_not_list_is_never_copied():
    # Keychain holds it, yet it is not an Employer account Apply made: the page can't name any Keychain item.
    tab, clipboard, _ = copying(accounts=[KLA], passwords={ASML.site: PASSWORD, KLA.site: "other"})
    with window(tab) as board:
        status, _ = call(board, "/accounts/copy", {"site": ASML.site})

    assert status == 404
    assert clipboard.text == "what Lisul copied before"


def test_an_account_keychain_has_no_password_for_says_so():
    tab, clipboard, _ = copying(passwords={})
    with window(tab) as board:
        status, body = call(board, "/accounts/copy", {"site": ASML.site})

    assert status == 404
    assert "Keychain has no password" in json.loads(body)["error"]
    assert clipboard.text == "what Lisul copied before"


def test_the_clipboard_is_cleared_after_a_minute():
    tab, clipboard, later = copying()
    with window(tab) as board:
        call(board, "/accounts/copy", {"site": ASML.site})
        [(seconds, clear)] = later
        clear()

        assert seconds == 60
        assert clipboard.text == ""


def test_what_lisul_copied_since_stays_on_the_clipboard():
    tab, clipboard, later = copying()
    with window(tab) as board:
        call(board, "/accounts/copy", {"site": ASML.site})
        clipboard.write("a line from his notes")
        later[0][1]()

    assert clipboard.text == "a line from his notes"  # also once the window closed


def test_a_second_copy_gets_its_own_minute():
    tab, clipboard, later = copying()
    with window(tab) as board:
        call(board, "/accounts/copy", {"site": ASML.site})
        call(board, "/accounts/copy", {"site": ASML.site})
        later[0][1]()  # the first copy's minute is up
        assert clipboard.text == PASSWORD
        later[1][1]()
        assert clipboard.text == ""


def test_closing_the_window_clears_a_password_still_on_the_clipboard():
    tab, clipboard, _ = copying()
    with window(tab) as board:
        call(board, "/accounts/copy", {"site": ASML.site})

    assert clipboard.text == ""  # the run ended before the minute was up: its clear would never run
