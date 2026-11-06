"""Lisul's Gmail, read over IMAP with an app password from Keychain, for
verification codes and links. A script, so it spends no tokens, and an app
password has no OAuth token to expire (see the sign-in research).

Each look is one IMAP session: sign in, search the inbox read-only with
Gmail's own search syntax (X-GM-RAW), then archived mail, Spam and Trash when
the inbox has none (Apply asks for a code once, so a filed mail is still its
only one), read the newest matching mails that arrived after the request, skip
any that Gmail says failed DMARC, and return only the code or link. Waiting is the caller's (accounts.Accounts), which
never asks for a code again. `read_mail` reads recent mail whole for `apply mail`, as
read-only: it fetches with BODY.PEEK, so nothing is marked read, and it never
sends, moves or deletes."""

import email
import html
import imaplib
import re
import time
from dataclasses import dataclass
from datetime import datetime
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr
from urllib.parse import urlsplit

from apply.adapters import Keychain
from apply.keychain import GMAIL, MacKeychain
from apply.model import Handoff

HOST = "imap.gmail.com"
# Mail older than this is never searched, whatever `since` says.
WINDOW = "newer_than:1d"
# Where a code or link can land. Each is opened read-only.
MAILBOXES = ("INBOX", '"[Gmail]/All Mail"', '"[Gmail]/Spam"', '"[Gmail]/Trash"')
# A one-time code: 4 to 8 digits, perhaps split by a space or hyphen ("730 118"),
# or a security code of 8 letters and digits (SECURITY_CODE).
CODE = re.compile(r"(?<![\d-])(\d{3,4})[ -]?(\d{3,4})(?![\d-])|(?<![\d-])(\d{4,8})(?![\d-])")
# Greenhouse's security code: 8 letters and digits, after "... the security code
# field on your application:".
SECURITY_CODE = re.compile(r"security code\b[^:]{0,80}:\s*([A-Za-z0-9]{8})(?![A-Za-z0-9])", re.IGNORECASE)
# What sure_code reads: a code as a word of its own (not inside "abc123456"), after
# the word code itself. A year ("© 2026") is never one, and a mail's style, script
# and links are not read: colors ("#333333") and link parameters look like codes.
SURE_CODE = re.compile(r"(?<![\w-])(\d{3,4})[ -]?(\d{3,4})(?![\w-])|(?<![\w-])(\d{4,8})(?![\w-])")
SURE_WORDS = re.compile(r"\b(code|passcode|pin|otp)\b", re.IGNORECASE)
YEAR = re.compile(r"(19|20)\d\d")
NOT_TEXT = re.compile(r"<(style|script)\b.*?</\1>|https?://\S+", re.IGNORECASE | re.DOTALL)
CODE_WORDS = re.compile(r"code|pin|passcode|one-time|verif", re.IGNORECASE)
LINK = re.compile(r"""<a\b[^>]*?href=["'](https://[^"']+)["'][^>]*>(.*?)</a>|(https://[^\s<>"']+)""", re.IGNORECASE | re.DOTALL)
VERIFY = re.compile(r"verif|activat|confirm|reset", re.IGNORECASE)  # an account's link, or a password reset's


NOT_SET_UP = (
    "Gmail isn't set up for Apply: no Gmail app password in Keychain for {address}. Make one at "
    "https://myaccount.google.com/apppasswords and save it with: security add-generic-password -s {service} -a {address} -w"
)


@dataclass(frozen=True)
class MailedCode:
    """A code read from one mail, and the domain of the mail's sender (for
    the log: never the code or the mail's text)."""

    code: str
    sender: str


@dataclass(frozen=True)
class Mail:
    """One mail as `read_mail` gives it: its text is the plain part and the HTML."""

    sender: str
    subject: str
    text: str
    arrived: datetime


class GmailMailbox:
    def __init__(self, address: str, app_password: str | None, connect=imaplib.IMAP4_SSL):
        """Without an `app_password`, every look is a Handoff saying how to set one up."""
        self._address = address
        self._password = app_password
        self._connect = connect

    def unavailable(self) -> str | None:
        """Why no mail can be read (no app password), or None."""
        return None if self._password else NOT_SET_UP.format(address=self._address, service=GMAIL)

    def find_code(self, *, search: str, since: datetime) -> str | None:
        """The one-time code in the newest mail matching `search` (Gmail search
        terms, such as "from:oraclecloud.com") that arrived at or after `since`."""
        return self._newest(search, since, lambda message: _code(_text(message)))

    def find_mailed_code(self, *, search: str, since: datetime) -> MailedCode | None:
        """As find_code, but only a code the mail names as one (sure_code),
        with its sender's domain: for a code Apply types without a person
        reading the mail first."""
        def read(message: Message) -> MailedCode | None:
            code = sure_code(_text(message))
            return MailedCode(code, sender_domain(_header(message, "From"))) if code else None
        return self._newest(search, since, read)

    def find_link(self, *, search: str, since: datetime, hosts: tuple[str, ...]) -> str | None:
        """The verification link in the newest such mail, to one of `hosts`
        (or a host under one): any other link is not followed."""
        return self._newest(search, since, lambda message: _link(_text(message), hosts))

    def read_mail(self, *, search: str) -> list[Mail]:
        """Every inbox mail matching `search` (Gmail search terms, such as
        "newer_than:30d"), oldest first, but any that failed DMARC. Read-only:
        nothing is marked read, moved or deleted."""
        if why := self.unavailable():
            raise Handoff(why)
        mails = []
        with self._connect(HOST) as imap:
            imap.login(self._address, self._password)
            imap.select("INBOX", readonly=True)
            _, found = imap.search(None, "X-GM-RAW", _quoted(search))
            for number in found[0].split():
                _, data = imap.fetch(number, "(INTERNALDATE BODY.PEEK[])")
                _head, raw = data[0]
                message = email.message_from_bytes(raw)
                if _authentic(message):
                    mails.append(Mail(
                        sender=_header(message, "From"), subject=_header(message, "Subject"), text=_text(message),
                        arrived=_arrived(data),
                    ))
        return mails

    def _newest(self, search: str, since: datetime, read) -> str | None:
        if why := self.unavailable():
            raise Handoff(why)
        with self._connect(HOST) as imap:
            imap.login(self._address, self._password)
            for mailbox in MAILBOXES:
                if imap.select(mailbox, readonly=True)[0] != "OK":
                    continue  # a mailbox this account names otherwise
                _, found = imap.search(None, "X-GM-RAW", _quoted(f"{search} {WINDOW}"))
                for number in reversed(found[0].split()):
                    _, data = imap.fetch(number, "(INTERNALDATE RFC822)")
                    _head, raw = data[0]
                    arrived = _arrived(data)
                    if arrived < since:
                        break  # newest first: every mail left here is older still
                    message = email.message_from_bytes(raw)
                    if _authentic(message) and (value := read(message)):
                        return value
        return None


def _arrived(data: list) -> datetime:
    """When a fetched mail arrived, from its INTERNALDATE, which Gmail may send before the
    mail's body or after it (Amex's code mail, live)."""
    parts = b" ".join(part[0] if isinstance(part, tuple) else part for part in data if part)
    return datetime.fromtimestamp(time.mktime(imaplib.Internaldate2tuple(parts)))


def _quoted(search: str) -> str:
    """`search` as one IMAP quoted string. A phrase in it keeps its quotes, escaped (Oracle's
    `"confirm your identity"`): bare, they ended the string, and Gmail refused the search."""
    return '"' + search.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _authentic(message: Message) -> bool:
    """False if Gmail's check of the sender says it failed DMARC (a forged
    sender). Gmail stamps its Authentication-Results on top, over any the
    sender wrote; a mail with none is taken as it is."""
    verdict = re.search(r"\bdmarc=(\w+)", message.get("Authentication-Results", ""), re.IGNORECASE)
    return not verdict or verdict[1].lower() == "pass"


def _header(message: Message, name: str) -> str:
    """A header as a mail app shows it, encoded words decoded."""
    return str(make_header(decode_header(message.get(name, ""))))


def _text(message: Message) -> str:
    """The mail's text: its plain part and its HTML, undecoded entities and all."""
    parts = message.walk() if message.is_multipart() else [message]
    texts = []
    for part in parts:
        if part.get_content_type() in ("text/plain", "text/html"):
            texts.append(part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace"))
    return "\n".join(texts)


def _code(text: str) -> str | None:
    words = html.unescape(re.sub(r"<[^>]+>", " ", text))
    if security := SECURITY_CODE.search(words):
        return security[1]
    codes = [(m.start(), "".join(filter(None, m.groups()))) for m in CODE.finditer(words)]
    if not codes:
        return None
    # The code nearest after a mention of a code; else the first 6-digit one.
    for mention in CODE_WORDS.finditer(words):
        after = [c for at, c in codes if 0 <= at - mention.end() <= 200]
        if after:
            return after[0]
    return next((c for _, c in codes if len(c) == 6), None)


def sure_code(text: str) -> str | None:
    """The code a mail names as one, or None when it is not sure: Greenhouse's
    security code, else the first code within 200 characters after the word
    code (SURE_CODE). No code is guessed from the mail's other numbers, as
    find_code does with its first 6-digit one."""
    words = html.unescape(re.sub(r"<[^>]+>", " ", NOT_TEXT.sub(" ", text)))
    if security := SECURITY_CODE.search(words):
        return security[1]
    codes = [(m.start(), "".join(filter(None, m.groups()))) for m in SURE_CODE.finditer(words)]
    codes = [(at, c) for at, c in codes if not YEAR.fullmatch(c)]
    for mention in SURE_WORDS.finditer(words):
        if after := [c for at, c in codes if 0 <= at - mention.end() <= 200]:
            return after[0]
    return None


def sender_domain(sender: str) -> str:
    """The domain of a From header's address: "us.greenhouse-mail.io"."""
    return parseaddr(sender)[1].rpartition("@")[2].lower()


def _link(text: str, hosts: tuple[str, ...]) -> str | None:
    for m in LINK.finditer(text):
        url = html.unescape(m[1] or m[3])
        label = re.sub(r"<[^>]+>", "", m[2] or "")
        if (VERIFY.search(url) or VERIFY.search(label)) and on_hosts(url, hosts):
            return url
    return None


def on_hosts(url: str, hosts: tuple[str, ...]) -> bool:
    """Whether `url` is on one of `hosts`, or a host under one. A link with a user
    part or a backslash is refused: a browser can read its host differently
    ("https://evil.example\\@wd5.myworkday.com" opens evil.example in Chrome)."""
    parts = urlsplit(url)
    if parts.scheme != "https" or "@" in parts.netloc or "\\" in url:
        return False
    host = (parts.hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in hosts)


def live_mailbox(address: str, keychain: Keychain | None = None) -> GmailMailbox:
    """Lisul's Gmail, signed in to with the app password saved in Keychain
    (service apply-gmail, account `address`). Without one a run still goes,
    and an Application that needs a code or a link is a Handoff saying how
    to set it up."""
    return GmailMailbox(address, (keychain or MacKeychain(GMAIL)).password(address))
