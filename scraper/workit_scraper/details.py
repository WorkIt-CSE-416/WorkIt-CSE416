"""Facts a posting states in its description rather than in a field.

Pay, employment type, work style and years of experience reach the card from a provider's
own field when it has one (`providers`), and from here when it does not. Start term and
visa sponsorship come only from here. Every
pattern reads a statement about *this* role and declines anything less: "not
considering part-time", "less than 2 years" and "$5M raised" are all in real
descriptions, and a wrong fact on the card is worse than "not listed".

Every case in tests/test_details.py was observed in a scraped description, except
the sponsorship guards in `TestConstructedGuards` (see scraper/CLAUDE.md).
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
        """A provider's pay field with its stated period (Ashby, Lever, Workable,
        Recruitee).

        The stated period is trusted, not re-derived from the amount: $7,500 could
        be a week or a month by size alone, and guessing that way dropped every
        monthly and weekly stipend Ashby and Lever sent (Strada's "$7.5K per
        month"). Only an amount impossible for the period is refused.
        """
        period, per = _INTERVAL.get(str(interval), (None, 1))
        found = _amounts(currency, low, high)
        if period is None or found is None:
            return None
        # Persona pays "$7.5K – $8K bi-weekly": the card's week is half of it.
        currency, lo, hi = found[0], found[1] / per, found[2] / per
        if not plausible(period, lo, hi):
            return None
        return cls(currency, lo, hi, period)

    @classmethod
    def from_amounts(cls, currency: object, low: object, high: object, *labels: str) -> Pay | None:
        """A provider's pay field with no period, which only a label or the
        amount's size can tell (Greenhouse's pay ranges)."""
        found = _amounts(currency, low, high)
        if found is None:
            return None
        period = period_for(found[1], found[2], *labels)
        return cls(*found, period) if period else None


#: How Ashby and Lever spell a pay period, and how many card periods it spans.
#: Workable's `salary_frequency` and Recruitee's `salary.period` are the bare word.
_INTERVAL = {
    "hour": ("hour", 1),
    "week": ("week", 1),
    "month": ("month", 1),
    "year": ("year", 1),
    "1 HOUR": ("hour", 1),
    "1 WEEK": ("week", 1),
    "2 WEEK": ("week", 2),
    "1 MONTH": ("month", 1),
    "1 YEAR": ("year", 1),
    "per-hour-wage": ("hour", 1),
    "per-week-salary": ("week", 1),
    "per-month-salary": ("month", 1),
    "per-year-salary": ("year", 1),
}


def _amounts(currency: object, low: object, high: object) -> tuple[str, float, float] | None:
    amounts = [float(v) for v in (low, high) if isinstance(v, int | float) and v > 0]
    if not amounts or not isinstance(currency, str) or not currency:
        return None
    return currency.upper(), min(amounts), max(amounts)


@dataclass(frozen=True, slots=True)
class Facts:
    """The card's facts about one posting, each None when nothing states it.

    `work_style` and `job_type` are what the posting itself states; `shortlist`
    may still infer either for the card when it is None.
    """

    job_type: str | None = None
    work_style: str | None = None
    pay: Pay | None = None
    min_years: int | None = None
    #: When an internship starts: "Summer 2027", "2027". See `start_term`.
    start_term: str | None = None
    #: What the posting says about visas: "sponsors", "no_sponsorship" or
    #: "citizens_only". See `sponsorship`.
    sponsorship: str | None = None

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
        sponsorship=sponsorship(title, text),
    )


SYMBOL = {"$": "USD", "€": "EUR", "£": "GBP"}
# A dollar sign's country, when the posting writes one in front of it: "CA$40".
DOLLAR_PREFIX = {"CA": "CAD", "C": "CAD", "AU": "AUD", "A": "AUD", "S": "SGD", "US": "USD"}
CODES = ("USD", "EUR", "GBP", "CAD", "AUD", "SGD", "CHF")

# Thousands grouped by "," or by "." ("34.000 EUR"); a "." before exactly two
# digits is cents ("$40.00").
_NUMBER = r"(\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:\.\d+)?)\s*([kK])?"
_CODE = r"(USD|EUR|GBP|CAD|AUD|SGD|CHF)"
_RANGE_TO = r"\s*(?:-|–|—|to)\s*"
_PAY = re.compile(
    rf"(?:(?<![A-Za-z])(CA|AU|US|C|A|S)(?=\$))?([$€£])\s?{_NUMBER}"
    rf"(?:{_RANGE_TO}(?:[A-Z]{{0,2}}[$€£])?\s?{_NUMBER})?"
    r"(?P<tail>[^.\n]{0,40})",
)
# The same with a currency code instead of a symbol: "800 USD monthly",
# "34.000 - 38.000 EUR", "USD 110,000 - 140,000".
_PAY_CODE = re.compile(
    rf"\b(?:{_CODE}\s?)?{_NUMBER}(?:{_RANGE_TO}{_NUMBER})?\s*(?:{_CODE}\b)?"
    r"(?P<tail>[^.\n]{0,40})",
)
# Funding, revenue and headcount use the same symbols as pay.
_NOT_PAY = re.compile(r"\s*(?:m|mm|b|bn|million|billion|trillion|\+)\b", re.I)
# Money just before which is not this role's pay.
_NOT_PAY_BEFORE = re.compile(
    r"\b(?:save[sd]?|saving|budget|401|match|limit|revenue|raised|funding|allowance"
    r"|reimburse\w*|worth|valuation|benefit of)\b[^.\n]{0,40}$",
    re.I,
)
_PAID = re.compile(
    r"salary|pay|compensation|wage|rate|stipend|base|range|earn|pro rata|gross", re.I
)
# A period right after an amount says it is pay, whatever labels it:
# "Intern/Undergraduate: $34/hour", "$30-$50 per hour subject to taxes".
_PERIOD_AFTER = re.compile(
    r"^\s*(?:USD|CAD|EUR|GBP|SGD|AUD)?\s*(?:per\s+(?:hour|week|month|year|annum)|an?\s+(?:hour|week|month|year)"
    r"|/\s*(?:h(?:ou)?r|w(?:ee)?k|mo(?:nth)?|y(?:ea)?r)\b|hourly|weekly|monthly|annually)",
    re.I,
)
_PERIOD = (
    ("hour", re.compile(r"per\s+hour|an\s+hour|/\s*h(?:ou)?r\b|\bhourly\b", re.I)),
    ("week", re.compile(r"per\s+week|a\s+week|/\s*w(?:ee)?k\b|\bweekly\b", re.I)),
    ("month", re.compile(r"per\s+month|a\s+month|/\s*mo(?:nth)?\b|\bmonthly\b", re.I)),
    ("year", re.compile(r"per\s+(?:year|annum)|a\s+year|/\s*y(?:ea)?r\b|\bannual", re.I)),
)


def _amount(digits: str, thousands: str | None) -> float:
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", digits):
        digits = digits.replace(".", "")
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


def _candidates(text: str):
    """(start, currency, low, high, tail) for every amount written with a symbol
    or a currency code, in the order they appear."""
    found = []
    for m in _PAY.finditer(text):
        prefix, symbol, low, low_k, high, high_k, tail = m.groups()
        # The code after the amount ("$34-$36/hour CAD") or just before the symbol
        # ("CAD $30-50/hour").
        code = next(
            (
                c
                for c in CODES
                if re.search(rf"\b{c}\b", tail + " " + text[max(0, m.start() - 5) : m.start()])
            ),
            None,
        )
        currency = code or (DOLLAR_PREFIX[prefix] if prefix else SYMBOL[symbol])
        found.append((m.start(), currency, (low, low_k), (high, high_k), tail))
    for m in _PAY_CODE.finditer(text):
        pre, low, low_k, high, high_k, post, tail = m.groups()
        if pre or post:
            found.append((m.start(), pre or post, (low, low_k), (high, high_k), tail))
    return sorted(found, key=lambda f: f[0])


def pay(text: str | None) -> Pay | None:
    """The first amount the description offers as pay for this role."""
    text = text or ""
    for start, currency, (low, low_k), (high, high_k), tail in _candidates(text):
        if _NOT_PAY.match(tail):
            continue
        lo = _amount(low, low_k or high_k)
        hi = _amount(high, high_k) if high else lo
        # "€55-65,000" and "$5-10k": the low end is written short.
        if high and lo < 1000 <= hi and lo * 1000 <= hi and not low_k:
            lo *= 1000
        if hi < lo:
            continue
        before = text[max(0, start - 60) : start]
        if _NOT_PAY_BEFORE.search(before):
            continue
        # A label is only near enough to speak for the amount on its own line or
        # the one before it: "Hourly Rate:\n$50—$50 USD".
        label = "\n".join(before.split("\n")[-2:])
        if not (_PAID.search(label + tail) or _PERIOD_AFTER.match(tail)):
            continue
        period = period_for(lo, hi, tail, label)
        if period is None:
            continue
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
        # SingleStore "Employment Status: Full-time"; Sezzle "#Full-time"; Stripe
        # "Must be available to start full-time".
        ("full_time", r"\b(?:employment|job|position)\s+(?:status|type)\s*:\s*full[- ]?time\b"),
        ("part_time", r"\b(?:employment|job|position)\s+(?:status|type)\s*:\s*part[- ]?time\b"),
        (
            "full_time",
            r"#full[- ]?time\b|\b(?:start|begin)\s+full[- ]time\b(?!\s+(?:work\s+)?experience)",
        ),
        ("part_time", r"#part[- ]?time\b"),
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
    # "Regular" and Greenhouse's "Employee-Regular": a permanent, full-time hire.
    if "fulltime" in text or text.endswith("regular"):
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
        (
            "Remote",
            rf"{_THIS_ROLE}remote\b|\bfully remote\s+(?:role|position|internship)\b"
            # Axon: "Location: Remote anywhere in Australia"; Docugami: "will
            # primarily be remote".
            r"|\blocation\s*:\s*remote\b|\b(?:will|would)\s+(?:primarily\s+)?be\s+(?:fully\s+)?remote\b",
        ),
        (
            "Hybrid",
            rf"{_THIS_ROLE}hybrid\b|\bhybrid\s+(?:role|position|schedule|work|model|arrangement)\b"
            r"|\b[1-4]\s*days?\s*(?:a|per)\s*week\s*(?:in|at)\s*(?:the|our)?\s*office\b"
            # Profluent "Hybrid: 2–3 days on-site per week"; NISC "Hybrid from one of
            # our office locations"; WPP, Geotab, CTC: a hybrid approach/working model.
            r"|\bhybrid\s*(?::|from\b)"
            r"|\bhybrid\s+(?:approach|working\s+model|workplace\s+model|work\s+model)\b"
            r"|\b[1-4](?:\s*[-–]\s*[1-4])?\s*days?\s+"
            r"(?:on[- ]?site|in[- ]office|in[- ]person)\s+(?:a|per)\s+week\b"
            # Roblox "onsite Tuesday, Wednesday, and Thursday, with optional presence
            # on Monday"; Axon "onsite Tuesday through Friday and remote on Mondays".
            r"|\bon[- ]?site\s+(?:on\s+)?(?:mon|tue|wed|thu|fri)\w*day\b"
            r"(?!\s*(?:-|–|to|through)\s*friday)"
            # Dev Technology: "commute to the Reston, Virginia office a minimum of 2 days a week".
            r"|\boffice\s+(?:a\s+minimum\s+of\s+|at\s+least\s+|around\s+)?(?:[1-4]|one|two|three|four)"
            r"(?:\s*[-–]\s*[1-4])?\s+days?\s+(?:a|per)\s+week\b",
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
            r"|\bnot\s+(?:considering|offering|open\s+to)\s+remote\b"
            # SpaceX "Able to work full time, onsite"; Amperesand "Available to work
            # on-site"; CoVar "In-person in Durham, NC"; Stripe "working in person
            # from Stripe's San Francisco or Seattle office".
            r"|\bwork(?:ing)?\s+(?:full[- ]time,?\s+)?on[- ]?site\b"
            r"|\bin[- ]person\s+in\s+[A-Z]|\bworking\s+in\s+person\s+from\b",
        ),
    )
)


# LinkedIn's location tags, which employers paste into postings on purpose.
_LI_TAG = re.compile(r"#LI[-_ ]?(on[- ]?site|hybrid|remote)\b", re.I)


def work_style(text: str | None) -> str | None:
    """Remote, Hybrid or On site when the description says which this role is.

    Only sentences about the role: "a remote-first company" and "hybrid cloud"
    say nothing about where this intern sits. A LinkedIn tag ("#LI-Hybrid") is
    the employer's own label and wins. Hybrid beside On site is Hybrid -- in
    the office some days ("in-office on a hybrid schedule, 3 days per week",
    Lyft); any other two answers are no answer.
    """
    text = text or ""
    if tag := _LI_TAG.search(text):
        word = tag[1].lower()
        return "Remote" if word == "remote" else "Hybrid" if word == "hybrid" else "On site"
    stated = {label for label, pattern in _WORK_STYLE if pattern.search(text)}
    if stated == {"Hybrid", "On site"}:
        return "Hybrid"
    return stated.pop() if len(stated) == 1 else None


_YEARS = re.compile(
    # "~1yr of work experience" (Synack), "0-2 years' experience" (Akuna),
    # "1-4 years as a professional software developer" (Rover).
    r"(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*(?:years?|yrs?)['’]?"
    r"\s+(?:of\s+)?((?:[\w/&+,()'’-]+\s+){0,6}?)"
    r"(?:experience|exp|as\s+an?\s+(?:professional|software|data|engineer|developer))\b",
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
    # and Compeer's "the summer of 2027".
    re.compile(rf"\b{_SEASON}(?:\s*(?:/|or|and|&|,)\s*{_SEASON})?\s*(?:of\s+)?'?\s*{_YEAR}", re.I),
    # Waymo's "2027 Summer Intern"
    re.compile(rf"\b20(\d\d)\s+{_SEASON}\b", re.I),
)
_START_MONTH = re.compile(
    rf"\b(?:start(?:ing|s)?(?:\s+date)?|begin(?:ning|s)?)\b[^.\n]{{0,30}}?\b{_MONTH}\s+(?:\d{{1,2}}(?:st|nd|rd|th)?,?\s+)?20(\d\d)\b",
    re.I,
)
_TITLE_YEAR = re.compile(r"\b20(\d\d)\b")
# Nanopath's "Software Development Co-op (Jan '27)".
_TITLE_MONTH = re.compile(rf"\b{_MONTH}\s*(?:'|20)(\d\d)\b", re.I)
# The first month of a list that ends in a year: Datadog "beginning in February,
# March, April, May, or June 2027"; Monzo "between June and September 2027".
_MONTH_LIST = re.compile(
    rf"\b(?:start\w*|begin\w*|between|from)\s+(?:in\s+)?{_MONTH}"
    r"(?:[^.\n]{0,50}?)\b20(\d\d)\b",
    re.I,
)
# No year anywhere, only the month or season: TensorWave "May - August (12
# weeks)", Acron "run May through August", Shift "start your internship around
# August 31", ZipRecruiter "As a summer intern", Brave "Remote - Fall Semester".
_BARE_MONTH = re.compile(
    rf"\b{_MONTH}(?:\s+\d{{1,2}}(?:st|nd|rd|th)?)?\s*(?:-|–|—|to|through|until)\s*"
    rf"(?:{'|'.join(m[:3] for m in _MONTHS)})[a-z]*\b"
    rf"|\bstart\w*\b[^.\n]{{0,30}}?\b(?:in|around|on)\s+{_MONTH}",
    re.I,
)
_BARE_SEASON = re.compile(
    rf"(?<!non-)(?<!non )\b{_SEASON}(?:\s*/\s*{_SEASON})?\s+"
    r"(?:intern(?:ship)?s?|semester|term|co-?op|cohort|program)\b",
    re.I,
)
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
    r"graduat|deadline|clos(?:e|ing)|apply|applications?|expected|earned|degree"
    r"|\blease\b|\blicen[cs]e\b|\bvisa\b|\bvalid\b",
    re.I,
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
    # A range in the title starts at its first month: "(January- August 2027)",
    # "Jan - Dec 2027" -- never the "August 2027" at its end.
    if term := _work_period(title, guarded=False):
        return term
    if month := next((m for m in _TITLE_MONTH.finditer(title) if _near(m[2])), None):
        return f"{_month_name(month[1])} 20{month[2]}"
    year = next((m[1] for m in _TITLE_YEAR.finditer(title) if _near(m[1])), None)
    title_year = f"20{year}" if year else None
    # The description may name the season, but not a different cohort's.
    for term in (
        _season_term(text or "", guarded=True),
        _start_month(text or ""),
        _work_period(text or ""),
        _month_list(text or ""),
    ):
        if term and (title_year is None or term.endswith(title_year)):
            return term
    # Only a month or a season, with no year of its own: the title's, if it has one.
    if bare := _bare_term(text or ""):
        return f"{bare} {title_year}" if title_year else bare
    if title_year:
        return title_year
    # "Software Engineering Intern (Summer)": the season, with no year to give.
    season = _TITLE_SEASON.search(title)
    return (
        None if season is None else ("Fall" if season[1].lower() == "autumn" else season[1].title())
    )


def _month_name(abbreviation: str) -> str:
    return next(m for m in _MONTHS if m.lower().startswith(abbreviation.lower()))


def _month_list(text: str) -> str | None:
    for match in _MONTH_LIST.finditer(text):
        if _NOT_THE_TERM.search(text[max(0, match.start() - 50) : match.end()]):
            continue
        if _near(match[2]):
            return f"{_month_name(match[1])} 20{match[2]}"
    return None


def _bare_term(text: str) -> str | None:
    """A start month or the internship's season, named without a year."""
    found = []
    for pattern in (_BARE_MONTH, _BARE_SEASON):
        for match in pattern.finditer(text):
            if _NOT_THE_TERM.search(text[max(0, match.start() - 50) : match.end()]):
                continue
            word = next(g for g in match.groups() if g)
            if pattern is _BARE_MONTH:
                found.append((match.start(), _month_name(word)))
            else:
                found.append((match.start(), "Fall" if word.lower() == "autumn" else word.title()))
            break
    return min(found)[1] if found else None


def _work_period(text: str, *, guarded: bool = True) -> str | None:
    """The first month of a work period. `guarded` skips application and
    graduation dates -- in a description; a title's "Applications" is a team."""
    for match in _PERIOD_RANGE.finditer(text):
        if guarded and _NOT_THE_TERM.search(text[max(0, match.start() - 50) : match.start()]):
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


#: What a posting can say about visas, strongest first: when it says more than
#: one, the first wins. A "no" anywhere outweighs a "yes", and citizens only is
#: the strictest "no".
SPONSORSHIP = ("citizens_only", "no_sponsorship", "sponsors")

_US = r"(?:US|United\s+States|American)"
# The rest of a US-person list ("US citizen, lawful permanent resident, ..."):
# a green card holder qualifies, so it is not citizens only.
_OR_RESIDENT = (
    r"[^.]{0,80}?\b(?:permanent\s+residen\w*|green\s+card|protected\s+individual|asylee|refugee"
    # "must be U.S. citizens, U.S. nationals, or U.S. persons (i.e., ...)"
    r"|US\s+persons?\b)"
)
# A US clearance. A bare "security clearance" can be the UK's or Australia's. The
# abbreviations are case-sensitive ("join us", "John Doe"), and customs clearance
# is a shipment's, not a person's.
_CLEARANCE = (
    r"\b(?:(?-i:US|TS|SCI|DoD|DOD|DOE|Q)|secret|top[- ]secret|polygraph|poly)\b[^.]{0,30}?"
    r"(?<!Public\sTrust\s)(?<!customs\s)\bclearance\b"
)
_REQUIRED = r"\b(?:must|require[sd]?|requiring|requirement|condition\s+of\s+employment)\b"
_CITIZENS_ONLY = re.compile(
    rf"\b{_US}\s+citizenship\s+(?:is\s+)?(?:required|a\s+requirement|mandatory)\b"
    rf"|\brequire[sd]?\s+(?:\w+\s+){{0,2}}?{_US}\s+citizenship\b"
    rf"|\b(?:must|required\s+to)\s+(?:be|hold|have)\s+(?:an?\s+)?{_US}\s+citizen(?:s|ship)?\b"
    rf"(?!{_OR_RESIDENT})"
    rf"|\b{_US}\s+citizens?\s+only\b"
    # Not Proto Labs' "only open to US Citizens, lawful permanent residents ...".
    rf"|\bonly\s+(?:\w+\s+){{0,2}}?{_US}\s+citizens\b(?!{_OR_RESIDENT})"
    # Requirement lists without a verb: "US Citizenship and ability to get a US
    # Security Clearance" (MORSE), "Work authorization: US citizen" (CoVar).
    rf"|^\W*(?:currently\s+an?\s+)?{_US}\s+citizen(?:ship)?\b(?!{_OR_RESIDENT})"
    rf"|\bauthori[sz]ation\s*:\s*{_US}\s+citizen\b"
    # "Active TS/SCI clearance with Polygraph required", "requires eligibility to
    # obtain and maintain a US security clearance"; and Palantir's verbless "Active
    # US Security clearance, or eligibility and willingness to obtain" under "What We
    # Require".
    rf"|{_CLEARANCE}[^.]{{0,40}}?{_REQUIRED}|{_REQUIRED}[^.]{{0,60}}?{_CLEARANCE}"
    rf"|^\W*(?:active|current|hold|holding|eligib\w*|ability|able)\b[^.]{{0,40}}?{_CLEARANCE}"
    # "Clearance: Secret level required", "Required Clearance: Top Secret".
    r"|\bclearance\s*:\s*(?:active\s+)?(?:secret|top[- ]secret|TS|SCI)\b",
    re.I,
)
# Said of a clearance or citizenship, these make it something other than a
# requirement of this role: "is a plus but not required", "may be required
# depending on program", Palantir's "For USG: ..." beside "For all other roles".
_NOT_REQUIRED = re.compile(
    r"\b(?:plus|preferred|bonus|nice|desired|not\s+required|may\s+be\s+required|may\s+require"
    r"|differential)\b|^\W*for\s+[^:]{1,30}:"
    # "U.S. citizenship is not a requirement", "No US citizenship required".
    r"|\bnot\s+(?:be\s+)?(?:an?\s+)?(?:requirement|necessary|needed|mandatory)\b"
    rf"|\bno\s+(?:{_US}\s+)?citizenship\b",
    re.I,
)
# A heading over a list: "What We Require", "Preferred Qualifications", "Bonus skills".
_HEADING = re.compile(
    r"^\W*(?:[A-Za-z/&' -]{0,30}\s)?(?:qualifications?|requirements?|require[ds]?|preferred"
    r"|bonus|nice[- ]to[- ]haves?|must[- ]haves?|skills|clearance|value[sd]?)\b"
    r"[\w\s/&'()-]{0,25}:?\s*$",
    re.I,
)
# A list item, never a heading: a bulleted line, or one that ends by grading
# itself in lower case ("Python skills a plus", "PE license is preferred") -- not
# "Strongly Preferred" or "What Is Required", and not "What would be a plus:".
_ITEM = re.compile(
    r"^\s*[-*•·▪◦–]|\S\s+(?:(?:is\s+)?an?\s+)?(?:plus|bonus|preferred|desired|required)[^\w:]*$"
)
# A heading in capitals names no keyword but still ends the list above it
# ("WHAT VALINOR OFFERS").
_CAPS_HEADING = re.compile(r"^[^a-z]*[A-Z]{2}[^a-z]*$")
# "What We Value" is Palantir's optional list; "Our Values" is a company's
# values, optional only when it heads a list ("Values:").
_PREFERRED_HEADING = re.compile(
    r"\b(?:preferred|bonus|nice|plus|desired|valued?)\b|\bvalues\s*:", re.I
)

_SPONSOR = r"sponsor(?:ship|s|ing)?\b"  # not "company-sponsored events"
# Needing a sponsorship, which is the candidate's side of it.
_NEEDS = r"\b(?:require[sd]?|requiring|need|needs|needing)\b"
_NO_SPONSORSHIP = re.compile(
    # "We are not able to sponsor visas or take over sponsorship", "will not
    # sponsor", "unable to provide sponsorship"; but Samaya's "aren't able to
    # successfully sponsor visas for every role" follows "We do sponsor visas!".
    # Not across a comma ("Don't worry, we sponsor visas"), and not "whether or not".
    r"(?<!\bor\s)\b(?:not|unable|cannot|can't|won't|don't|doesn't|aren't|isn't|never"
    r"|no\s+longer)\b"
    rf"[^.,;]{{0,40}}?\b{_SPONSOR}(?![^.]{{0,40}}\bfor\s+every\b)"
    # Roblox: "may not be able to employ candidates ... or support future H-1B sponsorship".
    rf"|\bmay\s+not\s+be\s+able\s+to\b[^.]{{0,150}}?\b{_SPONSOR}"
    # Not a condition: "how it degrades when sponsorship is unavailable" is gas fees.
    r"|(?<!\bwhen\s)(?<!\bif\s)\bsponsorship\b[^.]{0,30}?\b(?:(?:is\s+not|isn't|not)\s+(?:be\s+)?"
    r"(?:available|provided|offered|possible)|unavailable)\b"
    r"|\bsponsorship\s*:\s*(?:no|not|none|n/a)\b"
    r"|\bno\s+(?:visa\s+|immigration\s+|H-?1-?B\s+)?sponsorship\b"
    # "authorized to work in the US without current or future sponsorship", but
    # not "without regard to sponsorship status".
    rf"|\bwithout\b(?!\s+regard\b)[^.]{{0,60}}?\b{_SPONSOR}"
    # "Candidates who require visa sponsorship will not be considered".
    rf"|{_NEEDS}[^.]{{0,40}}?\b{_SPONSOR}[^.]{{0,40}}?"
    r"\b(?:not\s+(?:be\s+)?(?:considered|eligible|accepted)|ineligible)\b",
    re.I,
)
# A US person (ITAR): a citizen, a permanent resident or a protected individual.
# No visa holder is one, so requiring it is a "no", unless the posting offers
# an export licence instead (`_EXPORT_LICENCE`).
_US_PERSON = re.compile(
    rf"{_REQUIRED}[^.]{{0,100}}?\b{_US}\s+persons?\b|\bonly\s+hire\b[^.]{{0,20}}\bUS\s+persons?\b"
    rf"|\bUS\s+persons?\b(?:\s+status)?[^.]{{0,60}}?{_REQUIRED}|\bqualify\s+as\s+a\s+US\s+person\b"
    # Also "open only to U.S. citizens or Green Card holders" (Skydio, Proto Labs).
    rf"|(?:(?:{_REQUIRED}|\bonly\b)[^.]{{0,80}}?|^\W*){_US}\s+citizens?(?:hip)?\b{_OR_RESIDENT}",
    re.I,
)
# Before a US-person requirement, these make it some other role's or a maybe:
# "Certain roles may require US Person status", Kodiak's "Should the position
# require ... US person status".
_HYPOTHETICAL = re.compile(
    r"\b(?:may|might|should\s+the)\b|\b(?:certain|some)\s+(?:roles|positions)\b", re.I
)
_EXPORT_LICENCE = re.compile(
    r"\b(?:eligible|obtain)\w*\b[^.]{0,100}?\b(?:export\s+(?:control\s+)?licen[sc]\w*"
    r"|export\s+authori[sz]ation|required\s+authori[sz]ations?)",
    re.I,
)
_SPONSORS = re.compile(
    # A benefits list's "- Visa Sponsorship"; "Kodiak may provide visa sponsorship";
    # "Ambrook can support visa sponsorship (OPT/CPT, TN, J-1)".
    r"\b(?:visa|immigration|H-?1-?B)\s+sponsorships?\b"
    # "We do sponsor and take over sponsorship of employment visas", "happy to
    # sponsor international candidates", "sponsor Visa's if needed".
    rf"|\b{_SPONSOR}\s+(?:\w+\s+){{0,3}}?(?:visas?\b|visa's|H-?1-?B"
    r"|international\s+(?:candidates|students|applicants))"
    r"|\bsponsorship\s+is\s+(?:available|offered|provided)\b|\bsponsorship\s*:\s*yes\b",
    re.I,
)
# Before a sponsorship and in its clause, a need makes it the candidate's
# ("candidates who require sponsorship"); after it, or past a comma, the offer
# stands ("we sponsor visas for candidates who need them", "preferred but not
# required, can sponsor visas").
_NEEDS_BEFORE = re.compile(rf"{_NEEDS}[^,;]*$", re.I)
# Anywhere with it, another role's ("available for selected roles").
_OTHER_ROLES = re.compile(r"\b(?:selected|certain|some)\s+(?:roles|positions)\b", re.I)
# OPT and CPT are the student's own authorization: "Visa sponsorship is limited to
# OPT/CPT" offers nothing else. Whole capitalised words, never "optimised".
_OPT = re.compile(r"\b(?:OPT|CPT)\b")
_ONLY = re.compile(r"\bonly\b|\blimited\s+to\b|\brestricted\s+to\b", re.I)
# A visa beside them that is the employer's to sponsor: Ambrook's "(OPT/CPT, TN,
# J-1)", Jump Trading's "eligible for CPT/OPT and we sponsor work visas".
_OTHER_VISA = re.compile(
    r"\b(?:(?-i:H-?1-?B|TN|J-?1|O-?1|E-?3|L-?1)|(?:work|employment)\s+visas?)\b", re.I
)
# Jump Trading posts "we sponsor work visas for full-time positions" on its
# internships too, which CPT or OPT covers: an intern's card says nothing. A
# season marks an internship that never says "intern" ("Summer Analyst"); a year
# alone does not, since new-grad titles carry one too.
_FULL_TIME_ONLY = re.compile(r"\bfor\s+(?:our\s+)?full[- ]time\s+(?:positions|roles|hires)\b", re.I)
_INTERN_TITLE = re.compile(
    r"\bintern(?:ship)?s?\b|\bco-?op\b|\b(?:summer|fall|autumn|winter|spring)\b", re.I
)
# IMC sponsors, except for "candidates who currently have citizenship from
# Russia, Belarus or Iran": a rule for some nationalities says nothing of the rest.
_SOME_NATIONALITIES = re.compile(r"\bcitizenship\s+from\b|\bRussia\b|\bBelarus\b|\bIran\b", re.I)
# Sponsoring an export licence is not sponsoring a visa.
_EXPORT = re.compile(r"\bexport\s+licen[sc]\w*", re.I)

# "U.S." would end a sentence early, and so would "U.S.C." in a statute; "U.S
# citizen" drops the second dot.
_US_DOTTED = re.compile(r"\bU\.\s?S\.\s?C\.|\bU\.\s?S\b\.?(?:\s?A\.)?", re.I)
_SENTENCE = re.compile(r"[^.!?\n]+[.!?]?")
#: How far past a US-person requirement an export licence offered instead may sit:
#: about a sentence, since "22 C.F.R. § 120.62" splits Hermeus's in pieces.
_LICENCE_REACH = 300


def sponsorship(title: str, text: str | None) -> str | None:
    """What the description says about visas, read sentence by sentence.

    `citizens_only`: US citizenship, or a US security clearance (which needs it),
    is required. `no_sponsorship`: the role will not sponsor a visa, or requires
    the applicant to be a US person (citizen, permanent resident or protected
    individual) with no export licence offered instead. `sponsors`: it says it
    does. None when it says nothing usable, OPT and CPT included: they are a
    student's own authorization, not the employer's sponsorship.
    """
    text = _US_DOTTED.sub(lambda m: "USC" if m[0][-2:].upper() == "C." else "US", text or "")
    licence_offered = _licence_offered(text)
    stated = set()
    for match in _SENTENCE.finditer(text):
        sentence = match[0].strip()
        if _SOME_NATIONALITIES.search(sentence):
            continue
        if (
            _CITIZENS_ONLY.search(sentence)
            and not _NOT_REQUIRED.search(sentence)
            and not _under_preferred(text, match.start())
        ):
            stated.add("citizens_only")
        elif (_NO_SPONSORSHIP.search(sentence) and not _EXPORT.search(sentence)) or (
            (person := _US_PERSON.search(sentence))
            and not licence_offered
            and not _HYPOTHETICAL.search(sentence[: person.end()])
        ):
            stated.add("no_sponsorship")
        elif (offer := _SPONSORS.search(sentence)) and not (
            _NEEDS_BEFORE.search(sentence[: offer.start()])
            or _OTHER_ROLES.search(sentence)
            or _opt_only(sentence)
            or (_FULL_TIME_ONLY.search(sentence) and _INTERN_TITLE.search(title))
        ):
            stated.add("sponsors")
    return next((value for value in SPONSORSHIP if value in stated), None)


def _opt_only(sentence: str) -> bool:
    """Whether the sponsorship a sentence offers is OPT or CPT and nothing more."""
    return bool(_OPT.search(sentence)) and bool(
        _ONLY.search(sentence) or not _OTHER_VISA.search(sentence)
    )


def _licence_offered(text: str) -> bool:
    """Whether the posting offers an export licence in place of being a US person.

    The offer has to follow a US-person requirement, in its sentence or just
    after it -- SpaceX's ITAR paragraph -- and then it answers every such
    requirement in the posting, SpaceX's "Basic Qualifications" bullet included.
    A licence anywhere else is some other licence ("Help our customers obtain
    export licenses").
    """
    return any(
        _EXPORT_LICENCE.search(text, m.start(), m.end() + _LICENCE_REACH)
        for m in _SENTENCE.finditer(text)
        if _US_PERSON.search(m[0].strip())
    )


def _under_preferred(text: str, start: int) -> bool:
    """Whether the list a line sits in is headed as optional ("Preferred
    Qualifications", "Bonus skills") rather than required. Only the nearest
    heading counts: "Additional Information:" ends the preferred list above it."""
    for line in reversed(text[:start].split("\n")[:-1]):
        if len(line) > 45 or _ITEM.search(line):
            continue
        if line.rstrip().endswith(":") or _HEADING.match(line) or _CAPS_HEADING.match(line):
            return bool(_PREFERRED_HEADING.search(line))
    return False
