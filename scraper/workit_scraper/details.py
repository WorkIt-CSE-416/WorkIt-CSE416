"""Facts a posting states in its description rather than in a field.

Pay, employment type, work style and years of experience reach the card from a provider's
own field when it has one (`providers`), and from here when it does not. Every
pattern reads a statement about *this* role and declines anything less: "not
considering part-time", "less than 2 years" and "$5M raised" are all in real
descriptions, and a wrong fact on the card is worse than "not listed".

Every case in tests/test_details.py was observed in a scraped description.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

# A month or a week is how many internships pay, so neither is converted to a
# year: $8,000 a month for twelve weeks is not $96,000 a year.


@dataclass(frozen=True, slots=True)
class Pay:
    currency: str
    low: float
    high: float
    period: str

    @classmethod
    def from_interval(
        cls, currency: object, low: object, high: object, interval: object
    ) -> Pay | None:
        """A provider's pay field with its stated period (Ashby, Lever).

        The stated period is trusted, not re-derived from the amount: $7,500 could
        be a week or a month by size alone, and guessing that way dropped every
        monthly and weekly stipend Ashby and Lever sent (Strada's "$7.5K per
        month"). Only an amount impossible for the period is refused.
        """
        period = _INTERVAL.get(str(interval))
        found = _amounts(currency, low, high)
        if period is None or found is None or not plausible(period, found[1], found[2]):
            return None
        return cls(*found, period)

    @classmethod
    def from_amounts(cls, currency: object, low: object, high: object, *labels: str) -> Pay | None:
        """A provider's pay field with no period, which only a label or the
        amount's size can tell (Greenhouse's pay ranges)."""
        found = _amounts(currency, low, high)
        if found is None:
            return None
        period = period_for(found[1], found[2], *labels)
        return cls(*found, period) if period else None


#: How Ashby and Lever spell a pay period.
_INTERVAL = {
    "1 HOUR": "hour",
    "1 WEEK": "week",
    "1 MONTH": "month",
    "1 YEAR": "year",
    "per-hour-wage": "hour",
    "per-week-salary": "week",
    "per-month-salary": "month",
    "per-year-salary": "year",
}


def _amounts(currency: object, low: object, high: object) -> tuple[str, float, float] | None:
    amounts = [float(v) for v in (low, high) if isinstance(v, int | float) and v > 0]
    if not amounts or not isinstance(currency, str) or not currency:
        return None
    return currency.upper(), min(amounts), max(amounts)


@dataclass(frozen=True, slots=True)
class Facts:
    """The card's facts about one posting, each None when nothing states it.

    `work_style` is what the posting itself states; `shortlist` may still infer
    one for the card when it is None.
    """

    job_type: str | None = None
    work_style: str | None = None
    pay: Pay | None = None
    min_years: int | None = None
    #: When an internship starts: "Summer 2027", "2027". See `start_term`.
    start_term: str | None = None

    @classmethod
    def from_row(cls, row: dict) -> Facts:
        pay = row.get("pay")
        return cls(**{**row, "pay": Pay(**pay) if pay else None})


def read(
    title: str,
    text: str | None,
    *,
    stated_type: str | None = None,
    stated_style: str | None = None,
    stated_pay: Pay | None = None,
) -> Facts:
    """A posting's facts: the provider's own fields first, its whole description
    second. Give it the whole text -- pay is often the last thing a posting says,
    past where the stored description is cut."""
    return Facts(
        job_type=stated_type or job_type(text),
        work_style=stated_style or work_style(text),
        pay=stated_pay or pay(text),
        min_years=min_years(text),
        start_term=start_term(title, text),
    )


SYMBOL = {"$": "USD", "€": "EUR", "£": "GBP"}
# A dollar sign's country, when the posting writes one in front of it: "CA$40".
DOLLAR_PREFIX = {"CA": "CAD", "C": "CAD", "AU": "AUD", "A": "AUD", "S": "SGD", "US": "USD"}
CODES = ("USD", "EUR", "GBP", "CAD", "AUD", "SGD", "CHF")

_NUMBER = r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?"
_PAY = re.compile(
    rf"(?:(?<![A-Za-z])(CA|AU|US|C|A|S)(?=\$))?([$€£])\s?{_NUMBER}"
    rf"(?:\s*(?:-|–|—|to)\s*(?:[A-Z]{{0,2}}[$€£])?\s?{_NUMBER})?"
    r"(?P<tail>[^.\n]{0,40})",
)
# Funding, revenue and headcount use the same symbols as pay.
_NOT_PAY = re.compile(r"\s*(?:m|mm|b|bn|million|billion|trillion|\+)\b", re.I)
_PAID = re.compile(r"salary|pay|compensation|wage|rate|stipend|base|range|earn", re.I)
_PERIOD = (
    ("hour", re.compile(r"per\s+hour|an\s+hour|/\s*h(?:ou)?r\b|\bhourly\b", re.I)),
    ("week", re.compile(r"per\s+week|a\s+week|/\s*w(?:ee)?k\b|\bweekly\b", re.I)),
    ("month", re.compile(r"per\s+month|a\s+month|/\s*mo(?:nth)?\b|\bmonthly\b", re.I)),
    ("year", re.compile(r"per\s+(?:year|annum)|a\s+year|/\s*y(?:ea)?r\b|\bannual", re.I)),
)


def _amount(digits: str, thousands: str | None) -> float:
    return float(digits.replace(",", "")) * (1000 if thousands else 1)


def _stated_period(text: str) -> str | None:
    return next((period for period, pattern in _PERIOD if pattern.search(text)), None)


def plausible(period: str, low: float, high: float) -> bool:
    """Whether an amount reads as pay for that period at all.

    Samsara labels "$38—$58 USD" an "Annual Base Salary"; no early-career role
    pays $38 a year, so the label is wrong and the amount is hourly.
    """
    floor, ceiling = {
        "hour": (7, 500),
        "week": (200, 10_000),
        "month": (800, 40_000),
        "year": (10_000, 1_000_000),
    }[period]
    return floor <= low <= high <= ceiling


def period_for(low: float, high: float, *labels: str) -> str | None:
    """The period a label states, else the one its size leaves no doubt about.

    Only hours and years are inferred from size alone: $45 is an hourly rate and
    $120,000 an annual salary, but $4,000 could be a week or a month.
    """
    for label in labels:
        period = _stated_period(label)
        if period and plausible(period, low, high):
            return period
    for period in ("hour", "year"):
        if plausible(period, low, high):
            return period
    return None


def pay(text: str | None) -> Pay | None:
    """The first amount the description offers as pay for this role."""
    for match in _PAY.finditer(text or ""):
        prefix, symbol, low, low_k, high, high_k, tail = match.groups()
        if _NOT_PAY.match(tail):
            continue
        lo = _amount(low, low_k)
        hi = _amount(high, high_k) if high else lo
        if hi < lo:
            continue
        before = text[max(0, match.start() - 60) : match.start()]
        # A label is only near enough to speak for the amount on its own line or
        # the one before it: "Hourly Rate:\n$50—$50 USD".
        label = "\n".join(before.split("\n")[-2:])
        if not _PAID.search(label + tail):
            continue
        period = period_for(lo, hi, tail, label)
        if period is None:
            continue
        code = next((code for code in CODES if re.search(rf"\b{code}\b", tail + before)), None)
        currency = code or (DOLLAR_PREFIX[prefix] if prefix else SYMBOL[symbol])
        return Pay(currency=currency, low=lo, high=hi, period=period)
    return None


#: A noun the sentence has to be about, so "full-time employees" (a benefits
#: blurb) and "a future full-time offer" do not read as this role's terms.
_ROLE = (
    r"(?:(?:paid|summer|fall|spring|winter)\s+)*"
    r"(?:intern(?:ship)?|role|position|co-?op|opportunity|employment|program|job)\b"
)
_HOURS = r"(?:\s*\(\s*\d+\s*(?:-\s*)?(?:hrs?|hours?)\s*(?:/|per|a)\s*week\s*)?"
_THIS_IS = r"\b(?:this|it|role|position|internship) is (?:a )?"
_JOB_TYPE = tuple(
    (kind, re.compile(pattern, re.I))
    for kind, pattern in (
        ("full_time", rf"\bfull[- ]time\b{_HOURS}\s*,?\s*{_ROLE}"),
        ("full_time", rf"{_THIS_IS}full[- ]time\b"),
        ("part_time", rf"\bpart[- ]time\b{_HOURS}\s*,?\s*{_ROLE}"),
        ("part_time", rf"{_THIS_IS}part[- ]time\b"),
        ("contract", r"\bcontract(?:-to-hire)?\s+(?:role|position|engagement|assignment)\b"),
        ("contract", r"\b(?:independent\s+)?contractor\s+(?:role|position)\b|\b1099\b"),
    )
)
# Written just before a statement, these make it about some other job: "not
# considering part-time", "full-time or part-time", "post-internship
# opportunities (full-time or part-time)", "convert to a full-time role".
_ELSEWHERE = re.compile(
    r"(?:\bnot?\b|\bor\b|/|\bfuture\b|\bconver\w*|\breturn\b|\bpost-internship\b"
    r"|\bafter\b|\bpermanent\b|\boffers?\b|\bincluding\b)[^.\n]{0,25}$",
    re.I,
)
_OPTIONS = re.compile(r"\b(?:full|part)[- ]time\s*(?:or|/|,)\s*(?:full|part)[- ]time\b", re.I)


def job_type(text: str | None) -> str | None:
    """`full_time`, `part_time` or `contract` when the description states exactly one."""
    if not text or _OPTIONS.search(text):
        return None
    stated = set()
    for kind, pattern in _JOB_TYPE:
        for match in pattern.finditer(text):
            if not _ELSEWHERE.search(text[max(0, match.start() - 40) : match.start()]):
                stated.add(kind)
    return stated.pop() if len(stated) == 1 else None


def job_type_label(value: object) -> str | None:
    """A provider's own employment-type field, in the schema's terms.

    Ashby sends `FullTime|PartTime|Contract|Intern|Temporary`, Lever free text
    ("Full-time", "Intern"), Greenhouse whatever a board named its custom field.
    "Intern" says nothing about hours, so it is None and the description decides.
    """
    text = re.sub(r"[\s_-]", "", str(value or "")).lower()
    if "fulltime" in text or text == "regular":
        return "full_time"
    if "parttime" in text:
        return "part_time"
    if text.startswith("contract"):
        return "contract"
    return None


_THIS_ROLE = r"\b(?:this|the)\s+(?:role|position|internship|job)\s+is\s+(?:fully\s+|100%\s+)?"
# Labels, as `providers._work_style` makes them.
_WORK_STYLE = tuple(
    (label, re.compile(pattern, re.I))
    for label, pattern in (
        ("Remote", rf"{_THIS_ROLE}remote\b|\bfully remote\s+(?:role|position|internship)\b"),
        (
            "Hybrid",
            rf"{_THIS_ROLE}hybrid\b|\bhybrid\s+(?:role|position|schedule|work|model|arrangement)\b"
            r"|\b[1-4]\s*days?\s*(?:a|per)\s*week\s*(?:in|at)\s*(?:the|our)?\s*office\b",
        ),
        (
            "On site",
            rf"{_THIS_ROLE}(?:on[- ]?site|in[- ]office|in[- ]person)\b"
            r"|\b(?:fully|100%)\s+(?:on[- ]?site|in[- ]office|in[- ]person)\b"
            r"|\bin[- ]office\s+(?:5|five)\s+days\b"
            # Sigma: "We have an in-office work environment in all our offices".
            r"|\bin[- ]office\s+(?:work\s+)?(?:environment|culture|company|team)\b"
            r"|\b(?:on[- ]?site|in[- ]person|in[- ]office)\s+(?:role|position|internship|job)\b"
            r"|\bin[- ]person\s+(?:at|in|from)\s+(?:our|the)\b"
            r"|\b(?:must|required to|expected to|need to)\s+(?:be\s+|work\s+)?"
            r"(?:on[- ]?site|in[- ]person|in\s+(?:the\s+)?office)\b"
            r"|\bnot\s+(?:a\s+)?remote\b|\bno\s+remote\b"
            r"|\bnot\s+(?:considering|offering|open\s+to)\s+remote\b",
        ),
    )
)


def work_style(text: str | None) -> str | None:
    """Remote, Hybrid or On site when the description says which this role is.

    Only sentences about the role: "a remote-first company" and "hybrid cloud"
    say nothing about where this intern sits. Two answers are no answer.
    """
    stated = {label for label, pattern in _WORK_STYLE if pattern.search(text or "")}
    return stated.pop() if len(stated) == 1 else None


_YEARS = re.compile(
    r"(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?"
    r"\s+(?:of\s+)?((?:[\w/&+,()'’-]+\s+){0,6}?)(?:experience|exp)\b",
    re.I,
)
# A ceiling, not a requirement: "less than 2 years of full-time work experience".
_CEILING = re.compile(r"(?:less than|fewer than|no more than|under|up to|maximum of)\s*$", re.I)
_NOT_WORK = re.compile(r"\b(?:education|school\w*|degree|university|college|age|old)\b", re.I)


def min_years(text: str | None) -> int | None:
    """The smallest number of years of experience the description requires.

    The smallest because a posting often lists alternatives ("5+ years, or 3+
    with a Master's"), and the bar a candidate has to clear is the lowest.
    """
    found = []
    for match in _YEARS.finditer(text or ""):
        years, between = int(match[1]), match[2]
        before = text[max(0, match.start() - 20) : match.start()]
        if years > 15 or _CEILING.search(before) or _NOT_WORK.search(between):
            continue
        found.append(years)
    return min(found, default=None)


_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
# Any 20xx (or '27); `_near` keeps only years a cohort could plausibly start in,
# so the patterns never need editing as the calendar moves.
_YEAR = r"(?:20)?(\d\d)\b"
_SEASON = r"(winter|spring|summer|fall|autumn)"
_MONTH = rf"({'|'.join(m[:3] for m in _MONTHS)})[a-z]*\.?"
_TERM = (
    # "Summer 2027", "Fall '26", "Summer/Fall 2027" (the first named)
    re.compile(rf"\b{_SEASON}(?:\s*(?:/|or|and|&|,)\s*{_SEASON})?\s*'?\s*{_YEAR}", re.I),
    # Waymo's "2027 Summer Intern"
    re.compile(rf"\b20(\d\d)\s+{_SEASON}\b", re.I),
)
_START_MONTH = re.compile(
    rf"\b(?:start(?:ing|s)?(?:\s+date)?|begin(?:ning|s)?)\b[^.\n]{{0,30}}?\b{_MONTH}\s+(?:\d{{1,2}}(?:st|nd|rd|th)?,?\s+)?20(\d\d)\b",
    re.I,
)
_TITLE_YEAR = re.compile(r"\b20(\d\d)\b")
_TITLE_SEASON = re.compile(rf"\b{_SEASON}\b", re.I)
# A work period: "January 2027 to June 2027", "Jan 2027 - August 2027",
# "May 24 - Aug 20, 2027", "JUNE – AUGUST 2026". The first month is the start.
_DAY = r"(?:\s+\d{1,2}(?:st|nd|rd|th)?)?"
_PERIOD_RANGE = re.compile(
    rf"\b{_MONTH}{_DAY},?\s*(?:20(\d\d))?\s*(?:-|–|—|to|through|until)\s*"
    rf"(?:{'|'.join(m[:3] for m in _MONTHS)})[a-z]*\.?{_DAY},?\s+20(\d\d)\b",
    re.I,
)
# Dates that are not the internship's: when to graduate, when to apply by.
_NOT_THE_TERM = re.compile(
    r"graduat|deadline|clos(?:e|ing)|apply|applications?|expected|earned|degree", re.I
)


def _near(two_digits: str) -> bool:
    """A start year a posting today could mean: last year through three ahead.
    "Founded in 2015" and "graduating 2031" are not this cohort."""
    this_year = date.today().year
    return this_year - 1 <= 2000 + int(two_digits) <= this_year + 3


def start_term(title: str, text: str | None) -> str | None:
    """When an internship starts: "Summer 2027", "Fall 2026", "January 2027", "2027".

    The title speaks first -- "Software Engineer Intern (2027)" is the employer's
    own label for the cohort -- and a season in the title beats a year alone.
    Then the description: a season and year ("our Summer 2027 cohort") or a start
    month ("starting January 4, 2027"). A year found only in a description says
    nothing on its own: it is as likely a founding date or a graduation year.
    """
    if term := _season_term(title):
        return term
    year = next((m[1] for m in _TITLE_YEAR.finditer(title) if _near(m[1])), None)
    title_year = f"20{year}" if year else None
    # The description may name the season, but not a different cohort's.
    for term in (
        _season_term(text or "", guarded=True),
        _start_month(text or ""),
        _work_period(text or ""),
    ):
        if term and (title_year is None or term.endswith(title_year)):
            return term
    if title_year:
        return title_year
    # "Software Engineering Intern (Summer)": the season, with no year to give.
    season = _TITLE_SEASON.search(title)
    return (
        None if season is None else ("Fall" if season[1].lower() == "autumn" else season[1].title())
    )


def _work_period(text: str) -> str | None:
    for match in _PERIOD_RANGE.finditer(text):
        if _NOT_THE_TERM.search(text[max(0, match.start() - 50) : match.start()]):
            continue
        if not _near(match[2] or match[3]):
            continue
        month = next(m for m in _MONTHS if m.lower().startswith(match[1].lower()))
        return f"{month} 20{match[2] or match[3]}"
    return None


def _start_month(text: str) -> str | None:
    match = next((m for m in _START_MONTH.finditer(text) if _near(m[2])), None)
    if not match:
        return None
    month = next(m for m in _MONTHS if m.lower().startswith(match[1].lower()))
    return f"{month} 20{match[2]}"


def _season_term(source: str, *, guarded: bool = False) -> str | None:
    """The first season and year named. `guarded` skips one that is a graduation
    or a deadline ("graduate between Autumn 2027 and Summer 2028")."""
    matches = sorted(
        (m.start(), i, m) for i, pattern in enumerate(_TERM) for m in pattern.finditer(source)
    )
    for start, kind, match in matches:
        if guarded and _NOT_THE_TERM.search(source[max(0, start - 50) : start]):
            continue
        season, year = (match[1], match[3]) if kind == 0 else (match[2], match[1])
        if not _near(year):
            continue
        season = "Fall" if season.lower() == "autumn" else season.title()
        return f"{season} 20{year}"
    return None
