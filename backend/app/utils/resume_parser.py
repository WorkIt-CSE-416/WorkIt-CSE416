import json
import re
from datetime import date
from pathlib import Path

import ftfy  # fix broken unicode

from app.models.dto import (
    Award,
    Certification,
    Education,
    Experience,
    ParsedResume,
    Project,
    Skill,
)

# Constants
MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

MONTH = r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*'

YEAR = r'(\d{4})'

# REGEX
DATE_RANGE_RE = re.compile(
    rf'(?:({MONTH})\s+)?{YEAR}\s*[–\-—]\s*(Present|Current|Now|(?:({MONTH})\s+)?{YEAR})',
    re.IGNORECASE,
)
# "Expected May 2027", "Expected Graduation: May 2027", "Anticipated Grad Date May 2027"
EXPECTED_RE = re.compile(
    rf'(?:Expected|Anticipated)(?:\s+(?:Graduation|Grad\.?)(?:\s+Date)?)?\s*:?\s*({MONTH})\s+{YEAR}',
    re.IGNORECASE,
)
# Bare "Month Year" ending a line or a "|" field — no range, no "Expected"
BARE_DATE_RE = re.compile(rf'({MONTH})\s+{YEAR}\s*(?=\||$)', re.IGNORECASE | re.MULTILINE)

# Section headings, from career-center guides (KAN-348). One term is one
# section's name; a heading is terms joined by "&" or "and", and may end in
# any one word ("Skills & Abilities"). The first term decides the section
# (`_section_name`). A heading the parser does not know is no section: its
# text joins the section above it, which made a lab and a paper read as
# schools.
_PREFIX = (
    r'(?:Work|Professional|Research|Relevant|Related|Career\s+Related|Additional|Other|'
    r'Internship|Technical|Engineering|Industry|Teaching|Clinical|Freelance|Academic|'
    r'Volunteer|Leadership|Management|Software|Previous|Selected)'
)
_TERM = (
    r'(?:'
    # jobs and lab roles
    rf'(?:{_PREFIX}\s+(?:&|and)\s+)?(?:{_PREFIX}\s+)?Experiences?|'
    r'Internships?|Employment(?:\s+History)?|Work\s+History|Professional\s+Background|Research|'
    # papers, which import keeps as projects
    r'(?:Research\s+)?Publications?|Papers|(?:Conference\s+)?Presentations|Patents|'
    # clubs, activities and volunteering
    r'Leadership|Extracurricular\s+Activities|Extracurriculars|'
    r'(?:Campus|Community|Athletic)\s+Involvement|Involvement|Activities|'
    r'Volunteer(?:ing|\s+Work)?|Community\s+(?:Service|Engagement)|'
    r'(?:Professional\s+)?(?:Affiliations|Memberships)|(?:Student\s+)?Organizations|Athletics|'
    r'Education|Educational\s+(?:Background|Qualifications)|Academic\s+Background|'
    r'(?:Professional\s+)?Training|(?:Relevant\s+)?Coursework|Relevant\s+Courses|'
    r'(?:(?:Personal|Academic|Technical|Engineering|University|Course|Related\s+Course|'
    r'Selected|Side|Research|Software|Independent|Class)\s+)?Projects?|Portfolio|Hackathons|'
    r'(?:Technical\s+|Core\s+)?Skills(?:\s+Summary)?|Technologies|Technical\s+Proficiencies|'
    r'(?:Core\s+)?Competencies|(?:Programming\s+)?Languages|Tools|'
    r'(?:Professional\s+)?Certifications?|Certificates|Licenses|'
    r'Awards?|Honors?|Achievements|Scholarships|Recognition|'
    # found but not saved
    r'(?:Professional\s+)?Summary|Summary\s+of\s+Qualifications|Qualifications|'
    r'(?:Career\s+)?Objective|Profile|About\s+Me|Interests|Hobbies|'
    r'Additional\s+Information|References|Other'
    r')'
)
SECTION_RE = re.compile(rf'{_TERM}(?:\s+(?:&|and)\s+{_TERM})*(?:\s+(?:&|and)\s+\w+)?', re.IGNORECASE)
COURSEWORK_RE = re.compile(r'(?:Relevant\s+)?(?:Coursework|Courses)\b', re.IGNORECASE)
# "E X P E R I E N C E": one letter at a time, words two spaces apart
_SPACED_RE = re.compile(r'[A-Za-z](?: [A-Za-z&])+(?:\s{2,}[A-Za-z](?: [A-Za-z&])+)*')

# "GPA: 3.81/4.00" gives the scale too
GPA_RE = re.compile(r'GPA[:\s]*(\d+(?:\.\d+)?)(?:\s*/\s*(\d+(?:\.\d+)?))?', re.IGNORECASE)
DEGREE_RE = re.compile(
    # A.A./A.S. need the dot, or the word "as" would count as a degree
    r'\b(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|A\.A\.?|A\.S\.?|Ph\.?D\.?|'
    # the whole "Bachelor of Science", not just "Bachelor"
    r"(?:Bachelor|Master)(?:'?s)?(?:\s+of\s+(?:Applied\s+Science|Fine\s+Arts|Business\s+Administration|"
    r'Science|Arts|Engineering|Technology))?|Associate|Doctorate|'
    r'(?:High\s+School\s+)?Diploma|GED)\b',
    re.IGNORECASE,
)
INSTITUTION_RE = re.compile(r'\b(?:University|College|School|Institute|Academy)\b', re.IGNORECASE)
DEGREE_FIELD_RE = re.compile(
    r'\b(?:B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|A\.A\.?|A\.S\.?|Ph\.?D\.?|Bachelor\w*|Master\w*)'
    r'(?:\s+of\s+\w+)?(?:\s+in\s+|,\s*)([^|;,\n]+)',
    re.IGNORECASE,
)
# catch bullet points; a hyphen before a digit is a minus sign ("-20%"), not one
BULLET_RE = re.compile(r'^\s*(?:[•▪●◦·]|-(?!\d))\s*')
URL_RE = re.compile(r'https?://\S+|github\.com/\S+', re.IGNORECASE)

# ponytail: keyword list — add words as real resumes expose gaps
ROLE_KEYWORDS = re.compile(
    r'\b(?:Engineer|Developer|Intern|Manager|Director|Analyst|Designer|Architect|'
    r'Researcher|Fellow|Assistant|Associate|Lead|Senior|Junior|'
    r'Coordinator|Specialist|Consultant|Administrator|Scientist|'
    r'Officer|President|Head|Chief|Technician|Scribe|Support|'
    r'Advisor|Tutor|Representative|Operator|Strategist)\b',
    re.IGNORECASE,
)

# US state/territory codes for location detection (US only for now)
US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC", "PR", "GU", "VI", "AS", "MP",
}
# City is 1-2 words (caps-initial, may contain periods/hyphens), then ", ST"
LOCATION_RE = re.compile(r'([A-Z][\w.\-]*(?:\s+[A-Z][\w.\-]*){0,1},\s*([A-Z]{2}))\s*$')

def parse_resume(raw_text: str) -> ParsedResume | None:
    """
    Split resume into sections and parse each section
    individually with specific parsers
    """
    text = _clean_text(raw_text)
    sections = _split_sections(text)
    if not sections:
        return None
    return ParsedResume(
        education=_parse_education(sections.get("education", "")),
        experience=_parse_experience(sections.get("experience", "")),
        skills=_parse_skills(sections.get("skills", "")),
        # the bank has no Publications section: a paper is a project (KAN-348)
        projects=_parse_projects(sections.get("projects", ""))
        + _parse_publications(sections.get("publications", "")),
        certifications=_parse_certifications(sections.get("certifications", "")),
        # club roles read like jobs: organization, role, dates, bullets
        leadership=_parse_experience(sections.get("leadership", "")),
        awards=_parse_awards(sections.get("awards", "")),
    )

def count_sections(text: str) -> int:
    """How many section headers sit on lines of their own — the extractor
    uses this to tell which PDF extraction mode kept the structure intact."""
    return sum(1 for line in text.splitlines() if section_of(line))


def section_of(line: str) -> str | None:
    """The section a heading line names ("experience", or the heading itself
    for a section import does not save), or None for a body line. The rules
    decide first; a heading they miss is looked up in the learned labels."""
    s = heading_form(line)
    if not s:
        return None
    if SECTION_RE.fullmatch(s):
        return _section_name(s)
    label = LEARNED.get(learned_key(s))
    if label is None or label == "none":
        return None
    # a section import does not save keeps its own name, as with the rules
    return learned_key(s) if label == "other" else label


def heading_form(line: str) -> str:
    """A line as a heading reads once its format is off, or "" for a bullet."""
    s = line.strip()
    # a bullet is a body line, whatever it says
    if not s or s.startswith("•"):
        return ""
    if _SPACED_RE.fullmatch(s):
        s = " ".join(word.replace(" ", "") for word in re.split(r"\s{2,}", s))
    # "Education:", "EXPERIENCE ____", "— Experience —", "■ Experience", "01 Experience"
    s = re.sub(r"^[^A-Za-z]+|[^A-Za-z]+$", "", s)
    # "Honors / Awards" is "Honors & Awards"
    return re.sub(r"\s*/\s*", " & ", s)


def learned_key(heading: str) -> str:
    return " ".join(heading.casefold().split())


# Headings no rule names, labeled once by a model from a reviewed word list
# (app/scripts/label_resume_headings.py, the scraper's learned headings for
# resumes). A committed file, never a call at upload: ADR 0003 keeps the
# model off a resume the student has not asked it to read.
LEARNED_PATH = Path(__file__).with_name("learned_headings.json")
# the sections import reads, "other" for one it does not save, "none" for no heading
LEARNED_LABELS = (
    "education", "experience", "leadership", "awards", "skills", "projects",
    "certifications", "publications", "other", "none",
)


def _load_learned() -> dict[str, str]:
    if not LEARNED_PATH.exists():
        return {}
    labels = json.loads(LEARNED_PATH.read_text(encoding="utf-8")).get("labels", {})
    return {learned_key(heading): label for heading, label in labels.items() if label in LEARNED_LABELS}


LEARNED = _load_learned()


def _clean_text(text: str) -> str:
    # use library to clean up text
    text = ftfy.fix_text(text)
    text = re.sub(r'[▪●◦·]', '•', text)
    # U+223C TILDE OPERATOR, which resume fonts often lack: "∼120ms"
    text = text.replace('∼', '~')
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# Split sections so each category is parsed individually by its own parser
def _split_sections(text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}             # store text based on sections
    lines: list[str] | None = None                  # text before the first header goes
    for line in text.splitlines():
        name = section_of(line)
        if name:
            # two headers can name one section (Experience, Research Experience):
            # keep both, or the second replaces the first
            lines = sections.setdefault(name, [])
            # the school's parser finds its courses by this label, and its
            # colon carries the list on the next line onto it
            if COURSEWORK_RE.match(heading_form(line)):
                lines.append(heading_form(line) + ":")
        elif lines is not None:
            lines.append(line)
    return {name: "\n".join(body).strip() for name, body in sections.items()}


# Which section a heading's first term names, checked in this order: each
# word comes before a later one it shares a heading with ("Research
# Projects" are projects, "Leadership Experience" is no job, "Coursework"
# holds "work")
_SECTION_WORDS = [
    ("publications", ("publication", "paper", "presentation", "patent")),
    ("projects", ("project", "portfolio", "hackathon")),
    ("leadership", ("leadership", "activit", "extracurricular", "involvement", "volunteer",
                    "community", "affiliation", "membership", "organization", "athletic")),
    ("awards", ("award", "honor", "achievement", "scholarship", "recognition")),
    ("certifications", ("certif", "license")),
    ("education", ("education", "coursework", "course", "training", "academic background")),
    # a lab role reads like a job: organization, role, dates, bullets
    ("experience", ("experience", "internship", "employment", "work", "background", "research")),
    ("skills", ("skill", "technolog", "proficienc", "competenc", "language", "tool")),
]


def _section_name(heading: str) -> str:
    # the first part decides: "Experience & Leadership" is Experience
    first = re.split(r"\s+(?:&|and)\s+", heading.lower())[0]
    for name, words in _SECTION_WORDS:
        if any(w in first for w in words):
            return name
    # a section import does not save keeps its own name ("hobbies")
    return " ".join(heading.lower().split())


def _month_to_int(month_str: str) -> int:
    return MONTH_MAP.get(month_str[:3].lower(), 1)


def _to_date(year: str, month: str | None) -> date | None:
    return date(int(year), _month_to_int(month) if month else 1, 1)


def _parse_date_range(text: str) -> tuple[date | None, date | None]:
    m = EXPECTED_RE.search(text)
    if m:
        return None, _to_date(m.group(2), m.group(1))
    m = DATE_RANGE_RE.search(text)
    if not m:
        # Bare "Month Year" with no range — treat as end date only
        b = BARE_DATE_RE.search(text)
        if b:
            return None, _to_date(b.group(2), b.group(1))
        return None, None
    start = _to_date(m.group(2), m.group(1))
    # keep present as null
    if m.group(3).lower() in ("present", "current", "now"):
        return start, None
    return start, _to_date(m.group(5), m.group(4))


def _extract_location(text: str) -> tuple[str | None, str]:
    """Extract 'City, ST' from the end of a line. Returns (location, remainder).
    Tries multi-space separator first (common in PDF extraction), then falls
    back to regex-only matching at the end of the line."""
    # Pass 1: multi-space separator (PDF extraction preserves these).
    # City words are single-space separated so the match starts at the last gap.
    ms = re.search(r'\s{2,}([\w.]+(?: [\w.]+)*,\s*([A-Z]{2}))\s*$', text)
    if ms and ms.group(2) in US_STATES:
        location = ms.group(1).strip()
        remainder = text[:ms.start()].strip().rstrip("|–—-").strip()
        return location, remainder
    # "Remote" after a PDF gap is the location too
    ms = re.search(r'\s{2,}(Remote|Hybrid)\s*$', text, re.IGNORECASE)
    if ms:
        return ms.group(1), text[:ms.start()].strip().rstrip("|–—-").strip()
    # Pass 2: constrained end-of-line match (1-2 word city)
    m = LOCATION_RE.search(text)
    if m and m.group(2) in US_STATES:
        location = m.group(1).strip()
        remainder = text[:m.start()].strip().rstrip("|–—-").strip()
        return location, remainder
    return None, text


def _is_header_line(line: str) -> bool:
    """A header line (company/org name) starts with an uppercase letter.
    Bullet continuations from PDF line-wrapping start lowercase."""
    stripped = line.strip()
    if not stripped or BULLET_RE.match(stripped):
        return False
    return stripped[0].isupper()


def _has_date(line: str) -> bool:
    return bool(DATE_RANGE_RE.search(line) or EXPECTED_RE.search(line) or BARE_DATE_RE.search(line))


def _strip_dates(line: str) -> str:
    # also drops a "|" left dangling where the dates were ("Title | May 2024")
    return BARE_DATE_RE.sub("", DATE_RANGE_RE.sub("", line)).strip().rstrip(",|–—-").strip()


def split_tools(text: str) -> tuple[str, list[str]]:
    """"Name | C++, Python": a list after the last bar is the tools, and the
    name keeps what comes before it ("Robot | Club| C++, Go" keeps "Robot |
    Club"). A single phrase there is a subtitle ("WorkIt | Recruiting
    Platform") and stays in the name."""
    head, bar, tools = text.rpartition("|")
    if bar and "," in re.sub(r'\(.*?\)', '', tools) and not URL_RE.search(tools):
        return head.strip(), [t.strip() for t in tools.split(",") if t.strip()]
    return text, []


def _split_title_company(text: str) -> tuple[str, str] | None:
    """'Title | Company' or 'Company | Title' — the role keyword decides
    which side is the title; with no keyword on either side, title first."""
    parts = [p.strip() for p in text.split("|")]
    if len(parts) != 2 or not all(parts):
        return None
    if ROLE_KEYWORDS.search(parts[1]) and not ROLE_KEYWORDS.search(parts[0]):
        return parts[1], parts[0]
    return parts[0], parts[1]


def _is_bare_date_line(line: str) -> bool:
    """Only dates, plus maybe a location — the entry's title and company sit
    on the lines above it rather than beside the date."""
    return not _extract_location(_strip_dates(line))[1]


def _header_start(lines: list[str], anchor: int) -> int:
    """First line of the entry whose date line is lines[anchor]. Usually one
    header line (company/org); two when the date line is bare (Title /
    Company / Dates). PDF extraction wraps long bullets into continuation
    lines that lack a bullet marker — looking further back risks pulling
    those fragments in as the company name."""
    start = anchor
    # a dated line above is its own entry, not this one's header
    if anchor > 0 and _is_header_line(lines[anchor - 1]) and not _has_date(lines[anchor - 1]):
        start -= 1
        # a "Title | Company" line already holds both
        if (_is_bare_date_line(lines[anchor]) and start > 0
                and not _split_title_company(lines[start])
                and _is_header_line(lines[start - 1])
                and not lines[start - 1].rstrip().endswith(".")):
            start -= 1
    return start


def _split_entries(text: str) -> list[list[str]]:
    """
    Split a section into entries. Each date-bearing non-bullet line anchors an entry.
    Non-bullet, non-date lines immediately before a date line are that entry's header.
    """
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    # Find indices of date-bearing lines.
    # Full date ranges (Jan 2024 - Dec 2024) are always anchors.
    # Bare dates (May 2025) need the header check — PDF continuation
    # lines like "completing the rollout by May 2025" are NOT anchors.
    anchors: list[int] = []
    for i, ln in enumerate(lines):
        if BULLET_RE.match(ln):
            continue
        if (DATE_RANGE_RE.search(ln) or EXPECTED_RE.search(ln)
                or (BARE_DATE_RE.search(ln) and _is_header_line(ln))):
            anchors.append(i)

    if not anchors:
        # No dates found — return everything as one entry
        return [lines]

    entries: list[list[str]] = []
    for ai, anchor in enumerate(anchors):
        # everything before the first anchor is its header
        header_start = 0 if ai == 0 else _header_start(lines, anchor)
        # Content: everything after this anchor up to the next entry's header
        if ai + 1 < len(anchors):
            content_end = _header_start(lines, anchors[ai + 1])
        else:
            content_end = len(lines)

        entries.append(lines[header_start:content_end])

    return entries


def _bullets(lines: list[str]) -> str | None:
    """Join bullet lines and their PDF-wrapped continuations."""
    # Some PDFs draw bullets as shapes, so no marker reaches the text. Then a
    # line that opens a new sentence after a full stop starts a new item: any
    # line not starting lowercase, so "-20% churn" or "3 launches" counts.
    has_markers = any(BULLET_RE.match(ln.strip()) for ln in lines if ln.strip())
    parts: list[str] = []
    for ln in lines:
        stripped = ln.strip()
        if not stripped:
            continue
        if BULLET_RE.match(stripped):
            parts.append(BULLET_RE.sub("", stripped).strip())
        elif not has_markers and (not parts or (parts[-1].endswith(".") and not stripped[0].islower())):
            parts.append(stripped)
        elif parts:
            # Continuation of previous bullet (PDF line wrap)
            parts[-1] += " " + stripped
        else:
            # Text before the first marker has nothing to continue: keep it
            parts.append(stripped)
    # a run of spaces inside a line is a PDF gap (after a bold phrase), not wording
    return "\n".join(re.sub(r'\s{2,}', ' ', p) for p in parts) if parts else None


def _parse_education(text: str) -> list[Education]:
    if not text.strip():
        return []
    entries = _split_entries(text)
    results: list[Education] = []
    for lines in entries:
        if not lines:
            continue
        first = lines[0]
        all_text = "\n".join(lines)

        # Institution: usually the first field, but "Degree / School / Dates"
        # and "Degree | Dates | School" put it later — prefer a header line or
        # "|" field naming a school, not a degree
        anchor = next((i for i, ln in enumerate(lines)
                       if _has_date(ln)), 0)
        fields = [f.strip() for ln in lines[:anchor + 1] for f in ln.split("|")]
        inst_field = next((f for f in fields
                           if INSTITUTION_RE.search(f) and not DEGREE_RE.search(f)), first.split("|")[0])
        inst = _strip_dates(EXPECTED_RE.sub("", inst_field)) or inst_field.strip()

        # Dates
        _, end = _parse_date_range(all_text)

        # GPA
        gpa_m = GPA_RE.search(all_text)
        gpa = float(gpa_m.group(1)) if gpa_m else None
        gpa_scale = float(gpa_m.group(2)) if gpa_m and gpa_m.group(2) else None

        # Degree
        deg_m = DEGREE_RE.search(all_text)
        degree = deg_m.group(1) if deg_m else None

        # Field of study: look for "Major(s):" or ": <field>" pattern, or text after degree
        field = None
        for ln in lines[1:]:
            # "Major:", "Majors:", "Majors (B.S.):"
            m = re.search(r'Majors?\s*(?:\([^)]*\))?\s*:\s*(.*?)(?:GPA|$)', ln, re.IGNORECASE)
            if m and m.group(1).strip():
                field = re.sub(r'\s*;.*', '', m.group(1).strip())
                break
        if field is None:
            # "B.S. in Computer Science", "Bachelor of Science in X", "B.S., X"
            m = DEGREE_FIELD_RE.search(all_text)
            if m and m.group(1).strip():
                # "Computer Science  GPA: 3.81/4.00": the field ends at a PDF gap or the GPA
                field = re.split(r'\s{2,}|\s*\bGPA\b', m.group(1).strip(), flags=re.IGNORECASE)[0].strip() or None

        # Description: coursework + other non-header lines
        desc_parts: list[str] = []
        for ln in lines[1:]:
            stripped = ln.strip()
            if COURSEWORK_RE.match(stripped):
                desc_parts.append(stripped)
            elif BULLET_RE.match(stripped):
                desc_parts.append(BULLET_RE.sub("", stripped).strip())
            elif desc_parts and (desc_parts[-1].endswith((",", ":")) or stripped[0].islower()):
                # a PDF-wrapped coursework or bullet line, or the list
                # under a "Relevant Coursework:" heading
                desc_parts[-1] += " " + stripped
        desc = "\n".join(re.sub(r'\s{2,}', ' ', d) for d in desc_parts) if desc_parts else None

        results.append(Education(
            institution=inst, degree=degree, field_of_study=field,
            gpa=gpa, gpa_scale=gpa_scale, end_date=end, description=desc,
        ))
    return results


def _parse_experience(text: str) -> list[Experience]:
    if not text.strip():
        return []
    entries = _split_entries(text)
    results: list[Experience] = []
    for lines in entries:
        if not lines:
            continue

        # Find the line with the date range
        date_idx = None
        for i, ln in enumerate(lines):
            if (DATE_RANGE_RE.search(ln) or BARE_DATE_RE.search(ln)) and not BULLET_RE.match(ln):
                date_idx = i
                break
        if date_idx is None:
            continue

        date_line = lines[date_idx]
        start, end = _parse_date_range(date_line)

        # Detect layout: if the line AFTER the date has a role keyword,
        # then date_line = company, next line = title + location.
        # Otherwise: line above = company, date_line = title.
        next_idx = date_idx + 1
        next_line = lines[next_idx].strip() if next_idx < len(lines) else ""
        title_below = bool(next_line
                           and not BULLET_RE.match(next_line)
                           and ROLE_KEYWORDS.search(next_line))
        date_location, date_rest = _extract_location(_strip_dates(date_line))

        if not date_rest and date_idx > 0:
            above_location, above = _extract_location(lines[date_idx - 1].strip())
            two_above = lines[date_idx - 2].strip() if date_idx > 1 else above
            pair = _split_title_company(above)
            if pair:
                # Layout: Title | Company [| Location] / [Location |] Dates / bullets
                title, company = pair
                date_location = date_location or above_location
            else:
                # Layout: Title / Company / Dates+Location / bullets
                title, company = two_above, above
                # Company / Title order instead: the role keyword gives it away
                if ROLE_KEYWORDS.search(above) and not ROLE_KEYWORDS.search(two_above):
                    title, company = above, two_above
            location = date_location
            bullet_start = date_idx + 1
        elif _split_title_company(date_rest):
            # Layout: Title | Company  Location | Dates / bullets
            title, company = _split_title_company(date_rest)
            location = date_location
            bullet_start = date_idx + 1
        elif title_below:
            # Layout: Company+Date / Title+Location / bullets
            company = BARE_DATE_RE.sub("", DATE_RANGE_RE.sub("", date_line)).strip().rstrip(",").rstrip("–—-").strip()
            location, title = _extract_location(next_line)
            title = title.strip() or next_line.strip()
            bullet_start = next_idx + 1
        else:
            # Layout: Company / Title+Date / bullets  (or single-line)
            title = BARE_DATE_RE.sub("", DATE_RANGE_RE.sub("", date_line)).strip().rstrip(",").rstrip("–—-").strip()
            title = re.sub(r'\s*[;,]?\s*\(.*?\)\s*$', '', title).strip()
            if not title:
                title = date_line.strip()

            company = ""
            location = None
            header = lines[date_idx - 1].strip() if date_idx > 0 else ""
            if header:
                location, company = _extract_location(header)
            if date_idx == 0:
                cleaned = DATE_RANGE_RE.sub("", date_line).strip()
                location, company = _extract_location(cleaned)
                if results and ROLE_KEYWORDS.search(company):
                    # A second role at the previous company, listed with no
                    # company line of its own
                    title = company
                    company = results[-1].company_name
                elif not title or title == company:
                    title = company
            bullet_start = date_idx + 1

        # "Role| C++, Python": the role is the title, the tools its skills
        title, technologies = split_tools(title)
        if not company:
            company = title

        desc = _bullets(lines[bullet_start:])

        results.append(Experience(
            company_name=company, title=title, location=location,
            start_date=start, end_date=end, description=desc, technologies=technologies,
        ))
    return results


def _parse_skills(text: str) -> list[Skill]:
    if not text.strip():
        return []
    results: list[Skill] = []
    category: str | None = None
    wrapped = False  # the line above ended in a comma: this line continues its list
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if ":" in line or (wrapped and category):
            if ":" in line:
                category, rest = line.split(":", 1)
                category = BULLET_RE.sub("", category).strip()
            else:
                rest = line
            wrapped = line.endswith(",")
            for s in rest.split(","):
                name = s.strip()
                if name:
                    results.append(Skill(skill_name=name, category=category))
        else:
            category, wrapped = None, False
            line = BULLET_RE.sub("", line).strip()
            # two-column skill lists put several bullets on one line
            for s in re.split(r'[,•]', line):
                name = s.strip()
                if name:
                    results.append(Skill(skill_name=name))
    return results


def _parse_projects(text: str) -> list[Project]:
    if not text.strip():
        return []
    entries = [part for entry in _split_entries(text) for part in _split_undated_projects(entry)]
    results: list[Project] = []
    for lines in entries:
        if not lines:
            continue

        # First line has project name + optional tech parens + date
        first = lines[0]
        start, end = _parse_date_range(first)
        name = BARE_DATE_RE.sub("", DATE_RANGE_RE.sub("", first)).strip().rstrip(",").rstrip("–—-").strip()
        technologies: list[str] = []
        name, technologies = split_tools(name)
        # "Name (C++, Python)"
        paren = re.search(r'\s*\((.*?)\)\s*$', name)
        if paren:
            if "," in paren.group(1):
                technologies = technologies or [t.strip() for t in paren.group(1).split(",") if t.strip()]
            name = name[:paren.start()].strip()
        name = re.sub(r'\s{2,}', ' ', name)
        if not name:
            name = first.strip()

        # URL from any line
        url = None
        for ln in lines:
            url_m = URL_RE.search(ln)
            if url_m:
                url = url_m.group(0)
                break

        # a line that is only the link is the url above, not a bullet
        desc = _bullets([ln for ln in lines[1:] if not URL_RE.fullmatch(ln.strip())])

        results.append(Project(
            project_name=name, url=url, technologies=technologies,
            start_date=start, end_date=end, description=desc,
        ))
    return results


def _split_undated_projects(lines: list[str]) -> list[list[str]]:
    """Undated projects give `_split_entries` no date to split on, so one
    entry can hold several. Where bullets carry markers, a plain line is a
    new project's name when it holds a "|" ("Robot | C++, Python") or opens
    a new sentence after a finished bullet; a PDF-wrapped bullet line does
    neither."""
    if not any(BULLET_RE.match(ln) for ln in lines):
        return [lines]
    out: list[list[str]] = []
    for i, ln in enumerate(lines):
        starts = i > 0 and not BULLET_RE.match(ln) and _is_header_line(ln) and (
            "|" in ln or lines[i - 1].rstrip().endswith("."))
        if starts and out and any(BULLET_RE.match(x) for x in out[-1]):
            out.append([ln])
        elif out:
            out[-1].append(ln)
        else:
            out.append([ln])
    return out


# A citation's year: "(2025)" or "2025." anywhere in it
CITATION_YEAR_RE = re.compile(r'\b((?:19|20)\d{2})\b')


def _parse_publications(text: str) -> list[Project]:
    """One project per citation, named by the whole citation: no rule tells
    a paper's title from its authors. `_bullets` joins a citation's
    PDF-wrapped lines; its link becomes the project's url, its year the end."""
    results: list[Project] = []
    for item in (_bullets(text.splitlines()) or "").splitlines():
        url_m = URL_RE.search(item)
        name = URL_RE.sub("", item).strip().rstrip(",").strip()
        _, when = _parse_date_range(name)
        year = CITATION_YEAR_RE.search(name)
        if when is None and year:
            when = date(int(year.group(1)), 1, 1)
        # "Paper, Venue  May 2025": the month is the end, not the name
        name = _strip_dates(name) or name
        if name:
            results.append(Project(project_name=name, url=url_m.group(0) if url_m else None, end_date=when))
    return results


def _parse_certifications(text: str) -> list[Certification]:
    if not text.strip():
        return []
    results: list[Certification] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        # Split on em-dash, en-dash, or " - "
        parts = re.split(r'\s*[–—]\s*|\s+-\s+', line, maxsplit=1)
        cert_name = parts[0].strip()
        issuer = parts[1].strip() if len(parts) > 1 else None
        if cert_name:
            results.append(Certification(cert_name=cert_name, issuer=issuer))
    return results


# A year alone ends an award line ("Merit Scholarship  2024")
YEAR_ONLY_RE = re.compile(r'(?<![\d–\-])\b(\d{4})\s*$')


def _parse_awards(text: str) -> list[Award]:
    """One award per line: "Award – Issuer  Date" or "Award | Issuer | Date";
    the issuer and the date are optional."""
    results: list[Award] = []
    for line in text.splitlines():
        line = BULLET_RE.sub("", line.strip()).strip()
        if not line:
            continue
        _, when = _parse_date_range(line)
        rest = _strip_dates(line)
        year = YEAR_ONLY_RE.search(rest)
        if when is None and year:
            when = date(int(year.group(1)), 1, 1)
        if year:
            rest = rest[:year.start()].strip().rstrip(",|–—-").strip()
        parts = [p.strip() for p in re.split(r'\s*[|–—]\s*|\s+-\s+', rest, maxsplit=1)]
        if parts[0]:
            results.append(Award(title=parts[0], issuer=parts[1] if len(parts) > 1 and parts[1] else None, date=when))
    return results
