"""The Gmail mailbox, read over IMAP with an app password: verification codes
and links, found by Gmail search, with no tokens spent. FakeImap plays Gmail's
IMAP server; the live test (opt in) signs in to Lisul's real Gmail and only
searches."""

import imaplib
import os
import re
import time
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import pytest

from apply import workday
from apply.gmail import GmailMailbox, MailedCode, live_mailbox, sure_code
from apply.keychain import InMemoryKeychain
from apply.model import Handoff

NOW = datetime(2026, 10, 15, 9, 30)
ACME = "acme.wd5.myworkdayjobs.com"


def mail(sender: str, subject: str, body: str, html: str | None = None, dmarc: str = "") -> bytes:
    message = EmailMessage()
    if dmarc:  # as Gmail stamps it on top, over any the sender wrote
        domain = sender.rsplit("@", 1)[1].rstrip(">")
        message["Authentication-Results"] = f"mx.google.com; spf=pass smtp.mailfrom={domain}; dmarc={dmarc} header.from={domain}"
    message["From"], message["To"], message["Subject"] = sender, "test.person@example.com", subject
    message.set_content(body)
    if html:
        message.add_alternative(html, subtype="html")
    return bytes(message)


class FakeImap:
    """Gmail's IMAP server holding `messages` (arrival time, raw mail), oldest
    first. X-GM-RAW search understands `from:` (one sender, or several as
    `from:(a OR b)`) and `newer_than:`, as Gmail does."""

    def __init__(self, messages: list[tuple[datetime, bytes]], password: str = "app-password"):
        self._messages = messages
        self._password = password
        self.searches: list[str] = []
        self.selected: tuple[str, bool] | None = None
        self.fetched: list[str] = []  # each fetch's parts
        self.seen: set[int] = set()  # mail marked read, as a fetch of a body without PEEK does in a writable select

    def __call__(self, host: str):
        assert host == "imap.gmail.com"
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def login(self, user: str, password: str):
        if password != self._password:
            raise imaplib.IMAP4.error("[AUTHENTICATIONFAILED] Invalid credentials")
        return "OK", [b"logged in"]

    def select(self, mailbox: str, readonly: bool = False):
        self.selected = (mailbox, readonly)
        return "OK", [str(len(self._messages)).encode()]

    def search(self, charset, *criteria):
        assert criteria[0] == "X-GM-RAW"
        query = criteria[1].strip('"')
        self.searches.append(query)
        sender = re.search(r"from:\(([^)]*)\)|from:(\S+)", query)
        senders = (sender[1] or sender[2]).split(" OR ") if sender else []
        hits = [
            str(n).encode() for n, (_, raw) in enumerate(self._messages, 1)
            if not senders or any(s in raw.split(b"\n", 1)[0].decode() for s in senders)
        ]
        return "OK", [b" ".join(hits)]

    def fetch(self, number: bytes, parts: str):
        arrived, raw = self._messages[int(number) - 1]
        self.fetched.append(parts)
        if not self.selected[1] and ("RFC822" in parts or "BODY[" in parts):
            self.seen.add(int(number))
        date = imaplib.Time2Internaldate(time.mktime(arrived.timetuple()))
        return "OK", [(f"{int(number)} (INTERNALDATE {date} RFC822 {{{len(raw)}}}".encode(), raw), b")"]


def mailbox(*messages: tuple[datetime, bytes]) -> tuple[GmailMailbox, FakeImap]:
    imap = FakeImap(list(messages))
    return GmailMailbox("test.person@example.com", "app-password", connect=imap), imap


def test_the_newest_code_from_the_sender_since_the_request_is_found():
    box, imap = mailbox(
        (NOW - timedelta(hours=2), mail("Oracle <no-reply@oraclecloud.com>", "Your code", "Your verification code is 111111.")),
        (NOW + timedelta(seconds=20), mail("Oracle <no-reply@oraclecloud.com>", "Your code", "Your verification code is 482913.")),
        (NOW + timedelta(seconds=30), mail("Bank <alerts@bank.example>", "Code", "Your code is 999999.")),
    )

    assert box.find_code(search="from:oraclecloud.com", since=NOW) == "482913"
    assert imap.selected == ("INBOX", True)  # read-only: nothing is marked read
    assert imap.searches == ["from:oraclecloud.com newer_than:1d"]


def test_a_code_sent_before_the_request_is_not_used():
    box, _ = mailbox(
        (NOW - timedelta(minutes=5), mail("no-reply@oraclecloud.com", "Your code", "Verification code: 111111")),
    )

    assert box.find_code(search="from:oraclecloud.com", since=NOW) is None


def test_a_code_filed_outside_the_inbox_is_still_read_without_changing_it():
    # JPMorgan's code mails were in Trash (live), and Apply gets one code per sign-in.
    box, imap = mailbox((NOW + timedelta(seconds=20), mail("no-reply@oracle.com", "Your code", "Your verification code is 482913.")))
    inbox = imap.search
    imap.search = lambda charset, *criteria: (inbox(charset, *criteria) if imap.selected[0] == '"[Gmail]/Trash"'
                                              else ("OK", [b""]))

    assert box.find_code(search="from:oracle.com", since=NOW) == "482913"
    assert imap.selected == ('"[Gmail]/Trash"', True) and imap.seen == set()


def test_a_mailbox_this_account_lacks_is_skipped():
    box, imap = mailbox((NOW + timedelta(seconds=20), mail("no-reply@oracle.com", "Your code", "Your verification code is 482913.")))
    select = imap.select
    imap.select = lambda name, readonly=False: ("NO", [b"no such mailbox"]) if name != '"[Gmail]/Trash"' else select(name, readonly)

    assert box.find_code(search="from:oracle.com", since=NOW) == "482913"


def test_the_code_is_read_from_an_html_only_mail():
    message = EmailMessage()
    message["From"], message["Subject"] = "no-reply@oraclecloud.com", "Confirm your identity"
    message.set_content("<p>Use this code to confirm it's you:</p><p><b>730 118</b></p><p>Ref 20261015</p>", subtype="html")
    box, _ = mailbox((NOW + timedelta(seconds=5), bytes(message)))

    assert box.find_code(search="from:oraclecloud.com", since=NOW) == "730118"


def test_greenhouses_eight_character_security_code_is_read():
    html = (
        "<p>Hi Test,</p><p>Copy and paste this code into the security code field on your application:</p>"
        "<h1>q7XmPa2R</h1><p>Your application to Acme (Job 4012345) will be submitted once you enter it.</p>"
    )
    box, _ = mailbox((NOW + timedelta(seconds=15), mail("Greenhouse <no-reply@us.greenhouse-mail.io>",
                                                         "Security code for your application to Acme", "See the HTML part.", html)))

    assert box.find_code(search="from:greenhouse-mail.io", since=NOW) == "q7XmPa2R"


def test_mail_that_fails_dmarc_is_not_trusted():
    box, _ = mailbox(
        (NOW + timedelta(seconds=10), mail("Oracle <no-reply@oraclecloud.com>", "Your code", "Your verification code is 482913.",
                                          dmarc="pass (p=REJECT sp=REJECT dis=NONE)")),
        (NOW + timedelta(seconds=20), mail("Oracle <no-reply@oraclecloud.com>", "Your code", "Your verification code is 666666.",
                                          dmarc="fail (p=QUARANTINE sp=QUARANTINE dis=QUARANTINE)")),
    )

    assert box.find_code(search="from:oraclecloud.com", since=NOW) == "482913"


# --- A code Apply types with no person reading the mail (email_code.py) -----

def test_a_mailed_code_comes_with_its_senders_domain_and_only_after_the_request():
    html = "<p>Copy and paste this code into the security code field on your application:</p><h1>q7XmPa2R</h1>"
    box, imap = mailbox(
        (NOW - timedelta(minutes=5), mail("Greenhouse <no-reply@us.greenhouse-mail.io>", "Security code", "x", html.replace("q7XmPa2R", "OLD0ld00"))),
        (NOW + timedelta(seconds=15), mail("Greenhouse <no-reply@us.greenhouse-mail.io>", "Security code", "x", html)),
    )

    assert box.find_mailed_code(search="from:greenhouse-mail.io", since=NOW) == MailedCode("q7XmPa2R", "us.greenhouse-mail.io")
    assert imap.selected == ("INBOX", True)
    assert box.find_mailed_code(search="from:greenhouse-mail.io", since=NOW + timedelta(minutes=1)) is None


@pytest.mark.parametrize("text, code", [
    ("Your verification code is 482913. It expires in 10 minutes.", "482913"),
    ("<p>Use this code to confirm it's you:</p><p><b>730 118</b></p>", "730118"),
    ("Your code: © 2026 Acme. 5512", "5512"),  # a year is never the code
])
def test_a_sure_code_is_the_one_named_as_a_code(text, code):
    assert sure_code(text) == code


@pytest.mark.parametrize("text", [
    "Save 25% on fall courses! Call 555 0123 or visit us at 482913 Main St.",  # no code named: no guess
    '<style>.code { color: #333333 }</style><p>Your code expired.</p>',  # a color is no code
    "Verify: https://example.com/verify?code=123456&u=99887766 to continue",  # a link's numbers are no code
    "Your access code ABCD-1234-EFGH is below",  # a shape Apply can't read for sure
])
def test_a_mail_that_names_no_code_for_sure_gives_none(text):
    assert sure_code(text) is None


def test_the_verification_link_is_found_among_the_mails_links():
    html = (
        '<p>Welcome!</p><a href="https://acme.wd5.myworkdayjobs.com/External">Careers</a>'
        '<a href="https://acme.wd5.myworkdayjobs.com/External/activate/abc123?redirect=x&amp;y=1">Verify Account</a>'
        '<a href="https://www.workday.com/privacy">Privacy</a>'
    )
    box, _ = mailbox((NOW + timedelta(seconds=40), mail("acme@myworkday.com", "Verify your account", "See the HTML part.", html)))

    assert box.find_link(search="from:myworkday.com", since=NOW, hosts=(ACME,)) == (
        "https://acme.wd5.myworkdayjobs.com/External/activate/abc123?redirect=x&y=1"
    )


def test_workdays_mail_from_its_otp_sender_is_found_too():
    html = '<a href="https://acme.wd5.myworkdayjobs.com/External/activate/abc123">Verify Account</a>'
    box, _ = mailbox((NOW + timedelta(seconds=40), mail("Workday <noreply@otp.workday.com>", "Verify your account", "See the HTML part.", html)))

    assert box.find_link(search=workday.MAIL_SEARCH, since=NOW, hosts=(ACME,)) == "https://acme.wd5.myworkdayjobs.com/External/activate/abc123"


def test_a_password_reset_link_is_found():
    html = (
        '<p>We received a request to reset your password.</p><a href="https://acme.wd5.myworkdayjobs.com/External">Careers</a>'
        '<a href="https://acme.wd5.myworkdayjobs.com/External/passwordreset/9f8e7d">Reset Password</a>'
    )
    box, _ = mailbox((NOW + timedelta(seconds=40), mail("acme@myworkday.com", "Reset your password", "See the HTML part.", html)))

    assert box.find_link(search="from:myworkday.com", since=NOW, hosts=(ACME,)) == (
        "https://acme.wd5.myworkdayjobs.com/External/passwordreset/9f8e7d"
    )


def test_only_a_link_to_the_tenants_own_host_or_the_job_systems_is_followed():
    foreign = '<a href="https://acme-careers.example/verify?u=1">Verify Account</a>'
    lookalike = '<a href="https://acme.wd5.myworkdayjobs.com.example/activate/1">Verify Account</a>'
    workdays = '<a href="https://acme.example/x">Home</a><a href="https://wd5.myworkday.com/acme/activate/2">Verify Account</a>'

    def found(html: str, hosts=(ACME, "myworkday.com")) -> str | None:
        box, _ = mailbox((NOW + timedelta(seconds=40), mail("acme@myworkday.com", "Verify your account", "See the HTML part.", html)))
        return box.find_link(search="from:myworkday.com", since=NOW, hosts=hosts)

    assert found(foreign) is None
    assert found(lookalike) is None
    assert found(workdays) == "https://wd5.myworkday.com/acme/activate/2"
    assert found(workdays, hosts=(ACME,)) is None


@pytest.mark.parametrize("href", [
    "https://evil.example\\@wd5.myworkday.com/acme/activate/2",  # Python reads wd5.myworkday.com; Chrome opens evil.example
    "https://evil.example@wd5.myworkday.com/acme/activate/2",
    "https://wd5.myworkday.com:evil@evil.example/activate/2",
    "http://wd5.myworkday.com/acme/activate/2",
])
def test_a_link_whose_host_a_browser_could_read_otherwise_is_not_followed(href):
    html = f'<a href="{href}">Verify Account</a>'
    box, _ = mailbox((NOW + timedelta(seconds=40), mail("acme@myworkday.com", "Verify your account", "See the HTML part.", html)))

    assert box.find_link(search="from:myworkday.com", since=NOW, hosts=(ACME, "myworkday.com")) is None


def test_no_mail_means_no_code_or_link():
    box, _ = mailbox()

    assert box.find_code(search="from:oraclecloud.com", since=NOW) is None
    assert box.find_link(search="from:myworkday.com", since=NOW, hosts=(ACME,)) is None


def test_recent_mail_is_read_oldest_first_without_marking_any_read():
    box, imap = mailbox(
        (NOW - timedelta(days=3), mail("Arc <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Arc",
                                      "We received your application.", "<p>We received your <b>application</b>.</p>")),
        (NOW - timedelta(days=1), mail("Glean Recruiting <recruiting@glean.com>", "Next steps with Glean",
                                      "Please complete the assessment.")),
    )

    mails = box.read_mail(search="newer_than:30d")

    assert [(m.sender, m.subject, m.arrived) for m in mails] == [
        ("Arc <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Arc", NOW - timedelta(days=3)),
        ("Glean Recruiting <recruiting@glean.com>", "Next steps with Glean", NOW - timedelta(days=1)),
    ]
    assert "We received your application." in mails[0].text and "<b>application</b>" in mails[0].text
    assert imap.searches == ["newer_than:30d"]
    assert imap.selected == ("INBOX", True)
    assert imap.fetched and all("BODY.PEEK[]" in parts for parts in imap.fetched)
    assert imap.seen == set()


def test_recent_mail_that_fails_dmarc_or_has_an_encoded_subject_is_read_as_gmail_shows_it():
    encoded = EmailMessage()
    encoded["From"], encoded["Subject"] = "Ramp <talent@ramp.com>", "=?utf-8?q?Your_application_to_Ramp_=E2=80=93_received?="
    encoded.set_content("Thanks!")
    box, _ = mailbox(
        (NOW, mail("Ramp <talent@ramp.com>", "Unfortunately...", "We regret to inform you.", dmarc="fail (p=REJECT)")),
        (NOW, bytes(encoded)),
    )

    assert [m.subject for m in box.read_mail(search="newer_than:30d")] == ["Your application to Ramp \u2013 received"]


def test_without_an_app_password_in_keychain_each_look_is_a_handoff_saying_how_to_set_it_up():
    box = live_mailbox("test.person@example.com", keychain=InMemoryKeychain())

    why = box.unavailable()
    assert "no Gmail app password in Keychain" in why
    assert "security add-generic-password -s apply-gmail -a test.person@example.com -w" in why
    with pytest.raises(Handoff, match="no Gmail app password in Keychain"):
        box.find_code(search="from:oraclecloud.com", since=NOW)
    with pytest.raises(Handoff, match="no Gmail app password in Keychain"):
        box.find_link(search="from:myworkday.com", since=NOW, hosts=(ACME,))
    with pytest.raises(Handoff, match="no Gmail app password in Keychain"):
        box.read_mail(search="newer_than:30d")


def test_with_an_app_password_in_keychain_mail_can_be_read():
    keychain = InMemoryKeychain({"test.person@example.com": "app-password"})

    assert live_mailbox("test.person@example.com", keychain=keychain).unavailable() is None


@pytest.mark.skipif(not os.environ.get("APPLY_TEST_GMAIL"),
                    reason="set APPLY_TEST_GMAIL=<address> (app password in Keychain service apply-gmail) to search real Gmail")
def test_the_real_gmail_signs_in_and_searches():
    box = live_mailbox(os.environ["APPLY_TEST_GMAIL"])

    assert box.find_code(search="from:nobody.invalid", since=datetime.now()) is None


def test_a_search_with_a_quoted_phrase_stays_one_imap_string():
    # Oracle's code search has "confirm your identity" in it (seen live): Gmail refused it, and no code was read.
    from apply.gmail import _quoted
    assert _quoted('subject:(code OR "confirm your identity")') == '"subject:(code OR \\"confirm your identity\\")"'


def test_a_mails_arrival_is_read_when_gmail_sends_it_after_the_body():
    # Amex's code mail (seen live): INTERNALDATE came after the body's literal.
    from apply.gmail import _arrived
    data = [(b"1960 (RFC822 {4}", b"mail"), b' INTERNALDATE "03-Nov-2026 03:11:37 +0000")']
    assert _arrived(data).astimezone(UTC).replace(tzinfo=None) == datetime(2026, 11, 3, 3, 11, 37)
