"""The Accounts tab of the Apply window (KAN-591): each Employer account Apply made, so Lisul can sign in to it
himself later, to check an application's status.

A password lives only in Keychain. It is never in the tab's view, a reply, a log, a Trace or a Record: only
this server reads it, and only to put it on the clipboard. The tab keeps no copy of it, only the clipboard's change
count after its write, to tell whether the clipboard still holds it when its minute is up."""

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
    def put_secret(self, text: str) -> int:
        """Put `text` on the clipboard, marked as a secret; the clipboard's change count after the write."""

    def clear(self, written: int) -> None:
        """Clear the clipboard, if its change count is still `written`."""


# The clipboard managers' markers (nspasteboard.org): Concealed (a password: do not show it) and Transient (do not
# keep it in history). Maccy, Paste, Raycast, Alfred and 1Password skip an item that carries them.
CONCEALED, TRANSIENT = "org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType"
# NSPasteboard through JXA, so Apply needs no new dependency. The secret comes on stdin, never in argv, which `ps`
# shows. argv: the action, the pasteboard's name ("" is the general one), and the change count to clear at.
PASTEBOARD = f"""ObjC.import('AppKit');
function run(argv) {{
  const board = argv[1] ? $.NSPasteboard.pasteboardWithName(argv[1]) : $.NSPasteboard.generalPasteboard;
  if (argv[0] === 'put') {{
    const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
    board.clearContents;
    board.setStringForType(text, $.NSPasteboardTypeString);
    board.setStringForType($(''), '{CONCEALED}');
    board.setStringForType($(''), '{TRANSIENT}');
  }} else if (argv[0] === 'clear' && board.changeCount === Number(argv[2])) {{
    board.clearContents;
  }}
  return String(board.changeCount);
}}"""


def _run(argv: list[str], stdin: str) -> str:
    return subprocess.run(argv, input=stdin, capture_output=True, text=True, check=True).stdout


class MacClipboard:
    """The Mac's clipboard (NSPasteboard), written through `osascript -l JavaScript`. `pasteboard` names another
    pasteboard than the general one (a check that must not touch Lisul's clipboard); `run(argv, stdin)` runs a
    command and gives its stdout (tests pass their own)."""

    def __init__(self, pasteboard: str = "", run: Callable[[list[str], str], str] = _run):
        self._pasteboard = pasteboard
        self._run = run

    def put_secret(self, text: str) -> int:
        return self._call("put", stdin=text)

    def clear(self, written: int) -> None:
        self._call("clear", str(written))

    def _call(self, action: str, *more: str, stdin: str = "") -> int:
        return int(self._run(["osascript", "-l", "JavaScript", "-e", PASTEBOARD, action, self._pasteboard, *more],
                             stdin).strip())


def _later(seconds: float, then: Callable[[], None]) -> None:
    timer = threading.Timer(seconds, then)
    timer.daemon = True
    timer.start()


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
        self._written: int | None = None  # the clipboard's change count after the tab last put a password there

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
            self._written = written = self._clipboard.put_secret(password)
        self._later(CLEAR_AFTER, lambda: self._clear(written))
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

    def _clear(self, written: int | None = None) -> None:
        """Clear the clipboard if it still holds the password the tab wrote at change count `written` (None: the
        last). Anything copied since, a newer password too, changed the count, and stays."""
        with self._lock:
            if self._written is None or written not in (None, self._written):
                return
            self._clipboard.clear(self._written)
            self._written = None

    def _listed(self, site: object) -> EmployerAccount:
        account = next((a for a in self._accounts() if a.site == site), None)
        if account is None:
            raise Refused("Apply made no account there.", 404)
        return account
