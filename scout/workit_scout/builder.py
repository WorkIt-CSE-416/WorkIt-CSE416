"""
The resume builder's writing (KAN-176): bullets for an entry, entries from a
paragraph of free text, and an entry's bullets reworded for one job posting.

Same rules as the chat: the model is handed only the entry's own content and
the posting, never a name, email, phone or link, and it may only say what it
was told. Its answer is a plain line format, not JSON mode (Ollama and Gemini
disagree on that), parsed and checked here; an answer that doesn't parse is
asked for once more, then given up on. Nothing here saves anything: the
applicant reviews every line before the API stores it.
"""

import re
from collections.abc import Sequence
from datetime import date

from pydantic import BaseModel

from workit_scout.llm import LLM, Message
from workit_scout.schemas import JobFacts

# Each answer is a few bullets; a longer one is the model rambling
MAX_ANSWER_CHARS = 4000
MAX_BULLETS = 5
MAX_ENTRIES = 12
SECTIONS = ("education", "experience", "project", "activity", "award", "certification")


class EntryFacts(BaseModel):
    """What the model may read about one entry: its own content only."""

    section: str
    title: str
    organization: str | None = None
    bullets: list[str] = []
    # The applicant's own words about it, typed in the builder
    notes: str = ""
    # Still going on: decides the tense, which the model can't tell from the
    # words alone (Gemini wrote "Pack meals" for a summer that had ended)
    current: bool = False


class ProposedEntry(BaseModel):
    section: str
    title: str
    organization: str | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    bullets: list[str] = []
    # What only some sections have: a degree's field and GPA, a project's tools
    field_of_study: str | None = None
    gpa: float | None = None
    technologies: str | None = None


GROUNDING = """\
Use only facts the user gave. Never add a tool, technology, employer, team, \
number, percentage, date or result that is not in their words. If they gave \
no number, write the bullet without one. Never use first person ("I", "my")."""

BULLETS_PROMPT = f"""\
You write resume bullet points for a student's resume.

Each bullet: starts with a strong action verb in the tense you are told, one line of at most 25 words, says what they did and, when \
they said so, the result. No filler words, no ending period.

{GROUNDING}

Answer with 2 to {MAX_BULLETS} bullets, one per line, each starting with "- ". \
Nothing else: no heading, no intro, no notes."""

INTAKE_PROMPT = f"""\
You turn a student's description of what they have done into resume entries.

Each entry starts with a line "## " and its section, one of: \
{", ".join(SECTIONS)}. ("activity" is a club, team, volunteer or leadership \
role; "experience" is a job or internship.) Under it, these lines, leaving \
out any the user did not say:
title: the role, degree, project name, award or certification
organization: the company, school, club or issuer (never a tool; a project has none)
location: the city
start: YYYY-MM
end: YYYY-MM, or "present" (an award or certification has only end: the date won)
field: an education entry's field of study
gpa: an education entry's GPA, a number
technologies: a project's tools and languages, comma-separated
Then its bullets, each starting with "- ": one per accomplishment, what they \
did and its result in the same bullet. A GPA, field or tool list is never a bullet.

{GROUNDING}

Answer with the entries only, nothing before or after them."""

TAILOR_PROMPT = f"""\
You reword a student's resume bullets so they match a job posting's wording, \
without changing what they say.

Keep every number and every tool, language and company name exactly as \
written, and keep each bullet's meaning and length. Where the posting names \
the same work in other words, use the posting's words. Leave a bullet as it \
is when nothing in the posting fits it.

{GROUNDING} Never claim a skill from the posting that the bullet does not \
already show.

Example. The posting asks for "automated tests" and "web performance".
1. Wrote unit tests with Jest
2. Made the home page load in 2s instead of 6s
becomes
1. Wrote automated unit tests with Jest
2. Improved web performance, cutting home page load time from 6s to 2s

You get numbered bullets. Answer with the same numbers, one per line, as \
"1. reworded bullet". Nothing else."""


async def _ask(llm: LLM, system: str, user: str, retry: str | None = None) -> str:
    messages: list[Message] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    if retry:
        messages += [
            {"role": "assistant", "content": retry},
            {"role": "user", "content": "Answer again, in exactly the format asked."},
        ]
    answer = []
    async for delta in llm.stream(messages):
        answer.append(delta)
        if sum(map(len, answer)) >= MAX_ANSWER_CHARS:
            break
    return "".join(answer)


_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_MARKER = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")
_WORD = re.compile(r"[A-Za-z][A-Za-z0-9+#.]*[A-Za-z0-9+#]|[A-Za-z]")


def _words(text: str) -> set[str]:
    return {w.casefold() for w in _WORD.findall(text)}


def _names(line: str) -> list[str]:
    """The line's proper terms: a word with a capital past its first letter or
    after the line's first word ("React", "AWS", "TypeScript"), or with a
    digit or symbol in it ("C++", "S3"). Tools, employers and places."""
    words = _WORD.findall(line)
    return [
        w for i, w in enumerate(words)
        if (i > 0 and w[0].isupper()) or any(c.isupper() for c in w[1:])
        or any(c.isdigit() or c in "+#" for c in w)
    ]


def grounded(line: str, source: str) -> bool:
    """False when the line states a number or names a tool, employer or place
    its source never did: the checkable half of "never invent anything".
    Small models break that rule (Qwen 3.5 4B added "TypeScript" from a
    posting to a bullet that never used it), so it is checked, not trusted."""
    known_numbers = set(_NUMBER.findall(source))
    known_words = _words(source)
    return all(n in known_numbers for n in _NUMBER.findall(line)) and all(
        w.casefold() in known_words for w in _names(line)
    )


def _clean(line: str) -> str:
    line = _MARKER.sub("", line).strip().strip('"').rstrip(".").strip()
    return line[0].upper() + line[1:] if line else line


def parse_bullets(answer: str, source: str) -> list[str]:
    lines = [
        _clean(line)
        for line in answer.splitlines()
        if re.match(r"^\s*[-*•]\s+\S", line)
    ]
    return [line for line in lines if line and grounded(line, source)][:MAX_BULLETS]


def _source(entry: EntryFacts) -> str:
    return "\n".join(
        part for part in (entry.title, entry.organization or "", *entry.bullets, entry.notes) if part
    )


async def write_bullets(llm: LLM, entry: EntryFacts) -> list[str]:
    """Bullets for one entry, from what it already says and the notes."""
    told = [
        f"Section: {entry.section}",
        f"Title: {entry.title}",
        "Tense: present (they still do this)" if entry.current else "Tense: past (it has ended)",
    ]
    if entry.organization:
        told.append(f"Organization: {entry.organization}")
    if entry.bullets:
        told.append("What they wrote so far:\n" + "\n".join(f"- {b}" for b in entry.bullets))
    if entry.notes.strip():
        told.append(f"In their own words: {entry.notes.strip()}")
    user = "\n".join(told)
    source = _source(entry)
    answer = await _ask(llm, BULLETS_PROMPT, user)
    bullets = parse_bullets(answer, source)
    if not bullets:
        bullets = parse_bullets(await _ask(llm, BULLETS_PROMPT, user, retry=answer), source)
    return bullets


MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


def _month(value: str, source: str) -> date | None:
    """A YYYY-MM the user actually gave: its year in their words and its
    month too, by name or number. A bare year has no month to show, and the
    model fills one in (it made "2024" January), so it is left for them."""
    match = re.match(r"^\s*(\d{4})-(\d{1,2})", value)
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2))
    said = source.casefold()
    if not (1 <= month <= 12) or str(year) not in said:
        return None
    named = MONTHS[month - 1] in said or re.search(rf"\b0?{month}/(\d{{2}}|\d{{4}})\b", said)
    return date(year, month, 1) if named else None


def parse_entries(answer: str, source: str) -> list[ProposedEntry]:
    entries: list[ProposedEntry] = []
    current: dict | None = None

    def close() -> None:
        if current and current.get("title"):
            entries.append(ProposedEntry(**current))

    for raw in answer.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            close()
            section = line.lstrip("#").strip().lower()
            current = {"section": section, "bullets": []} if section in SECTIONS else None
            continue
        if current is None or not line:
            continue
        if re.match(r"^[-*•]\s+\S", line):
            bullet = _clean(line)
            # A GPA restated as a bullet belongs on the degree line instead
            if re.match(r"^(cumulative\s+)?gpa\b", bullet, re.IGNORECASE):
                continue
            if grounded(bullet, source):
                current["bullets"].append(bullet)
            continue
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if not value:
            continue
        if key == "title":
            current[key] = value
        elif key == "field" and _words(value) <= _words(source):
            current["field_of_study"] = value
        elif key == "gpa":
            gpa = re.match(r"^\d+(?:\.\d+)?", value)
            if gpa and gpa.group() in source:
                current["gpa"] = float(gpa.group())
        elif key == "technologies" and {w.casefold() for w in _names(value)} <= _words(source):
            current["technologies"] = value
        elif key == "organization" and _words(value) <= _words(source):
            # Every word of it from the user, or it is a guess
            current[key] = value
        elif key == "location":
            # The parts the user said: "New York, NY" from "in New York" keeps
            # "New York" and drops the state they never named
            said = [part.strip() for part in value.split(",") if _words(part) <= _words(source)]
            if said := [part for part in said if part]:
                current[key] = ", ".join(said)
        elif key == "start":
            current["start_date"] = _month(value, source)
        elif key == "end" and value.lower() != "present":
            current["end_date"] = _month(value, source)
    close()
    merged = _merged(entries)
    for entry in merged:
        entry.bullets = entry.bullets[:MAX_BULLETS]
        if entry.section in ("award", "certification"):
            # One date, the day it was won: a range "Mar 2025 – Mar 2025" reads wrong
            entry.end_date, entry.start_date = entry.end_date or entry.start_date, None
    return merged[:MAX_ENTRIES]


def _merged(entries: list[ProposedEntry]) -> list[ProposedEntry]:
    """One entry per thing done. Small models repeat themselves (Qwen 3.5 4B
    listed a treasurer role twice, the second without its club), so an entry
    with the same section and title as an earlier one, and no organization
    that contradicts it, fills that one's gaps instead of standing alone. Two
    internships at different companies stay two."""
    out: list[ProposedEntry] = []
    for entry in entries:
        same = next(
            (
                kept for kept in out
                if kept.section == entry.section
                and kept.title.casefold() == entry.title.casefold()
                and (
                    not kept.organization or not entry.organization
                    or kept.organization.casefold() == entry.organization.casefold()
                )
            ),
            None,
        )
        if same is None:
            out.append(entry)
            continue
        for field in ("organization", "location", "start_date", "end_date",
                      "field_of_study", "gpa", "technologies"):
            if getattr(same, field) is None:
                setattr(same, field, getattr(entry, field))
        seen = {b.casefold() for b in same.bullets}
        same.bullets += [b for b in entry.bullets if b.casefold() not in seen]
    return out


async def structure_entries(llm: LLM, text: str) -> list[ProposedEntry]:
    """Free text ("I was treasurer of the chess club…") as proposed entries."""
    answer = await _ask(llm, INTAKE_PROMPT, text)
    entries = parse_entries(answer, text)
    if not entries:
        entries = parse_entries(await _ask(llm, INTAKE_PROMPT, text, retry=answer), text)
    return entries


def parse_numbered(answer: str, originals: Sequence[str]) -> list[str | None]:
    """The reworded bullet for each original, or None where the answer has
    none, says nothing new, or states a number the original didn't."""
    out: list[str | None] = [None] * len(originals)
    for line in answer.splitlines():
        match = re.match(r"^\s*(\d+)[.)]\s*(.+)$", line)
        if not match:
            continue
        i = int(match.group(1)) - 1
        if 0 <= i < len(originals):
            text = _clean(match.group(2))
            same = text.casefold() == originals[i].strip().rstrip(".").casefold()
            # A rewording keeps every figure and tool it started with:
            # dropping "4s to 1.5s" or "Jest" changes what the bullet claims
            # as surely as adding one
            kept = set(_NUMBER.findall(originals[i])) <= set(_NUMBER.findall(text)) and {
                w.casefold() for w in _names(originals[i])
            } <= _words(text)
            if text and not same and kept and grounded(text, originals[i]):
                out[i] = text
    return out


def _posting(job: JobFacts) -> str:
    lines = [f"Title: {job.title}", f"Company: {job.company}"]
    if job.description:
        lines.append(f"Posting:\n{job.description[:6000]}")
    return "\n".join(lines)


async def tailor_bullets(llm: LLM, bullets: Sequence[str], job: JobFacts) -> list[str | None]:
    """Each bullet reworded toward the posting, or None where it should stay."""
    if not bullets:
        return []
    numbered = "\n".join(f"{i}. {b}" for i, b in enumerate(bullets, 1))
    user = f"# The job posting\n{_posting(job)}\n\n# Their bullets\n{numbered}"
    answer = await _ask(llm, TAILOR_PROMPT, user)
    out = parse_numbered(answer, bullets)
    if not any(out) and not re.search(r"^\s*\d+[.)]", answer, re.MULTILINE):
        out = parse_numbered(await _ask(llm, TAILOR_PROMPT, user, retry=answer), bullets)
    return out
