"""The Accounts tab of the Apply window (KAN-591): each Employer account Apply made, so Lisul can sign in to it
himself later, to check an application's status.

A password lives only in Keychain. It is never in the tab's view, a reply, a log, a Trace or a Record: only
this server reads it, and only to put it on the clipboard."""

from collections.abc import Callable

from apply.adapters import Keychain
from apply.tracker import EmployerAccount


class AccountsTab:
    """`accounts` reads the Tracker's Employer accounts list; `keychain` holds their passwords."""

    def __init__(self, accounts: Callable[[], list[EmployerAccount]], keychain: Keychain):
        self._accounts = accounts
        self._keychain = keychain

    def view(self) -> dict:
        """Each account, newest first, with no password."""
        listed = sorted(self._accounts(), key=lambda a: a.created, reverse=True)
        return {"accounts": [{"company": a.company, "site": a.site, "login": a.login, "created": a.created.isoformat()}
                             for a in listed]}
