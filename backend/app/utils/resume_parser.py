import re
from datetime import date

import ftfy         # fix broken unicode

from app.models.dto import (
    Certification, Education, Experience, ParsedResume, Project, Skill,
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
EXPECTED_RE = re.compile(rf'Expected\s+({MONTH})\s+{YEAR}', re.IGNORECASE)
# Bare "Month Year" ending a line or a "|" field — no range, no "Expected"
BARE_DATE_RE = re.compile(rf'({MONTH})\s+{YEAR}\s*(?=\||$)', re.IGNORECASE | re.MULTILINE)

SECTION_RE = re.compile(
    r'^\s*('
    r'Education|'
    r'(?:Work\s+|Professional\s+)?Experience|'
    r'(?:Personal\s+|Academic\s+)?Projects?|'
    r'(?:Technical\s+)?Skills(?:\s+(?:&|and)\s+\w+)?|Technologies|'
    r'Activities(?:\s+(?:&|and)\s+\w+)?|Interests|'
    r'Certifications?\s*(?:&\s*Licenses)?|Licenses|'
    r'Summary|(?:Career\s+)?Objective|Profile|'
    r'Awards?|Honors?'
    r')\s*$',
    re.MULTILINE | re.IGNORECASE,
)

GPA_RE = re.compile(r'GPA[:\s]*([\d.]+)', re.IGNORECASE)
DEGREE_RE = re.compile(
    # A.A./A.S. need the dot, or the word "as" would count as a degree
    r'\b(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|A\.A\.?|A\.S\.?|Ph\.?D\.?|Bachelor|Master|Associate|Doctorate|'
    r'(?:High\s+School\s+)?Diploma|GED)\b',
    re.IGNORECASE,
)
INSTITUTION_RE = re.compile(r'\b(?:University|College|School|Institute|Academy)\b', re.IGNORECASE)
DEGREE_FIELD_RE = re.compile(
    r'\b(?:B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|A\.A\.?|A\.S\.?|Ph\.?D\.?|Bachelor\w*|Master\w*)'
    r'(?:\s+of\s+\w+)?(?:\s+in\s+|,\s*)([^|;,\n]+)',
    re.IGNORECASE,
)
BULLET_RE = re.compile(r'^\s*[•▪●◦·\-]\s*')          # catch bullet points
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
        projects=_parse_projects(sections.get("projects", "")),
        certifications=_parse_certifications(sections.get("certifications", "")),
    )

def count_sections(text: str) -> int:
    """How many section headers sit on lines of their own — the extractor
    uses this to tell which PDF extraction mode kept the structure intact."""
    return len(SECTION_RE.findall(text))


def _clean_text(text: str) -> str:
    # use library to clean up text
    text = ftfy.fix_text(text)
    text = re.sub(r'[▪●◦·]', '•', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# Split sections so each category is parsed individually by its own parser
def _split_sections(text: str) -> dict[str, str]:
    matches = list(SECTION_RE.finditer(text))       # list and find sections
    if not matches:
        return {}
    sections: dict[str, str] = {}                   # store text based on sections
    for i, m in enumerate(matches):
        name = _normalize_header(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections[name] = text[start:end].strip()    # grab that section of text
    return sections


def _normalize_header(header: str) -> str:
    h = header.strip().lower()
    if "experience" in h:
        return "experience"
    if "education" in h:
        return "education"
    if "skill" in h or "technologies" in h:
        return "skills"
    if "project" in h:
        return "projects"
    if "certification" in h or "license" in h:
        return "certifications"
    return h


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
        if DATE_RANGE_RE.search(ln) or EXPECTED_RE.search(ln):
            anchors.append(i)
        elif BARE_DATE_RE.search(ln) and _is_header_line(ln):
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
    # line that opens a new sentence after a full stop starts a new item.
    has_markers = any(BULLET_RE.match(ln.strip()) for ln in lines if ln.strip())
    parts: list[str] = []
    for ln in lines:
        stripped = ln.strip()
        if not stripped:
            continue
        if BULLET_RE.match(stripped):
            parts.append(BULLET_RE.sub("", stripped).strip())
        elif not has_markers and (not parts or (parts[-1].endswith(".") and stripped[0].isupper())):
            parts.append(stripped)
        elif parts:
            # Continuation of previous bullet (PDF line wrap)
            parts[-1] += " " + stripped
    return "\n".join(parts) if parts else None


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
                field = m.group(1).strip()

        # Description: coursework + other non-header lines
        desc_parts: list[str] = []
        for ln in lines[1:]:
            stripped = ln.strip()
            if re.match(r'(?:Relevant\s+)?(?:Coursework|Courses)\b', stripped, re.IGNORECASE):
                desc_parts.append(stripped)
            elif BULLET_RE.match(stripped):
                desc_parts.append(BULLET_RE.sub("", stripped).strip())
        desc = "\n".join(desc_parts) if desc_parts else None

        results.append(Education(
            institution=inst, degree=degree, field_of_study=field,
            gpa=gpa, end_date=end, description=desc,
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

        if not company:
            company = title

        desc = _bullets(lines[bullet_start:])

        results.append(Experience(
            company_name=company, title=title, location=location,
            start_date=start, end_date=end, description=desc,
        ))
    return results


def _parse_skills(text: str) -> list[Skill]:
    if not text.strip():
        return []
    results: list[Skill] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if ":" in line:
            category, rest = line.split(":", 1)
            category = BULLET_RE.sub("", category).strip()
            for s in rest.split(","):
                name = s.strip()
                if name:
                    results.append(Skill(skill_name=name, category=category))
        else:
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
    entries = _split_entries(text)
    results: list[Project] = []
    for lines in entries:
        if not lines:
            continue

        # First line has project name + optional tech parens + date
        first = lines[0]
        start, end = _parse_date_range(first)
        name = BARE_DATE_RE.sub("", DATE_RANGE_RE.sub("", first)).strip().rstrip(",").rstrip("–—-").strip()
        name = re.sub(r'\s*\(.*?\)\s*$', '', name).strip()
        if not name:
            name = first.strip()

        # URL from any line
        url = None
        for ln in lines:
            url_m = URL_RE.search(ln)
            if url_m:
                url = url_m.group(0)
                break

        desc = _bullets(lines[1:])

        results.append(Project(
            project_name=name, url=url,
            start_date=start, end_date=end, description=desc,
        ))
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
