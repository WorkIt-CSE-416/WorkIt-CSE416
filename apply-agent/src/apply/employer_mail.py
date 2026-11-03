"""Employer mail: what a recent mail from an employer or its job system says
about an Application, read with fixed patterns, and the Tracker row it is
about. No model sees any mail.

The patterns follow lib/mail/classify.mjs of job-application-harness
(https://github.com/bobzhou-source/job-application-harness), MIT License,
Copyright (c) 2026 Robert Zhou: its kinds, its cue words for a stated
deadline and an assessment's link, and its rule that a cue inside a
conditional sentence ("if selected, a recruiter will reach out to schedule an
interview") is boilerplate, not news. The matching follows its
lib/mail/match.mjs: the sender and subject name the employer, never the
body, and the role a subject names rules out another role's Application."""

import html
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum
from urllib.parse import urlsplit

from apply.adapters import Tracker
from apply.gmail import LINK, Mail
from apply.model import Outcome, Status
from apply.tracker import Row


class Kind(StrEnum):
    """What one Employer mail says."""

    CONFIRMATION = "confirmation"  # the Application arrived
    REJECTION = "rejection"
    OA = "online assessment"
    INTERVIEW = "interview invite"
    OTHER = "other"


@dataclass(frozen=True)
class Reading:
    """One mail, read: its kind, and for an online assessment the link that
    starts it and the deadline the mail states (None when it states none)."""

    mail: Mail
    kind: Kind
    link: str | None = None
    deadline: date | None = None


# A verification code, account link or password reset: about signing in, not an Application.
ACCOUNT = re.compile(r"verify your (e-?mail|account|identity)|confirm your (e-?mail( address)?|account|identity)|"
                     r"verification code|one[- ]time (pass)?code|password reset|reset your password|"
                     r"activate your account|security code", re.IGNORECASE)
REJECTION = re.compile(r"unfortunately,? (we|after|at this time|this time|your application|the (position|role))|"
                       r"regret to inform|not (be |to )?mov(e|ing) forward|decided (not )?to (move forward|proceed|pursue) "
                       r"with (other|another)|other candidates (whose|who)|not (been )?selected|no longer (being )?(under )?"
                       r"consider|position has (now )?been filled|will not be (moving|proceeding|advancing|progressing)|"
                       r"move in a different direction|(not able|unable) to offer", re.IGNORECASE)
# An assessment already taken: a mail thanking Lisul for it is no new assessment.
COMPLETED = re.compile(r"thank(s| you) for completing|(assessment|test|challenge) (has been |was )?(completed|submitted|"
                       r"received)|received your (completed )?(assessment|test|challenge|responses)|"
                       r"you have (successfully )?completed (the|your)", re.IGNORECASE)
OA = re.compile(r"\b(online assessment|coding (challenge|assessment|test)|technical assessment|interactive assessment|"
                r"assessments? (request|invitation|link)|hackerrank|codesignal|codility|hirevue|karat|take-?home|"
                r"(complete|take) (the|your|this|an) (online |interactive )?(assessment|challenge|test)s?|"
                r"one-way video interview)\b", re.IGNORECASE)
INTERVIEW_SUBJECT = re.compile(r"\binterview (invitation|request|invite)|invitation to interview|invited to (an? )?interview",
                               re.IGNORECASE)
INTERVIEW = re.compile(r"\b(invite you to (an? )?(interview|phone|video|virtual)|schedule (your|an|a) (interview|phone screen|"
                       r"call)|(select|choose|book|pick) a (time|slot)|phone screen|first[- ]round interview|superday|"
                       r"would (like|love) to (speak|chat|meet|connect) with you|share your availability|"
                       r"let us know your availability)\b", re.IGNORECASE)
# The employer says the application isn't finished: no confirmation, however it is worded.
INCOMPLETE = re.compile(r"complete your (job )?application|finish your application|(application|profile) (is )?(still )?"
                        r"incomplete|not yet (been )?submitted|started an application|yet to submit|"
                        r"complete and submit your (job )?application", re.IGNORECASE)
CONFIRMATION = re.compile(r"thank(s| you) for (applying|your application|submitting|your interest|taking the time to apply)|"
                          r"application (has been |was |is )?(received|submitted|complete)|received your application|"
                          r"we (have )?received|successfully (applied|submitted)", re.IGNORECASE)
CONDITIONAL = re.compile(r"\b(if|should|may|might|once|whether|in the event)\b", re.IGNORECASE)

MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
MONTH = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
CUE = r"(?:by|before|until|no later than|deadline(?: is|:)?|due(?: by| on|:)?|expires?(?: on| in)?|within|valid for|closes?(?: on)?)"
MONTH_DAY = re.compile(rf"\b{CUE}\s+(?:\w+day,?\s+)?{MONTH}\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?", re.IGNORECASE)
NUMERIC = re.compile(rf"\b{CUE}\s+(?:\w+day,?\s+)?(\d{{1,2}})/(\d{{1,2}})(?:/(\d{{2}}|\d{{4}}))?\b", re.IGNORECASE)
SPAN = re.compile(rf"\b{CUE}\s+(?:the next\s+)?(\d{{1,3}}|one|two|three|four|five|six|seven|ten|fourteen)\s+"
                  r"(business days?|days?|hours?|weeks?)\b", re.IGNORECASE)
NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "ten": 10, "fourteen": 14}

LINK_NOISE = re.compile(r"unsubscribe|marketing|newsletter|preferences|opt.?out|privacy|help ?center|terms|facebook|"
                        r"linkedin|twitter|instagram|youtube|glassdoor", re.IGNORECASE)
OA_LINK = re.compile(r"assessment|get started|begin|start|take|hackerrank|codesignal|hirevue|codility|karat|test|challenge",
                     re.IGNORECASE)


def classify(mail: Mail) -> Reading:
    """What `mail` says, first fitting kind first: a sign-in mail is other,
    then a rejection, an online assessment (not one already taken), an
    interview invite, and a confirmation (not of an unfinished application)."""
    words = _plain(mail.text)
    full = f"{mail.subject}\n{words}"
    definite = " ".join(s for s in re.split(r"(?<=[.!?\n])\s+", full) if not CONDITIONAL.search(s))
    if ACCOUNT.search(full):
        return Reading(mail, Kind.OTHER)
    if REJECTION.search(definite):
        return Reading(mail, Kind.REJECTION)
    if OA.search(definite) and not COMPLETED.search(definite):
        return Reading(mail, Kind.OA, _oa_link(mail.text), _deadline(words, mail.arrived))
    if INTERVIEW_SUBJECT.search(mail.subject) or INTERVIEW.search(definite):
        return Reading(mail, Kind.INTERVIEW)
    if CONFIRMATION.search(full) and not INCOMPLETE.search(full):
        return Reading(mail, Kind.CONFIRMATION)
    return Reading(mail, Kind.OTHER)


def _plain(text: str) -> str:
    """A mail's text with its HTML tags dropped and entities decoded."""
    return html.unescape(re.sub(r"<[^>]+>", " ", text))


def _oa_link(text: str) -> str | None:
    """The link that starts the assessment: the one whose label and address
    best fit, never an unsubscribe, legal or social link."""
    best, score = None, 0
    for m in LINK.finditer(text):
        url, label = html.unescape(m[1] or m[3]), _plain(m[2] or "")
        if LINK_NOISE.search(url):
            continue
        fit = 2 * bool(OA_LINK.search(label)) + bool(OA_LINK.search(url))
        if fit > score:
            best, score = url, fit
    return best


def _deadline(words: str, arrived: datetime) -> date | None:
    """The first deadline `words` state after a cue word: a date ("by October
    22, 2026", "due 10/22"), a day without a year being the next such day,
    or a span from the mail's arrival ("expires in 7 days")."""
    words = re.sub(r"\s+", " ", words)
    found = []
    if m := MONTH_DAY.search(words):
        found.append((m.start(), _day(m[3], MONTHS.index(m[1][:3].lower()) + 1, int(m[2]), arrived)))
    if m := NUMERIC.search(words):
        found.append((m.start(), _day(m[3], int(m[1]), int(m[2]), arrived)))
    if m := SPAN.search(words):
        count = int(m[1]) if m[1].isdigit() else NUMBERS[m[1].lower()]
        unit = m[2].lower()
        span = (timedelta(hours=count) if "hour" in unit else timedelta(weeks=count) if "week" in unit
                else timedelta(days=round(count * 1.4)) if "business" in unit else timedelta(days=count))
        found.append((m.start(), (arrived + span).date()))
    found = [(at, day) for at, day in found if day]
    return min(found)[1] if found else None


def _day(year: str | None, month: int, day: int, arrived: datetime) -> date | None:
    try:
        if year:
            return date(int(year) + (2000 if len(year) == 2 else 0), month, day)
        stated = date(arrived.year, month, day)
        return stated if stated >= arrived.date() - timedelta(days=1) else date(arrived.year + 1, month, day)
    except ValueError:
        return None


# Domains many employers send from (job systems, assessment and mail
# platforms): a sender on one says nothing about which employer it is.
SHARED_DOMAINS = {
    "myworkdayjobs.com", "myworkday.com", "workday.com", "greenhouse.io", "greenhouse-mail.io", "lever.co", "ashbyhq.com",
    "icims.com", "smartrecruiters.com", "successfactors.com", "taleo.net", "oraclecloud.com", "oracle.com", "jobvite.com",
    "avature.net", "eightfold.ai", "phenompeople.com", "joinhandshake.com", "applytojob.com", "bamboohr.com",
    "paylocity.com", "rippling.com", "workable.com", "ultipro.com", "adp.com", "hirevue.com", "hackerrank.com",
    "hackerrankforwork.com", "codesignal.com", "codility.com", "karat.io", "sendgrid.net", "amazonses.com",
    "mailgun.org", "gmail.com", "outlook.com", "linkedin.com", "indeed.com",
}
# Words that name no employer ("Pure Storage, Inc." is "Pure Storage").
FILLER = re.compile(r"\b(inc|llc|ltd|corp|corporation|company|co|group|holdings|plc|the|and|of|usa|careers?|jobs|"
                    r"recruiting|recruitment|university|talent|acquisition|team|hr|no|reply|noreply|do|not)\b")
# A subject with one of these names a role.
ROLE = re.compile(r"\b(intern(ship)?|analyst|engineer(ing)?|developer|scientist|associate|co-?op|fellow(ship)?)\b",
                  re.IGNORECASE)
# Title words that tell no two of one employer's roles apart.
COMMON_TITLE_WORDS = {"intern", "internship", "summer", "fall", "spring", "winter", "program", "student",
                      "undergraduate", "2026", "2027", "2028"}
# What an Employer mail suggests came of its Application.
SUGGESTED = {Kind.REJECTION: Outcome.REJECTED, Kind.OA: Outcome.OA, Kind.INTERVIEW: Outcome.INTERVIEW}
# The reason on a Handoff row an Employer mail shows was submitted.
SETTLED = "Submitted: the employer's mail of {} confirms the Application arrived."
# Rows a mail can be about: only an Application that went out, or may have.
SENT = {Status.SUBMITTED, Status.HANDOFF}
# How far back `apply mail` reads, in days, and the Gmail search it reads
# with: recent mail with a word nearly every Employer mail has.
DAYS = 30
SEARCH = "newer_than:{}d {{application applying applied candidacy interview assessment test challenge position role}}"


@dataclass(frozen=True)
class Found:
    """One Employer mail that says something (a kind other than other): the
    row it is surely about, or None when no row is, and whether it settled
    that row, a Handoff, as submitted."""

    reading: Reading
    row: Row | None
    settled: bool = False


def sync(mails: list[Mail], tracker: Tracker) -> list[Found]:
    """Read `mails` oldest first and write what each says to the row it is
    surely about: its Confirmation received, and its Suggested outcome (the
    latest mail's). Any such mail shows the Application arrived, so a Handoff
    row it is about becomes Submitted. Lisul's Outcome is never written."""
    found = []
    for mail in sorted(mails, key=lambda mail: mail.arrived):
        reading = classify(mail)
        if reading.kind == Kind.OTHER:
            continue
        row = match(mail, tracker.rows())
        found.append(Found(reading, row, settled=bool(row) and _write(reading, row, tracker)))
    return found


def match(mail: Mail, rows: list[Row]) -> Row | None:
    """The row `mail` is surely about, or None: the best-named employer must
    be one company, and among its rows the role must pick one."""
    sent = [row for row in rows if row.status in SENT and (not row.date_applied or row.date_applied <= mail.arrived.date())]
    scores = {row.application_id: _employer_score(mail, row) for row in sent}
    best = max(scores.values(), default=0)
    if not best:
        return None
    named = [row for row in sent if scores[row.application_id] == best]
    if len({_words(row.company) for row in named}) > 1:
        return None
    if ROLE.search(mail.subject):
        named = [row for row in named if _role_named(row, _words(mail.subject))]
    if len(named) <= 1:
        return named[0] if named else None
    said = _words(f"{mail.subject} {_plain(mail.text)}")
    hits = {row.application_id: sum(f" {word} " in said for word in _title_words(row)) for row in named}
    top = max(hits.values())
    picked = [row for row in named if hits[row.application_id] == top]
    return picked[0] if top and len(picked) == 1 else None


def _write(reading: Reading, row: Row, tracker: Tracker) -> bool:
    """Write what `reading` says to `row`; True if it settled a Handoff."""
    row = tracker.get(row.application_id)  # as earlier mail left it
    arrived = reading.mail.arrived.date()
    fields = {}
    if not row.confirmation_received:
        fields["confirmation_received"] = arrived
    if (suggested := SUGGESTED.get(reading.kind)) and suggested != row.suggested_outcome:
        fields["suggested_outcome"] = suggested
    settled = row.status == Status.HANDOFF
    if settled:
        fields.update(status=Status.SUBMITTED, date_applied=row.date_applied or arrived, reason=SETTLED.format(arrived))
    if fields:
        tracker.update(row.application_id, **fields)
    return settled


def _employer_score(mail: Mail, row: Row) -> int:
    """How surely the sender and subject name `row`'s employer: 3 for its own
    domain or its job-system tenant, 2 for its name, 0 for neither."""
    name = re.sub(r"<[^>]*>", "", mail.sender).replace('"', "").strip()
    address = (re.search(r"<([^>]+)>", mail.sender) or [None, mail.sender])[1].strip().lower()
    local, _, host = address.partition("@")
    domain = ".".join(host.split(".")[-2:])
    own = domain not in SHARED_DOMAINS
    company = _words(row.company).strip()
    if not company:
        return 0
    if own and _compact(domain.split(".")[0]) in {_compact(company), _own_domain(row)}:
        return 3
    if not own and _compact(local) in _tenants(row):
        return 3
    evidence = f"{name} {domain.split('.')[0] if own else local} {mail.subject}"
    if f" {company} " in _words(evidence) or (len(_compact(company)) >= 6 and _compact(company) in _compact(evidence)):
        return 2
    return 0


def _tenants(row: Row) -> set[str]:
    """The employer's name on its job system, from the Posting's link
    (acme.wd5.myworkdayjobs.com, job-boards.greenhouse.io/acme, jobs.ashbyhq.com/acme)."""
    parts = urlsplit(row.posting_url)
    host, path = (parts.hostname or "").lower(), [p for p in parts.path.split("/") if p]
    if host.endswith(("myworkdayjobs.com", "applytojob.com")):
        return {_compact(host.split(".")[0])}
    if host.endswith(("greenhouse.io", "lever.co", "ashbyhq.com")) and path:
        return {_compact(path[0])}
    return set()


def _own_domain(row: Row) -> str | None:
    """The first label of the Posting's own domain, when it isn't a job system's."""
    host = (urlsplit(row.posting_url).hostname or "").lower()
    domain = ".".join(host.split(".")[-2:])
    return _compact(domain.split(".")[0]) if domain and domain not in SHARED_DOMAINS else None


def _role_named(row: Row, subject: str) -> bool:
    """False if the subject names a role sharing no telling word with `row`'s."""
    words = _title_words(row)
    return not words or any(f" {word} " in subject for word in words)


def _title_words(row: Row) -> list[str]:
    company = set(_words(row.company).split())
    return [w for w in _words(row.role).split() if len(w) >= 4 and w not in COMMON_TITLE_WORDS and w not in company]


def _words(text: str) -> str:
    """Lowercase words, filler words dropped, padded with a space each side."""
    words = re.sub(r"[^a-z0-9]+", " ", text.lower())
    return " " + re.sub(r"\s+", " ", FILLER.sub(" ", words)).strip() + " "


def _compact(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def describe(found: list[Found], read: int, days: int) -> str:
    """What one pass over `read` mails from the last `days` days found, for
    the terminal: each matched mail by row, then the mail no row surely fits,
    for Lisul to check, each online assessment with its link and deadline."""
    lines = [f"Read {read} mails from the last {days} days; {len(found)} say something about an application."]
    for f in [f for f in found if f.row]:
        line = f"{f.row.application_id} ({f.row.company}, {f.row.role}): {f.reading.kind} on {f.reading.mail.arrived:%Y-%m-%d}"
        if suggested := SUGGESTED.get(f.reading.kind):
            line += f"; Suggested outcome {suggested}"
        if f.settled:
            line += "; was a Handoff, now Submitted"
        lines += [line, *_assessment(f.reading)]
    unmatched = [f.reading for f in found if not f.row]
    if unmatched:
        lines.append("Not matched to any application (check these yourself):")
        for r in unmatched:
            lines += [f"  {r.mail.arrived:%Y-%m-%d} {r.kind} from {r.mail.sender}: {r.mail.subject!r}", *_assessment(r)]
    return "\n".join(lines)


def _assessment(reading: Reading) -> list[str]:
    if reading.kind != Kind.OA:
        return []
    due = f"by {reading.deadline}" if reading.deadline else "no deadline stated"
    return [f"    Online assessment ({due}): {reading.link or 'no link found; see the mail'}"]
