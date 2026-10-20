"""Extract job requirements from posting text, preserving original evidence."""

import re
from datetime import date

from app.schemas.requirements import JobRequirement
from app.services.requirement_constraints import extract_constraints

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
    r"doctoral|doctorate|Ph\.?D\.?|advanced degree)\b",
    re.IGNORECASE,
)

# Abbreviations need academic context: "MS Office" is not a master's degree.
_DEGREE_ABBR = r"(?:B\.?S\.?|M\.?S\.?|B\.?A\.?|M\.?A\.?|BSc|MSc|BEng|MEng|MBA)"
DEGREE_ABBREVIATION = re.compile(
    rf"\b(?:pursuing|completing|holding|earning)\s+(?:an?\s+)?{_DEGREE_ABBR}(?!\w)|"
    rf"\b{_DEGREE_ABBR}(?:\s*(?:/|or|and)\s*{_DEGREE_ABBR})*"
    rf"\s+(?:in|degree|required|preferred)\b",
    re.IGNORECASE,
)

GRADUATION_DATE = re.compile(
    r"\b(?:graduat(?:e|ing)|graduation(?:\s+date)?)\s+"
    r"(?:(?:is|expected|anticipated|must be)\s+)?"
    r"(?P<timing>(?:by|in|before|after|on or before|no later than)\s+"
    rf"(?:(?:{MONTH_PATTERN}|spring|summer|fall|autumn|winter)\s+)?20\d{{2}})\b",
    re.IGNORECASE,
)

# A shared year applies to each slash-separated month, not a continuous range.
_MONTH_CHOICE = rf"(?:{MONTH_PATTERN})(?:\s*/\s*(?:{MONTH_PATTERN}))*\s+20\d{{2}}"
GRADUATION_CHOICES = re.compile(
    rf"\bgraduat(?:e|ing)\s+in\s+(?P<dates>{_MONTH_CHOICE}"
    rf"(?:\s+or\s+{_MONTH_CHOICE})*)\b",
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

_DEGREE_NAMES = (
    (r"\badvanced degree\b", "Advanced degree"),
    (r"\bbachelor(?:['’]s)?\b", "Bachelor's degree"),
    (r"\bmaster(?:['’]s)?\b", "Master's degree"),
    (r"\bB\.?S\.?(?!\w)|\bBSc\b", "BS"),
    (r"\bM\.?S\.?(?!\w)|\bMSc\b", "MS"),
    (r"\bB\.?A\.?(?!\w)", "BA"),
    (r"\bM\.?A\.?(?!\w)", "MA"),
    (r"\b(?:doctoral|doctorate|Ph\.?D\.?)\b", "PhD"),
    (r"\bMBA\b", "MBA"),
    (r"\bBEng\b", "BEng"),
    (r"\bMEng\b", "MEng"),
)
_FIELDS = (
    (r"\bcomputer science\b", "CS"),
    (r"\bcomputer engineering\b", "computer engineering"),
    (r"\binformation systems\b", "information systems"),
    (r"\bartificial intelligence\b", "AI"),
    (r"\bmachine learning\b", "machine learning"),
)
# Small, explicit vocabulary: only qualification sections contribute skills.
_SKILLS = (
    (r"\bgenerative AI\b", "Generative AI"),
    (r"\bagentic (?:AI|architectures)\b", "Agentic AI"),
    (r"\b(?:AI tools|LLM APIs|coding agents)\b", "AI tools"),
    (r"\b(?:RAG|retrieval[- ]augmented generation)\b", "RAG"),
    (r"\bPython\b", "Python"),
    (r"\bFastAPI\b", "FastAPI"),
    (r"\bDjango\b", "Django"),
    (r"\b(?:human and automated evals|model evaluation|AI eval(?:uation)?s)\b", "AI model evaluation"),
    (r"\borchestration\b", "Orchestration"),
    (r"\bsafety guardrails\b", "Safety guardrails"),
    (r"\b(?:REST\s+)?APIs?\b", "APIs"),
    (r"\bGit\b", "Git"),
    (r"\bSQL\b", "SQL"),
    (r"\bJavaScript\b", "JavaScript"),
    (r"\bTypeScript\b", "TypeScript"),
    (r"\bJava\b", "Java"),
    (r"(?<!\w)C\+\+(?!\w)", "C++"),
    (r"\bReact\b", "React"),
    (r"\bAWS\b", "AWS"),
    (r"\bDocker\b", "Docker"),
    (r"\bKubernetes\b", "Kubernetes"),
)


def _skill_summaries(evidence: str, section_importance: str) -> list[tuple[str, str]]:
    """Scope modifiers to clauses, and keep explicit skill alternatives together."""
    results = []
    # Parenthetical preferences must not make the main qualification optional.
    clauses = re.split(
        r"[();]|\.\s+|,\s*(?:but|while)\s+|\s+but\s+|"
        r"(?<=required),\s*|(?<=preferred),\s*", evidence, flags=re.IGNORECASE,
    )
    for clause in clauses:
        if re.search(
            r"\b(?:not required|not necessary|no (?:prior )?(?:experience|knowledge|proficiency))\b",
            clause, re.IGNORECASE,
        ):
            continue
        importance = (
            "preferred" if PREFERRED.search(clause)
            else "required" if REQUIRED.search(clause)
            else section_importance
        )
        matches = sorted(
            (match.start(), match.end(), skill)
            for pattern, skill in _SKILLS
            for match in re.finditer(pattern, clause, re.IGNORECASE)
        )
        index = 0
        while index < len(matches):
            _, _, skill = matches[index]
            alternatives = [skill]
            index += 1
            # A comma list is alternatives only when its final connector says "or".
            list_end = index
            has_or = False
            while list_end < len(matches):
                previous_end = matches[list_end - 1][1]
                connector = clause[previous_end:matches[list_end][0]]
                if not re.fullmatch(r"\s*(?:,\s*(?:or\s*)?|or|/|and/or)\s*", connector, re.IGNORECASE):
                    break
                has_or = has_or or bool(re.search(r"\bor\b|/", connector, re.IGNORECASE))
                list_end += 1
            if has_or:
                alternatives.extend(match[2] for match in matches[index:list_end])
                index = list_end
            results.append((" or ".join(dict.fromkeys(alternatives)), importance))
    return results


def _degree_summary(evidence: str) -> str | None:
    if re.search(r"\b(?:no|not|without)\b", evidence, re.IGNORECASE):
        return None
    # Do not relabel non-academic "master" uses (Scrum Master, master data).
    if re.search(r"\b(?:scrum master|master data)\b", evidence, re.IGNORECASE):
        return None
    degrees = [name for pattern, name in _DEGREE_NAMES if re.search(pattern, evidence, re.IGNORECASE)]
    if not degrees:
        return None
    # Avoid turning conjunctions or mixed required/preferred degrees into alternatives.
    if len(degrees) > 1 and not re.search(r"\bor\b|/", evidence, re.IGNORECASE):
        return None
    summary = "/".join(degrees)
    fields = [name for pattern, name in _FIELDS if re.search(pattern, evidence, re.IGNORECASE)]
    if fields:
        summary += " in " + ", ".join(fields)
        if re.search(r"\brelated field\b", evidence, re.IGNORECASE):
            summary += " or related field"
    else:
        field = re.search(r"\bin\s+([\w -]{2,60})(?:[.;]|$)", evidence, re.IGNORECASE)
        if field:
            summary += " in " + field[1].strip()
    if re.search(r"\b(?:pursuing|enrolled|completing|earning)\b", evidence, re.IGNORECASE):
        summary += " (in progress)"
    if re.search(r"\bor equivalent (?:experience|work experience)\b", evidence, re.IGNORECASE):
        summary += " or equivalent experience"
    return summary


def _work_summary(evidence: str) -> str | None:
    if re.search(r"\b(?:if|unless|except|certain|some|other roles)\b", evidence, re.IGNORECASE):
        return None
    if re.search(
        r"\b(?:no (?:visa )?sponsorship|without\b.{0,70}\bsponsorship|"
        r"(?:cannot|can't|unable to|do not|does not|will not)\s+(?:provide\s+)?sponsor|"
        r"sponsorship\s+is\s+not\s+(?:available|provided|offered))\b", evidence, re.IGNORECASE
    ):
        return "No employer sponsorship"
    if re.search(r"\b(?:must|required)\b", evidence, re.IGNORECASE) and not re.search(
        r"\b(?:no|not|or)\b", evidence, re.IGNORECASE
    ):
        if (
            re.search(r"\b(?:United States|U\.?S\.?)\b", evidence, re.IGNORECASE)
            and re.search(r"authori[sz]|right to work", evidence, re.IGNORECASE)
        ):
            return "U.S. work authorization required"
        if re.search(r"\b(?:UK|United Kingdom)\b", evidence, re.IGNORECASE):
            return "UK work authorization required"
    return None

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
    qualification_section = False

    for statement in statements:
        evidence = statement.strip()
        if not evidence:
            continue

        heading = evidence.rstrip(":").casefold().replace("\u2019", "'")
        if heading in {
            "what we're looking for", "what we are looking for", "qualifications",
            "what you bring", "who you are", "your qualifications", "education and experience",
            "skills and experience", "what you'll bring", "about you",
        }:
            section_importance = "stated"
            qualification_section = True
            continue
        if heading in {
            "requirements", "required qualifications", "minimum qualifications",
            "basic qualifications", "minimum requirements", "required skills",
        }:
            section_importance = "required"
            qualification_section = True
            continue
        if heading in {"preferred qualifications", "nice to have", "bonus qualifications"}:
            section_importance = "preferred"
            qualification_section = True
            continue
        if heading in {
            "overview", "responsibilities", "pay", "details", "benefits",
            "how to apply", "about the company",
            "about us", "what we offer", "what you'll do", "what you will do",
            "your responsibilities", "the role", "about the role", "our team",
        }:
            section_importance = "stated"
            qualification_section = False
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
                        summary=(
                            f"Graduate between {earliest:%b %Y} and {latest:%b %Y}"
                            if not re.search(r"\b(?:no|not|or|except|if)\b", evidence, re.IGNORECASE)
                            else None
                        ),
                    )
                )

        elif choices := GRADUATION_CHOICES.search(evidence):
            # Degree alternatives before the graduation clause do not qualify its dates.
            clause = evidence[choices.start():]
            if not re.search(r"\b(?:no|not|except|if|unless)\b", evidence, re.IGNORECASE) and not re.search(
                r"\b(?:or|and)\b", clause[choices.end() - choices.start():], re.IGNORECASE
            ):
                key = ("graduation_window", evidence)
                if key not in seen:
                    seen.add(key)
                    requirements.append(JobRequirement(
                        kind="graduation_window", label="Graduation", evidence=evidence,
                        importance=importance, summary="Graduate in " + choices["dates"],
                    ))

        elif GRADUATION_DATE.search(evidence):
            key = ("graduation_window", evidence)
            if key not in seen:
                seen.add(key)
                requirements.append(JobRequirement(
                    kind="graduation_window",
                    label="Graduation",
                    evidence=evidence,
                    importance=importance,
                    summary=(
                        "Graduate " + GRADUATION_DATE.search(evidence)["timing"]
                        if not re.search(r"\b(?:no|not|or|except|if)\b", evidence, re.IGNORECASE)
                        else None
                    ),
                ))

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
            matched = pattern.search(evidence) or (
                kind == "degree" and DEGREE_ABBREVIATION.search(evidence)
            )
            if matched and key not in seen:
                seen.add(key)
                requirements.append(
                    JobRequirement(
                        kind=kind,
                        label=label,
                        evidence=evidence,
                        importance=importance,
                        summary=(
                            _degree_summary(evidence) if kind == "degree"
                            else _work_summary(evidence) if kind == "sponsorship"
                            else evidence.strip("•- ").rstrip(".")
                            if kind == "clearance" and len(evidence.split()) <= 12
                            else
                            "U.S. Citizenship Required"
                            if kind == "citizenship"
                            and importance != "preferred"
                            and US_CITIZENSHIP_REQUIRED.search(evidence)
                            and not QUALIFIED_CITIZENSHIP.search(evidence)
                            else None
                        ),
                    )
                )

        if qualification_section:
            for skill, skill_importance in _skill_summaries(evidence, section_importance):
                key = ("skills", skill + ":" + skill_importance)
                if key not in seen:
                    seen.add(key)
                    requirements.append(JobRequirement(
                        kind="skills", label="Key skills", evidence=evidence,
                        importance=skill_importance, summary=skill,
                    ))


        for item in extract_constraints(evidence, importance, qualification_section):
            key = (item.kind, item.summary, item.importance)
            if key not in seen:
                seen.add(key)
                requirements.append(item)

    return requirements
