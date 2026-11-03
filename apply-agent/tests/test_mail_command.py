"""`apply mail`: one read-only pass over recent Employer mail that writes what
it says to the Tracker and lists online assessments and unmatched mail. Gmail
is FakeImap holding the sample mails; nothing connects to the real Gmail."""

from datetime import date, datetime

import pytest
from fakes import FakeClock
from test_employer_mail import ARC, GLEAN, PURE, RAMP, SAMPLES, tracker
from test_gmail import FakeImap

from apply.adapters import Adapters
from apply.cli import main
from apply.gmail import GmailMailbox
from apply.model import Outcome, Status

NOW = datetime(2026, 10, 16, 18, 0)


def adapters(rows, mailbox) -> Adapters:
    return Adapters(feed=None, tracker=rows, site=None, claude=None, mailbox=mailbox, usage=None, clock=FakeClock(NOW))


def gmail(*named: tuple[str, datetime], password: str = "app-password") -> tuple[GmailMailbox, FakeImap]:
    imap = FakeImap([(arrived, (SAMPLES / f"{name}.eml").read_bytes()) for name, arrived in named])
    return GmailMailbox("test.person@example.com", password, connect=imap), imap


def test_apply_mail_writes_what_employer_mail_says_and_lists_assessments_and_unmatched_mail(capsys):
    rows = tracker(ARC, PURE, RAMP, GLEAN)
    rows.edit_as_lisul("ramp-1", outcome=Outcome.INTERVIEW)
    mailbox, imap = gmail(
        ("workday-confirmation", datetime(2026, 10, 13, 15, 2)), ("greenhouse-confirmation", datetime(2026, 10, 14, 22, 41)),
        ("hackerrank-assessment", datetime(2026, 10, 15, 9, 12)), ("ashby-rejection", datetime(2026, 10, 15, 18, 20)),
        ("job-alert", datetime(2026, 10, 15, 13, 0)), ("interview-invite", datetime(2026, 10, 16, 16, 45)),
    )

    main(["mail", "--days", "14"], adapters=adapters(rows, mailbox))

    out = capsys.readouterr().out
    assert rows.get("arc-1").confirmation_received == date(2026, 10, 14)
    assert (rows.get("pure-1").status, rows.get("pure-1").confirmation_received) == (Status.SUBMITTED, date(2026, 10, 13))
    assert (rows.get("ramp-1").suggested_outcome, rows.get("ramp-1").outcome) == (Outcome.REJECTED, Outcome.INTERVIEW)
    assert rows.get("glean-1").suggested_outcome == Outcome.OA
    assert "pure-1" in out and "now Submitted" in out
    assert "https://www.hackerrank.com/test/7f3k2p9q1a/login?b=eyJ1c2VybmFtZSI6InRlc3QifQ&src=email" in out
    assert "by 2026-10-22" in out
    assert "Not matched" in out and "Skydio - Interview invitation for Autonomy Engineer Intern" in out
    assert "12 new internships" not in out  # other mail isn't listed
    assert imap.searches[0].startswith("newer_than:14d ")
    assert imap.selected == ("INBOX", True) and imap.seen == set()


def test_apply_mail_without_gmail_set_up_says_so_and_exits_non_zero(capsys):
    rows = tracker(ARC)

    with pytest.raises(SystemExit) as exit:
        main(["mail"], adapters=adapters(rows, GmailMailbox("test.person@example.com", None)))

    assert exit.value.code not in (0, None)
    assert "no Gmail app password in Keychain" in str(exit.value.code)
    assert rows.rows() == [ARC]


def test_apply_mail_with_a_wrong_app_password_says_so_and_exits_non_zero():
    mailbox, _ = gmail(("greenhouse-confirmation", NOW), password="wrong")
    rows = tracker(ARC)

    with pytest.raises(SystemExit) as exit:
        main(["mail"], adapters=adapters(rows, mailbox))

    assert "Gmail refused" in str(exit.value.code) and "AUTHENTICATIONFAILED" in str(exit.value.code)
    assert rows.rows() == [ARC]
