"""The Apply window's Accounts tab (KAN-591): each Employer account Apply made, with Copy password and
Open sign-in page. The password stays in Keychain (a fake one here): only the server reads it, for the
clipboard. Needs no browser."""

import json
import urllib.error
import urllib.request
from datetime import date
from types import SimpleNamespace

import pytest

from apply.accounts_tab import CONCEALED, TRANSIENT, AccountsTab, MacClipboard
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
    """The Mac's clipboard, held in memory, with its change count."""

    def __init__(self, text: str = "what Lisul copied before"):
        self.text, self.count = text, 0

    def write(self, text: str) -> None:  # Lisul copies something
        self.text, self.count = text, self.count + 1

    def put_secret(self, text: str) -> int:
        self.write(text)
        return self.count

    def clear(self, written: int) -> None:
        if self.count == written:
            self.write("")


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


ASML_POSTING = "https://asml.wd3.myworkdayjobs.com/en-US/ASMLExternal/job/US-Wilton/Intern_R12345"
KLA_POSTING = "https://wd5.myworkdaysite.com/recruiting/kla/Search/job/Milpitas/Intern_R1"


def opening(rows):
    opened = []
    tab = AccountsTab(lambda: [ASML, KLA], InMemoryKeychain(), rows=lambda: rows, everyday=opened.append)
    return tab, opened


def test_open_sign_in_page_opens_the_accounts_posting_in_lisuls_own_chrome():
    # Workday's job page has Sign In in its header; the tenant alone names no site path.
    rows = [SimpleNamespace(posting_url="https://boards.greenhouse.io/stripe/jobs/1"),
            SimpleNamespace(posting_url=KLA_POSTING), SimpleNamespace(posting_url=ASML_POSTING)]
    tab, opened = opening(rows)
    with window(tab) as board:
        status, body = call(board, "/accounts/open", {"site": ASML.site})
        call(board, "/accounts/open", {"site": KLA.site})

    assert status == 200
    assert "your Chrome" in json.loads(body)["message"]
    assert opened == [ASML_POSTING, KLA_POSTING]


def test_an_account_with_no_posting_in_the_tracker_opens_its_site():
    tab, opened = opening([])
    with window(tab) as board:
        call(board, "/accounts/open", {"site": KLA.site})

    assert opened == ["https://wd5.myworkdaysite.com/"]


def test_only_the_window_may_open_a_sign_in_page_and_only_for_a_listed_account():
    tab, opened = opening([SimpleNamespace(posting_url=ASML_POSTING)])
    with window(tab) as board:
        assert call(board, "/accounts/open", {"site": ASML.site}, token="guessed")[0] == 403
        assert call(board, "/accounts/open", {"site": ASML.site}, origin="https://evil.example")[0] == 403
        assert call(board, "/accounts/open", {"site": "evil.example"})[0] == 404

    assert opened == []


def test_the_mac_clipboard_gets_the_password_on_stdin_marked_for_clipboard_managers_to_skip():
    ran = []

    def run(argv, stdin):
        ran.append((argv, stdin))
        return "7\n"

    clipboard = MacClipboard(run=run)
    written = clipboard.put_secret(PASSWORD)
    clipboard.clear(written)

    (put, given), (clear, _) = ran
    assert written == 7
    assert given == PASSWORD
    assert not any(PASSWORD in arg for argv, _ in ran for arg in argv)  # argv shows in `ps`
    assert put[:3] == ["osascript", "-l", "JavaScript"]
    script = put[put.index("-e") + 1]
    for marked in ("NSPasteboardTypeString", CONCEALED, TRANSIENT):
        assert marked in script
    assert (CONCEALED, TRANSIENT) == ("org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType")
    assert clear[-2:] == ["", "7"]  # clears only at the change count it wrote
