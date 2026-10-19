"""Concise, explicit application constraints; never infer applicant eligibility."""

import re

from app.schemas.requirements import JobRequirement


def extract_constraints(
    evidence: str, importance: str, qualification_section: bool,
) -> list[JobRequirement]:
    # Outside qualifications, only explicit obligations are candidates. This keeps
    # company history, office descriptions and benefits out of the summary.
    if not qualification_section and not re.search(r"\b(?:must|required)\b", evidence, re.IGNORECASE):
        return []
    # These rules do not yet model conditional or alternative constraints. Omit
    # those clauses instead of silently dropping their qualifiers.
    qualifiers = re.sub(r"\bor (?:a )?related fields?\b", "", evidence, flags=re.IGNORECASE)
    if re.search(r"\b(?:no|not|without|unless|except|if|or)\b", qualifiers, re.IGNORECASE):
        return []

    results = []

    def add(kind: str, summary: str) -> None:
        results.append(JobRequirement(
            kind=kind, label=kind.replace("_", " ").title(),
            summary=summary, evidence=evidence, importance=importance,
        ))

    years = re.search(
        r"\b(?P<minimum>at least\s+|minimum(?:\s+of)?\s+|up to\s+|at most\s+)?"
        r"(?P<years>\d+(?:\s*[-–]\s*\d+)?\+?)\s+years?"
        r"(?:\s+of)?\s+(?:(?:professional|relevant|industry|work)\s+)?experience\b",
        evidence, re.IGNORECASE,
    )
    if years:
        amount = years["years"]
        if years["minimum"]:
            qualifier = years["minimum"].strip().casefold()
            if qualifier in {"up to", "at most"}:
                amount = qualifier.capitalize() + " " + amount
            elif not amount.endswith("+"):
                amount += "+"
        add("experience", f"{amount} years of experience")
    if re.search(r"\b(?:previous|prior)\s+internship\s+experience\b", evidence, re.IGNORECASE):
        add("experience", "Previous internship experience")
    if re.search(
        r"\bexperience\b.*\b(?:building|deploying)\b.*\b(?:AI|machine learning)\b.*\bproduction\b",
        evidence, re.IGNORECASE,
    ):
        add("experience", "AI production experience")

    if re.search(r"\breturn(?:ing)?\s+to\s+(?:school|university|college)\b", evidence, re.IGNORECASE):
        add("enrollment", "Returning to school after the internship" if re.search(
            r"\bafter\s+(?:the\s+)?internship\b", evidence, re.IGNORECASE,
        ) else "Returning to school")
    elif re.search(r"\benrolled\s+(?:in|at)\b.*\b(?:university|college|school)\b", evidence, re.IGNORECASE) and not re.search(
        r"\b(?:degree|bachelor|master|PhD|BS|MS)\b", evidence, re.IGNORECASE,
    ):
        add("enrollment", "Currently enrolled student")

    onsite = re.search(
        r"\b(?:work|working)\s+(?P<mode>on[- ]?site|in[- ]person)"
        r"(?:\s+(?P<days>[1-5])\s+days?\s+(?:per|a)\s+week)?\b",
        evidence, re.IGNORECASE,
    )
    if onsite:
        summary = "On-site work"
        if onsite["days"]:
            summary += f" {onsite['days']} days per week"
        add("work_arrangement", summary)
    hours = re.search(
        r"\b(?P<hours>(?:(?:at least|up to|at most)\s+)?\d{1,2}"
        r"(?:\s*[-–]\s*\d{1,2})?\+?)\s+hours?\s+(?:per|a)\s+week\b",
        evidence, re.IGNORECASE,
    )
    if hours:
        add("availability", f"{hours['hours']} hours per week")
    duration = re.search(
        r"\b(?:commit\s+to|available\s+for)\s+(?P<minimum>at\s+least\s+)?"
        r"(?P<weeks>\d{1,2})\s+weeks?\b", evidence, re.IGNORECASE,
    )
    if duration:
        add("availability", f"{'At least ' if duration['minimum'] else ''}{duration['weeks']} weeks available")
    gpa = re.search(
        r"\b(?:minimum\s+GPA(?:\s+of)?|GPA\s+of\s+at\s+least)\s+(?P<gpa>[0-4]\.\d{1,2})\b",
        evidence, re.IGNORECASE,
    )
    if gpa:
        add("gpa", f"Minimum GPA {gpa['gpa']}")
    return results
