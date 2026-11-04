"""The Accounts tab of the Apply window (KAN-591): each Employer account Apply made, so Lisul can sign in to it
himself later, to check an application's status.

A password lives only in Keychain. It is never in the tab's view, a reply, a log, a Trace or a Record: only
this server reads it, and only to put it on the clipboard. The tab keeps no copy of it, only its hash, to tell
whether the clipboard still holds it when its minute is up."""

import hashlib
import hmac
import subprocess
import threading
from collections.abc import Callable
from typing import Protocol
from urllib.parse import urlsplit

from apply import captcha, fill_engine
from apply.adapters import Keychain
from apply.answers_tab import Refused
from apply.tracker import EmployerAccount

CLEAR_AFTER = 60.0  # s a copied password stays on the clipboard


class Clipboard(Protocol):
    def write(self, text: str) -> None: ...

    def read(self) -> str: ...


class MacClipboard:
    """The Mac's clipboard, through pbcopy and pbpaste. The text goes through stdin, never an argument, so it is
    not in the process list."""

    def write(self, text: str) -> None:
        subprocess.run(["pbcopy"], input=text, text=True, check=True)

    def read(self) -> str:
        return subprocess.run(["pbpaste"], capture_output=True, text=True, check=False).stdout


def _later(seconds: float, then: Callable[[], None]) -> None:
    timer = threading.Timer(seconds, then)
    timer.daemon = True
    timer.start()


def _digest(text: str) -> bytes:
    return hashlib.sha256(text.encode()).digest()


class AccountsTab:
    """`accounts` reads the Tracker's Employer accounts list; `keychain` holds their passwords; `rows` reads the
    Tracker's rows, for each account's Posting link. `everyday` opens a link in Lisul's everyday Chrome.
    `later(seconds, then)` runs `then` once that many seconds are up (tests pass their own)."""

    def __init__(self, accounts: Callable[[], list[EmployerAccount]], keychain: Keychain,
                 rows: Callable[[], list] = list, everyday: Callable[[str], None] = captcha.to_everyday_chrome,
                 clipboard: Clipboard | None = None, later: Callable[[float, Callable[[], None]], None] = _later):
        self._accounts = accounts
        self._keychain = keychain
        self._rows = rows
        self._everyday = everyday
        self._clipboard = clipboard or MacClipboard()
        self._later = later
        self._lock = threading.Lock()
        self._copied: bytes | None = None  # the hash of the password the tab last put on the clipboard
        self._copies = 0

    def view(self) -> dict:
        """Each account, newest first, with no password."""
        listed = sorted(self._accounts(), key=lambda a: a.created, reverse=True)
        return {"accounts": [{"company": a.company, "site": a.site, "login": a.login, "created": a.created.isoformat()}
                             for a in listed]}

    def copy(self, site: object) -> str:
        """Put the password of the listed account at `site` on the clipboard, for a minute. Only a site in the
        Employer accounts list is read: the page cannot name any other Keychain item."""
        account = self._listed(site)
        try:
            password = self._keychain.password(account.site)
        except RuntimeError:  # Keychain is locked, or Lisul denied it
            raise Refused("Keychain did not give Apply the password. Unlock Keychain and try again.", 502) from None
        if not password:
            raise Refused(f"Keychain has no password for {account.site}. Apply made no password for it, "
                          "or it was made with Google.", 404)
        with self._lock:
            self._clipboard.write(password)
            self._copied, self._copies = _digest(password), self._copies + 1
            copy = self._copies
        self._later(CLEAR_AFTER, lambda: self._clear(copy))
        return f"Copied the password for {account.company or account.site}. Paste it within a minute: " \
               "then Apply clears the clipboard."

    def open_sign_in(self, site: object) -> str:
        """Open the listed account's sign-in in Lisul's everyday Chrome (`open`, never over DevTools): the newest
        Posting of its site in the Tracker, whose page has Sign In in its header, else the site's home."""
        account = self._listed(site)
        host = account.site.partition("/")[0]
        postings = [str(row.posting_url) for row in self._rows() if urlsplit(str(row.posting_url)).hostname == host]
        if "/" in account.site:  # a myworkdaysite.com tenant: host/<site>, as the engine names it
            postings = [url for url in postings if (fill_engine.job_of(url) or {}).get("tenant") == account.site]
        self._everyday(postings[-1] if postings else f"https://{host}/")
        return f"Opened {account.company or account.site} in your Chrome: press Sign In there, and paste the password."

    def close(self) -> None:
        """The window is closing: a password still on the clipboard goes now, as its clear would never run."""
        self._clear()

    def _clear(self, copy: int | None = None) -> None:
        """Clear the clipboard if it still holds the password copy `copy` (None: the last) put there. Anything
        Lisul copied since stays."""
        with self._lock:
            if self._copied is None or copy not in (None, self._copies):
                return
            if hmac.compare_digest(_digest(self._clipboard.read()), self._copied):
                self._clipboard.write("")
            self._copied = None

    def _listed(self, site: object) -> EmployerAccount:
        account = next((a for a in self._accounts() if a.site == site), None)
        if account is None:
            raise Refused("Apply made no account there.", 404)
        return account
