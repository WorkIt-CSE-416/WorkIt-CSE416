"""Whether a Posting's own text rules Lisul out: plain rules over the
Posting's description, read before any form opens. Zero tokens.

Lisul is an undergraduate, so a Posting whose required qualifications ask
for current graduate study (a Master's, a PhD, a graduate program) is Not
eligible. Only the required qualifications count: a graduate degree that is
preferred, a bonus or one option among others ("a BS, MS or PhD") rules no
one out. A sentence under no qualifications heading counts only when it
plainly demands it ("Must be enrolled in a PhD program"). An undergraduate's
year of study ("a penultimate-year student") lets him in, and so does graduate
study only planned for later ("planning to go on to a master's")."""

import re

from apply.model import one_line

# Starts the reason of a Posting whose own text asks for graduate study.
GRADUATE_ONLY = "Posting requires graduate study"
OUTSIDE_US = "Posting is outside the US"
# A Posting's own "Location:" line (Greenhouse's offices, see greenhouse.description).
LOCATION_LINE = re.compile(r"(?im)^\s*(?:available )?locations?:\s*(.+)$")
ABROAD = re.compile(
    r"\b(portugal|lisbo[an]|united kingdom|\buk\b|england|scotland|london|ireland|dublin|canada|toronto|vancouver|montreal"
    r"|ontario|quebec|british columbia|\bon\b,? canada|india|bengaluru|bangalore|hyderabad|germany|berlin|munich|france|paris"
    r"|netherlands|amsterdam|spain|madrid|barcelona|poland|warsaw|krakow|switzerland|zurich|sweden|stockholm|denmark"
    r"|copenhagen|israel|tel aviv|singapore|japan|tokyo|australia|sydney|melbourne|mexico|brazil|china|shanghai|beijing"
    r"|hong kong|taiwan|taipei|korea|seoul|romania|czech|prague|serbia|belgrade|estonia|tallinn|uae|dubai)\b",
    re.IGNORECASE)
US_PLACE = re.compile(r"united states|\bu\.?s\.?a?\b", re.IGNORECASE)
US_STATE = re.compile(r", (A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT"
                      r"|V[AT]|W[AIVY])\b")  # as written: "Dublin, CA", never "Lisboa, ca"

# A graduate degree or graduate study.
GRADUATE = re.compile(
    r"master['’]?s|masters|\bmsc\b|\bm\.?eng\b|\bmba\b|ph\.?\s?d|doctoral|doctorate|post-?graduate"
    r"|\bgraduate[\s-]+(student|program|programme|degree|school|study|studies|level)"
    r"|(?-i:\bM\.?S\b)",  # M.S. and MS in capitals; "ms" in prose is something else
    re.IGNORECASE,
)
# The applicant as a student of a degree, or the degree in a field: not a passing mention
# (a benefit that pays for "bachelor's degrees", "our Graduate Program").
STUDYING = re.compile(
    r"enrol|pursu|working toward|attending|current|student|candidate|\bprogram(me)?\b|\bdegree\b|completing"
    r"|in the process|admitted|seeking|matriculat|rising|entering"
    r"|\bin\s+(a\s+)?(computer|cs\b|electrical|engineering|machine|math|statistic|physics|related|technical|data|ai\b|robotics)",
    re.IGNORECASE,
)
# An undergraduate's way in: a bachelor's, or an undergraduate's year ("Rising Junior, Senior, or Graduate student").
UNDERGRADUATE = re.compile(
    r"bachelor|baccalaureate|undergrad|associate['’]?s degree"
    r"|\b(freshman|sophomore|junior|senior)s?\b(?=\s*(,|/|\)|or\b|and\b|year|standing|status|student|$))"  # not "senior leaders"
    r"|(?-i:\bB\.?S\.?(c\b|\b)|\bB\.?A\b|\bB\.?Eng\b)"
    # A year of study (Roku's "a penultimate-year student, or a final-year student planning to go on to a master's"),
    # but not of a graduate degree ("a second-year student in a Master's program").
    r"|\b(penultimate|pre-?final|second[\s-]to[\s-]last|final|last|first|second|third|fourth|1st|2nd|3rd|4th)[\s-]+year"
    r"\s+(students?|undergrad)\b(?![^.;,]{0,30}\b(in|of)\s+((a|an|the|their|your)\s+)?(master|ms\b|m\.s|ph\.?\s?d|doctor"
    r"|graduate|mba))"
    r"|\b(penultimate|pre-?final)[\s-]+year\b|\b(four|4)[\s-]year\s+(degree|program|university|college)",
    re.IGNORECASE,
)
# Graduate study as a plan for later ("planning to go on to a master's", "intend to pursue a PhD"):
# an undergraduate's way in, not a requirement of graduate study now.
LATER = re.compile(
    r"\b(plan(s|ned|ning)?|intend(s|ed|ing)?|go(es|ing)? on|mov(e|es|ing) on|continu(e|es|ing) on|progress(es|ing)?"
    r"|hop(e|es|ing)|aim(s|ing)?|wish(es|ing)?|apply(ing)?|interested in|before (starting|beginning))\b[^.;,]{0,40}?"
    r"(?:" + GRADUATE.pattern + r")",
    re.IGNORECASE,
)
# A bachelor's already earned, asked for on top of graduate study: no way in for an undergraduate,
# unless the same sentence lets one still study for it ("Pursuing or obtained a Bachelor's").
EARNED = re.compile(r"\b(graduated with|required is|holds?|have|has|earned|obtained|completed|possess(es)?)\s+((a|an)\s+)?"
                    r"(bachelor|undergraduate|b\.?s\b)", re.IGNORECASE)
STILL_STUDYING = re.compile(r"(pursu|enrol|working toward|attending|rising|entering)[^.;]{0,40}?(bachelor|undergrad|\bb\.?s\b)",
                            re.IGNORECASE)
# Words that make a sentence a preference or a welcome, not a requirement.
SOFT = re.compile(
    r"\b(also|encouraged|welcome|considered|prefer|preferred|preferably|a plus|pluses|bonus|nice|ideal|ideally|desired"
    r"|desirable|advantage|advantageous|helpful|beneficial|optional|not required)\b"
    r"|equivalent\s+(\w+\s+)?experience",
    re.IGNORECASE,
)
# Sentences about pay or work authorization, which name degrees without asking for one.
ASIDE = re.compile(r"\$|salary|compensation|hourly|per hour|citizen|permanent resident|visa|sponsor|authori[sz]",
                   re.IGNORECASE)
# How a sentence under no qualifications heading plainly asks it of the applicant.
DEMAND = re.compile(
    r"\b(must|required|requires|only|should be)\b|^(currently|enrolled|pursuing|actively|current|you are|you['’]re)\b",
    re.IGNORECASE,
)

# A qualifications heading, by what its section holds.
NOT_REQUIRED = re.compile(r"not required|optional|prefer|nice|bonus|desired|desirable|plus|good to have|ideal"
                          r"|extra credit|stand out|additional qualifications", re.IGNORECASE)
REQUIRED = re.compile(r"minimum|basic|must|required|requirements?|qualifications?|you have|looking for|who you are"
                      r"|about you|you(['’]ll| will)? need|you(['’]ll| will)? bring|eligibility|what it takes", re.IGNORECASE)
HEADING_LENGTH = 60  # characters; a longer line is a sentence, not a heading
HEADING_WORDS = 9
BULLET = re.compile(r"(must|you must|should)\s+(be|have|hold|possess|live|reside|pass|obtain|complete)\b", re.IGNORECASE)
SENTENCE_END = re.compile(r"(?<=[a-z]{2}[.!?])\s+(?=[A-Z])|;\s*")


def not_eligible(text: str) -> str:
    """Why the Posting's own text (from its job system's API, read before its
    form opens) rules Lisul out, or "". No text rules no one out: the form decides."""
    if sentence := graduate_only(text):
        return f"{GRADUATE_ONLY}: {sentence}"
    if places := outside_us(text):
        return f"{OUTSIDE_US}: {places}"
    return ""


def outside_us(text: str) -> str:
    """The places of a Posting whose "Location:" line names only places abroad
    (Cloudflare's Lisbon internship, from a Request: no Feed filter), or "".
    One US place, or no place named ("In-Office"), rules no one out."""
    for line in LOCATION_LINE.findall(text):
        places = [p.strip() for p in re.split(r"[;|]", line) if p.strip()]
        if places and all(ABROAD.search(p) and not (US_PLACE.search(p) or US_STATE.search(p)) for p in places):
            return "; ".join(places)
    return ""


def graduate_only(text: str) -> str:
    """The sentence of a Posting's text (from company.text_of) whose required
    qualifications ask for current graduate study, or "" if none does."""
    sentences: list[tuple[str, str]] = []  # (section, sentence), section "" before any qualifications heading
    section, headed = "", False
    for line in text.splitlines():
        line = line.strip(" \t\u200b·•*-")
        if (kind := _heading(line)) is not None:
            section, headed = kind, headed or kind != "other"
            continue
        head, colon, rest = line.partition(":")
        if colon and (kind := _heading(head + ":")) not in (None, "other"):  # "Required: Enrolled in a PhD program"
            section, headed, line = kind, True, rest
        sentences += [(section, sentence.strip()) for sentence in SENTENCE_END.split(line) if sentence.strip()]
    # Every sentence under a required heading counts, and one under no qualifications heading that plainly demands.
    read = [(s, section == "required") for section, s in sentences if section in ("required", "") or not headed]
    if any(_lets_undergraduates_in(s) for s, _ in read):
        return ""
    asked = (s for s, required in read if (required or DEMAND.search(s)) and _asks_for_graduate_study(s))
    return one_line(next(asked, ""))


def _heading(line: str) -> str | None:
    """What a heading line's section holds: "required", "preferred" or
    "other" (a heading ending in a colon), or None for a line that is no heading."""
    line = line.strip()
    if not line or len(line) > HEADING_LENGTH or len(line.split()) > HEADING_WORDS or line.endswith("."):
        return None
    if GRADUATE.search(line) or BULLET.match(line) and not line.endswith(":"):  # "Must have a 3.0 GPA" is a bullet
        return None
    if NOT_REQUIRED.search(line):
        return "preferred"
    if REQUIRED.search(line):
        return "required"
    return "other" if line.endswith(":") else None


def _lets_undergraduates_in(sentence: str) -> bool:
    return bool(UNDERGRADUATE.search(sentence) and STUDYING.search(sentence)
                and (STILL_STUDYING.search(sentence) or not EARNED.search(sentence)))


def _asks_for_graduate_study(sentence: str) -> bool:
    plain = re.sub(r"\([^)]*\)", "", sentence)  # "(PhD preferred)" doesn't soften the rest
    sentence = LATER.sub(" ", sentence)  # "planning to go on to a master's" asks for no graduate study now
    return bool(
        GRADUATE.search(sentence) and STUDYING.search(GRADUATE.sub(" ", sentence))  # "our Graduate Program" is no study
        and not SOFT.search(plain) and not ASIDE.search(sentence)
    )
