"""Extract job requirements from posting text, preserving original evidence."""

import re
from datetime import date

from app.schemas.requirements import JobRequirement

# Explicit month names avoid guessing dates from unrelated numbers.
MONTHS = {
    name.casefold(): number
    for number, name in enumerate(
        [
            "January", "February", "March", "April",
            "May", "June", "July", "August",
            "September", "October", "November", "December",
        ],
        start=1,
    )
}
MONTH_PATTERN = "|".join(MONTHS)

GRADUATION_WINDOW = re.compile(
    # Bind the dates to graduation itself, not nearby internship availability.
    rf"\b(?:graduat(?:ing|e)\s+|"
    rf"graduation(?:\s+date)?\s+(?:(?:must\s+be|is|expected)\s+)?)"
    rf"\bbetween\s+(?P<start_month>{MONTH_PATTERN})\s+"
    rf"(?P<start_year>20\d{{2}})\s+and\s+"
    rf"(?P<end_month>{MONTH_PATTERN})\s+"
    rf"(?P<end_year>20\d{{2}})\b",
    re.IGNORECASE,
)

DEGREE = re.compile(
    r"\b(?:bachelor(?:['’]s)?|master(?:['’]s)?|"
    r"doctoral|doctorate|Ph\.?D\.?)\b",
    re.IGNORECASE,
)

SPONSORSHIP = re.compile(
    r"\b(?:visa sponsorship|work authori[sz]ation|authori[sz]ation to work|"
    r"authori[sz]ed to work|(?:legal )?right to work|"
    r"eligible to work(?!\s+(?:out of|from|at)\b)|sponsorship|"
    r"(?:lawful[ ,]+)?permanent resident|green card|u\.?s\.? persons?)\b",
    re.IGNORECASE,
)

CITIZENSHIP = re.compile(r"\b(?:citizenship|citizens?)\b", re.IGNORECASE)
CLEARANCE = re.compile(
    r"\b(?:security clearance|(?:secret|TS/SCI|TS-SCI)(?: level)? clearance)\b",
    re.IGNORECASE,
)
US_CITIZEN = r"\b(?:u\.?s\.?|United States)\s+citizen(?:ship|s)?\b"
US_CITIZENSHIP_REQUIRED = re.compile(
    rf"(?:{US_CITIZEN}\s+(?:(?:is|are)\s+)?required\b|"
    rf"\bmust\s+be\s+(?:an?\s+)?{US_CITIZEN}|"
    rf"\bonly\s+{US_CITIZEN}\s+(?:will|can|may)\s+be\s+considered\b)",
    re.IGNORECASE,
)
# Never turn alternatives, negation, or conditional requirements into a blanket claim.
QUALIFIED_CITIZENSHIP = re.compile(
    r"\b(?:no|not|without|or|unless|except|if|may|might|preferred|"
    r"some|certain|other|depending|conditional|"
    r"permanent resident|green card|asylee|refugee)\b",
    re.IGNORECASE,
)
EQUAL_OPPORTUNITY = re.compile(
    r"\b(?:regardless of|without regard|discriminat\w*|equal opportunity)\b",
    re.IGNORECASE,
)

PREFERRED = re.compile(
    r"\b(?:preferred|nice to have|a plus|bonus)\b",
    re.IGNORECASE,
)

REQUIRED = re.compile(
    r"\b(?:must|required|requirement)\b",
    re.IGNORECASE,
)

# reads description line by line
def extract(description: str | None) -> list[JobRequirement]:
    """Extract evidence from the available description, without rewriting it."""
    if not description:
        return []

    requirements = []
    seen = set()

    # Lines preserve degree abbreviations (Ph.D.) and qualifications following
    # them. Headings supply importance but are not rewritten into the evidence.
    statements = description.splitlines()
    section_importance = "stated"

    for statement in statements:
        evidence = statement.strip()
        if not evidence:
            continue

        heading = evidence.rstrip(":").casefold()
        if heading in {"requirements", "required qualifications", "minimum qualifications"}:
            section_importance = "required"
            continue
        if heading in {"preferred qualifications", "nice to have", "bonus qualifications"}:
            section_importance = "preferred"
            continue
        if heading in {
            "overview", "responsibilities", "pay", "details", "benefits",
            "how to apply", "about the company",
        }:
            section_importance = "stated"
            continue

        importance = (
            "stated" if re.search(r"\b(?:no|not)\b", evidence, re.IGNORECASE)
            else "preferred" if PREFERRED.search(evidence)
            else "required" if REQUIRED.search(evidence)
            else section_importance
        )

        window = GRADUATION_WINDOW.search(evidence)
        if window:
            earliest = date(
                int(window["start_year"]),
                MONTHS[window["start_month"].casefold()],
                1,
            )
            latest = date(
                int(window["end_year"]),
                MONTHS[window["end_month"].casefold()],
                1,
            )

            key = ("graduation_window", evidence)
            if earliest <= latest and key not in seen:
                seen.add(key)
                requirements.append(
                    JobRequirement(
                        kind="graduation_window",
                        label=(
                            f"Graduation: {earliest:%b %Y}"
                            f"–{latest:%b %Y}"
                        ),
                        evidence=evidence,
                        importance=importance,
                        earliest_month=earliest,
                        latest_month=latest,
                    )
                )

        for kind, pattern, label in (
            ("degree", DEGREE, "Degree mentioned in the posting"),
            (
                "sponsorship",
                SPONSORSHIP,
                "Sponsorship or work authorization statement",
            ),
            ("citizenship", CITIZENSHIP, "Citizenship"),
            ("clearance", CLEARANCE, "Security clearance"),
        ):
            if kind in {"citizenship", "clearance"} and EQUAL_OPPORTUNITY.search(evidence):
                continue
            if kind == "citizenship" and not (
                re.search(US_CITIZEN, evidence, re.IGNORECASE)
                or REQUIRED.search(evidence)
                or PREFERRED.search(evidence)
            ):
                # Corporate values and generic citizenship mentions are not qualifications.
                continue
            key = (kind, evidence)
            if pattern.search(evidence) and key not in seen:
                seen.add(key)
                requirements.append(
                    JobRequirement(
                        kind=kind,
                        label=label,
                        evidence=evidence,
                        importance=importance,
                        summary=(
                            "U.S. Citizenship Required"
                            if kind == "citizenship"
                            and importance != "preferred"
                            and US_CITIZENSHIP_REQUIRED.search(evidence)
                            and not QUALIFIED_CITIZENSHIP.search(evidence)
                            else None
                        ),
                    )
                )

    return requirements
