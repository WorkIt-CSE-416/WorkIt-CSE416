"""Extract explicit eligibility statements and compare known education dates."""

import re
from datetime import date

from app.schemas.eligibility import (
    Education,
    EligibilityChecklist,
    EligibilityItem,
    EligibilityRequirement,
)

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
    r"\b(?:visa sponsorship|work authorization|"
    r"authorized to work|sponsorship)\b",
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
def extract(description: str | None) -> list[EligibilityRequirement]:
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
                    EligibilityRequirement(
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
        ):
            key = (kind, evidence)
            if pattern.search(evidence) and key not in seen:
                seen.add(key)
                requirements.append(
                    EligibilityRequirement(
                        kind=kind,
                        label=label,
                        evidence=evidence,
                        importance=importance,
                    )
                )

    return requirements

# Compares the extracted information with the student's education
def checklist(
    requirements: list[EligibilityRequirement],
    education: list[Education],
    *,
    description_available: bool,
) -> EligibilityChecklist:
    items = []
    windows = [r for r in requirements if r.kind == "graduation_window"]

    for requirement in requirements:
        status = "needs_confirmation"
        explanation = "Review the posting’s statement against your situation."

        if requirement.kind == "graduation_window":
            explanation = (
                "Confirm which education entry and graduation date "
                "this requirement applies to."
            )

            # Start conservatively: multiple education entries may refer
            # to different degrees. Don't choose one by guessing.
            # A negated or alternative window is not a simple inclusion test.
            ambiguous = re.search(
                r"\b(?:no|not|outside|except|or)\b", requirement.evidence, re.IGNORECASE
            ) or len(list(GRADUATION_WINDOW.finditer(requirement.evidence))) != 1
            if len(education) == 1 and len(windows) == 1 and not ambiguous:
                entry = education[0]
                graduation = entry.end_month

                if graduation and entry.end_kind in {"month", "expected"}:
                    graduation = graduation.replace(day=1)

                    # An extracted range alone doesn't establish every
                    # condition attached to it. Phrase this as a date check.
                    earliest = requirement.earliest_month
                    latest = requirement.latest_month

                    if earliest is not None and latest is not None:
                        within = earliest <= graduation <= latest
                        status = (
                            "matches" if within else "potential_mismatch"
                        )
                        explanation = (
                            f"Your education ends in {graduation:%b %Y}, "
                            f"{'inside' if within else 'outside'} "
                            "this stated date range. Confirm that this "
                            "is the education the employer means."
                        )
                else:
                    explanation = (
                        "Add your expected graduation month "
                        "to your education in the Experience Bank."
                    )

        elif requirement.kind == "degree":
            explanation = (
                "Check the degree, field of study, enrollment status, "
                "and any equivalent-experience alternatives."
            )

        elif requirement.kind == "sponsorship":
            explanation = (
                "Confirm whether this statement fits your circumstances. "
                "WorkIt does not infer your work authorization."
            )

        items.append(
            EligibilityItem(
                kind=requirement.kind,
                label=requirement.label,
                evidence=requirement.evidence,
                importance=requirement.importance,
                status=status,
                explanation=explanation,
            )
        )

    found = {requirement.kind for requirement in requirements}

    for kind, label in (
        ("graduation_window", "Graduation window"),
        ("degree", "Degree"),
        ("sponsorship", "Sponsorship / work authorization"),
    ):
        if kind not in found:
            items.append(
                EligibilityItem(
                    kind=kind,
                    label=label,
                    status="not_stated",
                    explanation=(
                        "No explicit statement recognized in the "
                        "available description. Check the original posting."
                    ),
                )
            )

    return EligibilityChecklist(
        items=items,
        description_available=description_available,
    )
