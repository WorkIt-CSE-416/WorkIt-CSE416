"""Employer mail: what each recent mail from an employer or its job system says,
read with fixed patterns (no model), and what it changes in the Tracker. The
sample mails in fixtures/employer-mail are read through the real Gmail
mailbox over FakeImap, as `apply mail` reads them."""

from datetime import date, datetime

import pytest
from conftest import FIXTURES
from test_gmail import FakeImap

from apply.employer_mail import Kind, classify, sync
from apply.gmail import GmailMailbox, Mail
from apply.model import Outcome, Status
from apply.orchestrator import INTERRUPTED_SUBMIT
from apply.tracker import InMemoryTracker, Row

SAMPLES = FIXTURES / "employer-mail"
ARRIVED = datetime(2026, 10, 16, 9, 0)


def sample(name: str, arrived: datetime = ARRIVED) -> Mail:
    [mail] = mails((name, arrived))
    return mail


def mails(*named: tuple[str, datetime]) -> list[Mail]:
    imap = FakeImap([(arrived, (SAMPLES / f"{name}.eml").read_bytes()) for name, arrived in named])
    return GmailMailbox("test.person@example.com", "app-password", connect=imap).read_mail(search="newer_than:30d")


@pytest.mark.parametrize("name, kind", [
    ("greenhouse-confirmation", Kind.CONFIRMATION),  # "if ... a recruiter will reach out to schedule an interview" is boilerplate
    ("workday-confirmation", Kind.CONFIRMATION),
    ("ashby-rejection", Kind.REJECTION),
    ("hackerrank-assessment", Kind.OA),
    ("codesignal-assessment", Kind.OA),
    ("interview-invite", Kind.INTERVIEW),  # though it thanks Lisul for completing an assessment
    ("complete-your-application", Kind.OTHER),  # an unfinished application is no confirmation
    ("verify-account", Kind.OTHER),
    ("job-alert", Kind.OTHER),
])
def test_each_sample_mail_is_read_as_what_it_says(name, kind):
    assert classify(sample(name)).kind == kind


def test_an_online_assessment_gives_its_link_and_the_deadline_it_states():
    read = classify(sample("hackerrank-assessment"))

    assert read.link == "https://www.hackerrank.com/test/7f3k2p9q1a/login?b=eyJ1c2VybmFtZSI6InRlc3QifQ&src=email"
    assert read.deadline == date(2026, 10, 22)


def test_a_deadline_stated_as_a_span_counts_from_the_mails_arrival():
    read = classify(sample("codesignal-assessment", arrived=datetime(2026, 10, 16, 8, 0)))

    assert read.link == "https://app.codesignal.com/public-test/Zx81kQ/start"
    assert read.deadline == date(2026, 10, 23)


def test_a_deadline_without_a_year_is_the_next_such_day():
    mail = Mail("Glean <support@hackerrankforwork.com>", "Your Glean online assessment",
                "Please complete the online assessment by January 5.", datetime(2026, 12, 20, 9, 0))

    assert classify(mail).deadline == date(2027, 1, 5)


def test_an_assessment_with_no_deadline_or_link_says_so():
    mail = Mail("Glean <recruiting@glean.com>", "Next steps", "As a next step, please complete a coding challenge.",
                ARRIVED)

    read = classify(mail)
    assert (read.kind, read.link, read.deadline) == (Kind.OA, None, None)


def test_only_an_assessment_gets_a_link_or_deadline():
    read = classify(sample("interview-invite"))

    assert (read.link, read.deadline) == (None, None)


def tracked(application_id: str, company: str, role: str, url: str, status: Status = Status.SUBMITTED,
            applied: date | None = date(2026, 10, 12), **fields) -> Row:
    return Row(application_id, company, role, url, "greenhouse", status, date_applied=applied, **fields)


def tracker(*rows: Row) -> InMemoryTracker:
    tracker = InMemoryTracker()
    for row in rows:
        tracker.add(row)
    return tracker


ARC = tracked("arc-1", "Arc", "Software Engineer Intern", "https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008")
PURE = tracked("pure-1", "Pure Storage", "Software Engineer Intern (Summer 2027)",
               "https://purestorage.wd5.myworkdayjobs.com/en-US/purestorage/job/Santa-Clara/Software-Engineer-Intern_R1234",
               status=Status.HANDOFF, applied=None, reason=INTERRUPTED_SUBMIT)
RAMP = tracked("ramp-1", "Ramp", "Software Engineer Intern", "https://jobs.ashbyhq.com/ramp/9a8b7c")
GLEAN = tracked("glean-1", "Glean", "Software Engineer Intern", "https://job-boards.greenhouse.io/gleanwork/jobs/4012345")
SKYDIO = tracked("skydio-1", "Skydio", "Autonomy Engineer Intern", "https://jobs.ashbyhq.com/skydio/1111")
SKYDIO_EMBEDDED = tracked("skydio-2", "Skydio", "Embedded Software Intern", "https://jobs.ashbyhq.com/skydio/2222")


def test_a_confirmation_marks_its_row_confirmation_received():
    rows = tracker(ARC, RAMP)

    [found] = sync(mails(("greenhouse-confirmation", datetime(2026, 10, 14, 22, 41))), rows)

    assert (found.reading.kind, found.row.application_id, found.settled) == (Kind.CONFIRMATION, "arc-1", False)
    assert rows.get("arc-1").confirmation_received == date(2026, 10, 14)
    assert rows.get("arc-1").status == Status.SUBMITTED and rows.get("ramp-1") == RAMP


def test_a_confirmation_settles_a_submit_apply_was_unsure_of():
    rows = tracker(PURE)

    [found] = sync(mails(("workday-confirmation", datetime(2026, 10, 13, 15, 2))), rows)

    row = rows.get("pure-1")
    assert found.settled
    assert (row.status, row.date_applied, row.confirmation_received) == (Status.SUBMITTED, date(2026, 10, 13), date(2026, 10, 13))
    assert "confirm" in row.reason and INTERRUPTED_SUBMIT not in row.reason


def test_a_decision_is_a_suggested_outcome_and_lisuls_outcome_is_never_written():
    rows = tracker(RAMP, GLEAN, SKYDIO)
    rows.edit_as_lisul("ramp-1", outcome=Outcome.INTERVIEW)

    sync(mails(("ashby-rejection", datetime(2026, 10, 15, 18, 20)), ("hackerrank-assessment", datetime(2026, 10, 15, 9, 12)),
               ("interview-invite", datetime(2026, 10, 16, 16, 45))), rows)

    assert {row.application_id: (row.suggested_outcome, row.outcome) for row in rows.rows()} == {
        "ramp-1": (Outcome.REJECTED, Outcome.INTERVIEW),
        "glean-1": (Outcome.OA, None),
        "skydio-1": (Outcome.INTERVIEW, None),
    }
    assert {row.confirmation_received for row in rows.rows()} == {date(2026, 10, 15), date(2026, 10, 16)}


def test_the_latest_mail_gives_the_suggested_outcome():
    rows = tracker(SKYDIO)

    sync(mails(("codesignal-assessment", datetime(2026, 10, 16, 8, 0)), ("interview-invite", datetime(2026, 10, 20, 9, 0))), rows)

    assert rows.get("skydio-1").suggested_outcome == Outcome.INTERVIEW


def test_the_role_a_mail_names_picks_between_two_applications_at_one_company():
    rows = tracker(SKYDIO, SKYDIO_EMBEDDED)

    found = sync(mails(("codesignal-assessment", datetime(2026, 10, 16, 8, 0)), ("interview-invite", datetime(2026, 10, 16, 16, 45))),
                 rows)

    assert [f.row.application_id for f in found] == ["skydio-1", "skydio-1"]
    assert rows.get("skydio-2") == SKYDIO_EMBEDDED


def test_an_unsure_match_is_left_unmatched_and_listed():
    rows = tracker(SKYDIO, SKYDIO_EMBEDDED, ARC)
    no_role = Mail("Skydio Recruiting <recruiting@skydio.com>", "Skydio - next steps",
                   "We'd like to invite you to a phone screen. Please share your availability.", ARRIVED)
    other_role = Mail("Arc <no-reply@us.greenhouse-mail.io>", "Your application for Data Science Intern at Arc",
                      "Unfortunately, we have decided to move forward with other candidates.", ARRIVED)
    two_companies = Mail("Ramp and Arc <events@example.org>", "Arc and Skydio: thank you for applying",
                         "We received your application for Software Engineer Intern.", ARRIVED)
    unknown = Mail("Stripe <no-reply@stripe.com>", "Your application to Stripe",
                   "Unfortunately, we will not be moving forward.", ARRIVED)

    found = sync([no_role, other_role, two_companies, unknown], rows)

    assert [(f.reading.mail.subject, f.row) for f in found] == [
        ("Skydio - next steps", None), ("Your application for Data Science Intern at Arc", None),
        ("Arc and Skydio: thank you for applying", None), ("Your application to Stripe", None),
    ]
    assert rows.rows() == [SKYDIO, SKYDIO_EMBEDDED, ARC]


def test_mail_from_before_an_application_or_about_one_never_sent_matches_nothing():
    held = tracked("ramp-2", "Ramp", "Software Engineer Intern", "https://jobs.ashbyhq.com/ramp/9a8b7c",
                   status=Status.HELD, applied=None)
    rows = tracker(held, tracked("arc-1", "Arc", "Software Engineer Intern", ARC.posting_url, applied=date(2026, 10, 15)))

    found = sync(mails(("ashby-rejection", datetime(2026, 10, 15, 18, 20)), ("greenhouse-confirmation", datetime(2026, 10, 14, 22, 41))),
                 rows)

    assert [f.row for f in found] == [None, None]
    assert rows.get("ramp-2").suggested_outcome is None and rows.get("arc-1").confirmation_received is None


def test_other_mail_is_neither_matched_nor_listed():
    rows = tracker(ARC, RAMP, GLEAN, PURE)

    assert sync(mails(("job-alert", ARRIVED), ("verify-account", ARRIVED), ("complete-your-application", ARRIVED)), rows) == []
    assert rows.rows() == [ARC, RAMP, GLEAN, PURE]
