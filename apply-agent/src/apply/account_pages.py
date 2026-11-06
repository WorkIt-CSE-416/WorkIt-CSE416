"""Employer accounts on the pages Claude fill drives: a sign-in, create-account
or verification page in the way of the form, with no Sign in with Google.

Claude only says what the page is, fills its fields that aren't secret (the
email, names, phone) and names its button; plain code does the rest, so no
password ever reaches Claude, in a prompt, a schema or a file:

- it types the site's password into every password box on the page (the
  password and its confirmation): the Keychain one, or for a new account a new
  one, saved to Keychain before the button is clicked;
- it clicks the button Claude named, never one whose words send the
  application, with the drive guard letting that one click through;
- it reads an emailed code or link from Gmail, only from the site's own
  domain or its job system's (on Oracle, by its subject: see mail_search; another Worker may be making an account at the
  same moment, so one Worker at a time waits on each sender's mail), types
  the code or opens the link, and goes back to the Posting.

A refused password is a Handoff no Application tries again, and so is an
account the site already has that Keychain has no password for, a refused
code, a captcha, and more than MAX_PAGES account pages in one Application.
A page that carries a captcha, an invisible one too (captcha.CARRIED), is a
Handoff before anything is typed or clicked: its button runs the captcha, so
Lisul signs in himself (AMD's iCIMS email step, KAN-703).

A reopened form (`apply reopen`, KAN-720, `Accounts.hands_off`) types nothing into an account page:
Claude is told to fill nothing there, a page that shows a password box is a Handoff before Claude
drives it (`hands_off`), and any account page Claude names is a Handoff (accounts.HANDS_OFF) before
plain code types or clicks.
"""

import json
import re
import threading
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from playwright.sync_api import Page

from apply import captcha
from apply.accounts import HANDS_OFF, NO_PASSWORD, Accounts
from apply.model import Handoff
from apply.oracle import MAIL_SEARCH as ORACLE_MAIL_SEARCH

PAGES = ["none", "sign_in", "sign_up", "code", "link_sent"]
MAX_PAGES = 4  # account pages in one Application, so a sign-in can't loop
SETTLES_MS = 10_000
# The button that sends the application (claude_fill.SENDS): never the account's.
SENDS = re.compile(r"\b(submit|send|apply|finish|complete|confirm)\b", re.IGNORECASE)
ALREADY = re.compile(r"\balready\b|\bexists?\b|\bin use\b|\bregistered\b", re.IGNORECASE)
# Where each job system mails its codes and links from, besides the site's own domain.
JOB_SYSTEM_MAIL = {
    "icims.com": ("icims.com",),
    "lifeattiktok.com": ("tiktok.com", "bytedance.com"),
    "tiktok.com": ("tiktok.com", "bytedance.com"),
    "bytedance.com": ("bytedance.com", "tiktok.com"),
    "jobvite.com": ("jobvite.com",),
    "smartrecruiters.com": ("smartrecruiters.com",),
    "successfactors.com": ("successfactors.com", "sap.com"),
    "successfactors.eu": ("successfactors.eu", "successfactors.com", "sap.com"),
    "taleo.net": ("taleo.net", "oracle.com"),
}
# A code's own box, else the page's one visible text box.
CODE_BOX = ("input[autocomplete=one-time-code], input[name*=code i], input[id*=code i], input[aria-label*=code i], "
            "input[placeholder*=code i], input[name*=otp i], input[id*=otp i]")
TEXT_BOX = "input[type=text], input[type=number], input[type=tel], input:not([type])"

PROMPT = """If a sign-in, create-account or verification page is in the way of the form and it offers no "Sign in with Google", it is an account page: don't stop as blocked for it.
On an account page, fill only the fields that aren't secret from <account> (email, names, phone), and tick a box agreeing to the site's terms or privacy policy only if <account> says agree_to_terms. Leave every password and code box empty, and never click the button that signs in, creates the account or verifies a code: name it exactly in `account_button`.
Say which page it is in `account_page`: sign_in (an email and password to sign in with), sign_up (a form that creates an account), code (a box for a code that was emailed), link_sent (it says a link was emailed to open); any error it shows about the account or code goes in `account_error`. If <account> names a site Apply has no account at yet and you are on its sign-in page, first open its page that creates one ("Create account", "Register", "Sign up").
On any other page `account_page` is none and `account_button` and `account_error` are empty."""
FIELDS = {
    "account_page": {"type": "string", "enum": PAGES, "description": "the account page in the way of the form; none if no such page"},
    "account_button": {"type": "string", "description": "the button that signs in, creates the account or verifies the code"},
    "account_error": {"type": "string", "description": "an error the account page shows; empty if none"},
}


@dataclass
class _Click:
    page: str  # what Claude said the page was
    site: str
    since: datetime
    new: bool = False  # a new account's button


_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_LOCK = threading.Lock()


class AccountPages:
    """The account pages one Claude fill Application meets."""

    def __init__(self, accounts: Accounts | None, facts: dict):
        """`facts` are the fields Claude may fill there: email, names, phone,
        and agree_to_terms (Lisul's policy on a terms box)."""
        self._accounts = accounts
        self._facts = facts
        self._pages = 0
        self._clicked: _Click | None = None
        self._no_account = ""  # the site Claude was sent to make an account at
        self._held: threading.Lock | None = None

    def told(self) -> str:
        """What a prompt tells Claude for an account page: no password, ever."""
        if self._accounts is None:
            return ""
        if getattr(self._accounts, "hands_off", False):  # no fact to type: Lisul signs in himself (KAN-720)
            return ("<account>\nLisul signs in himself here. On an account page type nothing and click nothing: "
                    "only say which page it is.\n</account>")
        facts = dict(self._facts, email=self._accounts.login)
        if self._no_account:
            facts["no_account_at"] = self._no_account
        return f"<account>\n{json.dumps(facts, indent=0)}\n</account>"

    def now(self) -> datetime | None:
        return self._accounts.clock.now() if self._accounts else None

    def after(self, page: Page, said: dict, guard, began: datetime | None, posting: str) -> bool:
        """Deal with the account page Claude said `page` is, if any, from
        `began`, when its session began. True if Claude must look again; a
        Handoff where Apply can't go on."""
        kind = said.get("account_page") or "none"
        if kind not in PAGES:
            kind = "none"
        error = str(said.get("account_error") or "").strip()
        clicked, self._clicked = self._clicked, None
        if clicked:
            self._check(clicked, kind, error)
        if kind not in ("code", "link_sent"):
            self.release()
        if kind == "none":
            return False
        self._pages += 1
        if self._pages > MAX_PAGES:
            raise Handoff(f"Claude fill met more than {MAX_PAGES} sign-in or account pages without reaching the form. "
                          "Sign in and fill it in yourself.")
        site = urlsplit(page.url).hostname or page.url
        if self._accounts is None:
            raise Handoff(f"Claude fill reached {site}'s sign-in page, and this Application can't sign in. Fill it in yourself.")
        if getattr(self._accounts, "hands_off", False):  # a reopened form: before any password, code or click (KAN-720)
            raise Handoff(HANDS_OFF)
        if kind != "link_sent" and captcha.carried(page):  # its button runs the captcha: before a password or code
            raise Handoff(captcha.SIGN_IN.format(site))
        since = clicked.since if clicked else began
        if kind == "link_sent":
            self._link(page, site, since, posting)
            return True
        button = str(said.get("account_button") or "").strip()
        if not button or SENDS.search(button):
            raise Handoff(f"Claude fill named {button!r} as the button that signs in at {site}, which may send the "
                          "application. Sign in and fill it in yourself.")
        if kind == "code":
            self._code(page, site, since, button, guard)
        else:
            self._sign_in(page, kind, site, button, guard)
        return True

    def hands_off(self, page: Page) -> None:
        """Before Claude drives a reopened form's page (KAN-720): a page that shows a password box is a sign-in,
        Lisul's to do, so it is a Handoff before Claude can type anything there."""
        if not (self._accounts and getattr(self._accounts, "hands_off", False)):
            return
        for frame in page.frames:
            try:
                boxes = frame.locator("input[type=password]")
                if any(boxes.nth(k).is_visible() for k in range(boxes.count())):
                    raise Handoff(HANDS_OFF)
            except Handoff:
                raise
            except Exception:
                continue  # a frame that went away

    def release(self) -> None:
        """Let another Worker wait on this sender's mail."""
        held, self._held = self._held, None
        if held:
            held.release()

    def _check(self, clicked: _Click, kind: str, error: str) -> None:
        """What the page after plain code's click says of it."""
        site = clicked.site
        if clicked.page == "sign_in" and kind == "sign_in":
            raise self._accounts.sign_in_failed(site, f"the site said: {error}" if error else "its sign-in page came back")
        if clicked.page == "sign_up" and kind == "sign_up":
            if ALREADY.search(error):
                raise Handoff(NO_PASSWORD.format(site=site, login=self._accounts.login))
            raise Handoff(f"{site} refused the new account ({error or 'its create-account page came back'}). "
                          "Make it and fill the form in yourself.")
        if clicked.page == "code" and kind == "code":
            raise Handoff(f"{site} refused the code from Gmail ({error or 'its code page came back'}): sign in yourself.")
        if clicked.new:
            self._accounts.created(site)

    def _sign_in(self, page: Page, kind: str, site: str, button: str, guard) -> None:
        password = self._accounts.password(site)  # a Handoff if it failed before
        if kind == "sign_in" and password is None:
            if self._no_account == site:  # Claude found no page that makes one
                raise Handoff(NO_PASSWORD.format(site=site, login=self._accounts.login))
            self._no_account = site
            return
        self._no_account = ""  # it has one, once this click goes through
        new = password is None
        if new:
            password = self._accounts.new_password(site)  # in Keychain before the button is clicked
        boxes = [box for box in page.locator("input[type=password]").all() if box.is_visible()]
        if not boxes:
            raise Handoff(f"Claude fill said {site}'s page signs in, but Apply found no password box on it. "
                          "Sign in and fill the form in yourself.")
        for box in boxes:
            box.fill(password)
        self._hold(mail_search(site))  # its mail may come next
        self._click(page, button, site, guard, _Click(kind, site, self._accounts.clock.now(), new))
        for box in page.locator("input[type=password]").all():  # none left for Claude to read, should the page stay
            try:
                box.fill("")
            except Exception:
                pass

    def _code(self, page: Page, site: str, since: datetime, button: str, guard) -> None:
        search = mail_search(site)
        self._hold(search)
        code = self._accounts.code(search, since)
        self.release()
        if not _type_code(page, code):
            raise Handoff(f"Gmail had {site}'s code, but Apply found no box for it on the page. Sign in yourself.")
        self._click(page, button, site, guard, _Click("code", site, self._accounts.clock.now()))

    def _link(self, page: Page, site: str, since: datetime, posting: str) -> None:
        search = mail_search(site)
        self._hold(search)
        link = self._accounts.link(search, since, (site, *mail_domains(site)))
        self.release()
        page.goto(link)
        _settle(page)
        page.goto(posting)
        _settle(page)

    def _click(self, page: Page, button: str, site: str, guard, clicked: _Click) -> None:
        found = [b for b in page.get_by_role("button", name=button, exact=True).all() if b.is_visible()]
        if not found:
            raise Handoff(f"Claude fill named {button!r} as the button that signs in at {site}, and no such button "
                          "shows. Sign in and fill the form in yourself.")
        before = _shown(page)
        if guard:
            guard.let_account_click()
        try:
            found[0].click()
        finally:
            if guard:
                guard.arm()
        self._clicked = clicked
        waited = 0
        while _shown(page) == before and waited < SETTLES_MS:  # the page's answer to the click
            page.wait_for_timeout(250)
            waited += 250
        _settle(page)

    def _hold(self, search: str) -> None:
        if self._held:
            return
        with _LOCKS_LOCK:
            lock = _LOCKS.setdefault(search, threading.Lock())
        lock.acquire()
        self._held = lock


def registrable(host: str) -> str:
    """The domain a host is registered under: careers-acme.icims.com is icims.com."""
    labels = host.lower().strip(".").split(".")
    if len(labels) > 2 and len(labels[-1]) == 2 and labels[-2] in ("co", "com", "ac", "org", "net", "gov"):
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def mail_domains(site: str) -> tuple[str, ...]:
    """The domains a site's account mail may come from: its own, and its job system's."""
    own = registrable(site)
    return tuple(dict.fromkeys((own, *JOB_SYSTEM_MAIL.get(own, ()))))


def mail_search(site: str) -> str:
    """The Gmail search for a site's account mail: from its domains alone, but
    for Oracle's, which each employer sends from an address of its own."""
    if registrable(site) == "oraclecloud.com":
        return ORACLE_MAIL_SEARCH
    return f"from:({' OR '.join(mail_domains(site))})"


def _type_code(page: Page, code: str) -> bool:
    """Into the code's box, one digit per box where it has one each, else
    into the page's one text box. False if there's none."""
    boxes = [box for box in page.locator(CODE_BOX).all() if box.is_visible()]
    if len(code) > 1 and len(boxes) >= len(code):
        for box, digit in zip(boxes, code):
            box.fill(digit)
        return True
    if not boxes:
        boxes = [box for box in page.locator(TEXT_BOX).all() if box.is_visible()]
        if len(boxes) != 1:
            return False
    boxes[0].fill(code)
    return True


def _shown(page: Page) -> str:
    try:
        return page.url + "\n" + page.locator("body").inner_text(timeout=2_000)
    except Exception:
        return ""  # a page between documents


def _settle(page: Page) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=SETTLES_MS)
    except Exception:
        pass  # some pages never go quiet
