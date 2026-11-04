"""The Apply window's Accounts tab (KAN-591): each Employer account Apply made, with Copy password and
Open sign-in page. The password stays in Keychain (a fake one here): only the server reads it, for the
clipboard. Needs no browser."""

import json
import urllib.error
import urllib.request
from datetime import date

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
