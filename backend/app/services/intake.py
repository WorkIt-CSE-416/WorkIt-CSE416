"""
Intake (KAN-213): WorkIt asks about one thing at a time and fills a draft
entry from the student's own words. One turn here: the frozen prompt, the
card as it is, and this entry's chat in; the model's checked reply out.

No database and no HTTP: the route loads the identity, checks and counts the
daily uses, and streams the result. Nothing said here is stored.
"""

import json
import re
from collections.abc import Sequence

from pydantic import ValidationError
from workit_scout.identity import Identity, placeholders_in
from workit_scout.llm import INVALID, LLM, InvalidReply
from workit_scout.schemas import ChatMessage

from app.models.dto import bank_section
from app.schemas.intake import IntakeDraft, IntakeReply
from app.services.bank import Bank, Entry

# Follow-up questions for each entry (spec). Counted from the chat the browser
# sends, which starts afresh with every entry; the opening question is not
# one (follow_ups).
MAX_FOLLOW_UPS = 3

# Said instead of a fourth question when the model asks one anyway.
READY = "That's everything a resume needs. It looks ready to save, or tell me more to add."
WRAP_UP = "That's all I need. Check the card, fix anything I got wrong, and save it."

SECTION_NAMES = {
    bank_section.education: "Education",
    bank_section.experience: "Experience",
    bank_section.projects: "Projects",
    bank_section.leadership: "Leadership & Activities",
    bank_section.awards: "Awards",
    bank_section.certifications: "Certifications",
}

# What "title" and "organization" hold in each section, as the card labels
# them. Without it a model puts the school in the organization.
FIELD_MEANINGS = {
    bank_section.education: ("the school, such as a university", "a college or department in it"),
    bank_section.experience: ("the job title", "the company"),
    bank_section.projects: ("the project name", "the team or course"),
    bank_section.leadership: ("the role", "the club or organization"),
    bank_section.awards: ("the award", "who gave it"),
    bank_section.certifications: ("the certification", "the organization"),
}

# One frozen string, so providers can cache it as a prefix. What varies per
# turn (the section, the card, the questions left) goes in a message after it.
# Wording still open: tune it against scripts/intake_test_set.py.
SYSTEM_PROMPT = """\
You are WorkIt's intake helper. A student is telling you about one thing they \
did, for one section of their resume. You fill a draft resume entry from their \
words and ask about what is missing.

Answer with JSON only: {"reply": ..., "draft": ..., "done": ...}.
- "reply": your next line to the student. One short, friendly sentence, and at \
most one question. No markdown.
- "draft": the whole entry so far. Start from the current draft below and keep \
every field in it, including what the student typed into the card themselves, \
unless the student corrects it in the chat.
- "done": true when you have no more questions.

The truth rule: put only what the student said into the draft. Never invent a \
title, organization, date, number, tool or result. Leave a field empty \
(null, or "" for the title) when they have not said it. You may reword what \
they said into resume style, but not add to it.

One answer often holds several facts: put each in its own field, using what \
title and organization hold in this section (given below). "Treasurer of the \
Robotics Club" is title "Treasurer" and organization "Robotics Club". \
"PennyWise, a budgeting app for my CSE 316 class" is title "PennyWise", \
organization "CSE 316" and a bullet about the budgeting app. "I was a research \
assistant in Professor Lee's lab" is title "Research Assistant" and \
organization "Professor Lee's lab". A title is a name or a role, never a whole \
sentence, and a role said in lowercase or in passing is still the title.

Fields:
- Months are "YYYY-MM". end_kind is "month" (ended), "present" (still going, \
no end_month) or "expected" (an expected end, such as graduation).
- bullets: what they did, one short line each, starting with a past-tense verb \
("Built", "Led"), or a present-tense one for something ongoing. At most five.
- Education only: degree, field_of_study, gpa, gpa_scale, coursework, honors. \
Projects only: link. Certifications only: issuer. Awards only: award_date, in \
place of start and end. Leave other sections' fields empty.
- Text like [name], [email], [phone] or [link] stands for something removed \
for privacy. Never put it in the draft.

Questions: ask only about facts that are missing and that a resume needs, the \
most important first: the title, then the organization, then the dates, then \
what they did and its result. Ask for a date in plain words ("What month and \
year?"), never in a format like YYYY-MM. Fill the draft from everything the \
student has said before you ask: a fact said in passing ("a research assistant \
in the AI lab") is said, so never ask for it again. Never ask for something already in the \
draft. If the student says they don't know or want to skip, accept it and move on. When \
no questions are left, say the entry looks ready to save and set done to true.
"""

# The facts a resume needs from each section, as the student would name
# them, in the order intake asks for them.
_NEEDS = {
    bank_section.education: ("title", "dates", "degree", "field_of_study", "gpa"),
    bank_section.experience: ("title", "organization", "dates", "bullets"),
    bank_section.projects: ("title", "dates", "bullets"),
    bank_section.leadership: ("title", "organization", "dates", "bullets"),
    bank_section.awards: ("title", "award_date"),
    bank_section.certifications: ("title", "organization"),
}


def _has(draft: IntakeDraft | None, fact: str) -> bool:
    if draft is None:
        return False
    if fact == "dates":
        return draft.start_month is not None or draft.end_month is not None
    return not _empty(getattr(draft, fact))


def _complete(section: bank_section, draft: IntakeDraft | None) -> bool:
    return all(_has(draft, fact) for fact in _NEEDS[section])


def _context(section: bank_section, draft: IntakeDraft | None, asked: int) -> str:
    left = max(0, MAX_FOLLOW_UPS - asked)
    current = draft.model_dump(mode="json") if draft else {"section": section.value}
    title, organization = FIELD_MEANINGS[section]
    needs = _NEEDS[section]
    have = [fact for fact in needs if _has(draft, fact)]
    missing = [fact for fact in needs if not _has(draft, fact)]
    return (
        f"Section: {SECTION_NAMES[section]} (section value \"{section.value}\").\n"
        f"In this section, title is {title} and organization is {organization}.\n"
        + (f"The draft already has: {', '.join(have)}. Never ask about these.\n" if have else "")
        + (
            f"Still missing: {', '.join(missing)}. Ask about these, in this order.\n"
            if missing
            else "Nothing a resume needs is missing: you may ask what came of the work, "
            "or say the entry looks ready and set done to true.\n"
        )
        + f"Questions you may still ask for this entry: {left}."
        + (" Ask none: set done to true." if left == 0 else "")
        + f"\nCurrent draft:\n{json.dumps(current)}"
    )


# The end of an entry is one fact in three fields, kept or dropped together
# so the draft never breaks the entry's end rule.
_DATES = ("start_month", "end_month", "end_kind")


def _empty(value: object) -> bool:
    return value is None or value == "" or value == []


def _keep_filled(new: IntakeDraft, old: IntakeDraft | None) -> IntakeDraft:
    """A field the card had that the model sends back empty keeps the card's
    value. The prompt says to keep every field, but a live model dropped an
    imported entry's company and dates while it added a bullet, and saving
    that visit would erase them. A correction changes a value, never blanks it."""
    if old is None:
        return new
    fixes = {
        name: getattr(old, name)
        for name, value in new
        if name not in _DATES and _empty(value) and not _empty(getattr(old, name))
    }
    if all(_empty(getattr(new, name)) for name in _DATES):
        fixes.update({name: getattr(old, name) for name in _DATES})
    return new.model_copy(update=fixes) if fixes else new


def _keep_withheld(new: IntakeDraft, old: IntakeDraft | None) -> IntakeDraft:
    """The model saw the card with identity data replaced by placeholders, so
    a field it echoes back as "[link]" keeps the card's own value. Placeholders
    are never swapped back into the card."""
    fixes = {
        name: getattr(old, name) if old else None
        for name, value in new
        if isinstance(value, str) and placeholders_in(value)
    }
    return new.model_copy(update=fixes) if fixes else new


# The sections a named activity is looked up in. A school (Education), an
# award or a certification has no club, dates and bullets to lend a role.
_LENDERS = (bank_section.experience, bank_section.projects, bank_section.leadership)

# Words too common to say which entry the student means.
_GENERIC = frozenset(
    [
        "the", "and", "for", "with", "from", "was", "were", "our", "its", "this", "that", "lead",
        "leader", "member", "intern", "engineer", "engineering", "software", "developer", "research",
        "researcher", "assistant", "team", "club", "society", "student", "students", "university",
        "college", "school", "project", "projects", "president", "officer", "head", "chair",
    ]
)

# A matched entry's facts, each group only into a card that lacks all of it.
# The dates go as one, like _keep_filled's.
_FROM_BANK = (("organization",), ("location",), _DATES, ("bullets",))

# Asked after a bank match, in place of the model's line: the model wrote it
# before the copy and may ask for what the card now holds.
_ASK = {
    "title": "What was {title}?",
    "organization": "What was {organization}?",
    "dates": "What month and year did it start and end?",
    "bullets": "What did you do there, and what came of it?",
    "degree": "What degree is it?",
    "field_of_study": "What are you studying?",
    "gpa": "What is your GPA? Say skip to leave it off.",
    "award_date": "What month and year did you win it?",
}


def _words(text: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2} - _GENERIC


def bank_match(said: str, bank: Bank) -> Entry | None:
    """The bank entry the student's line names, or None. An entry matches
    when the line holds a telling word of its title and one of its
    organization (when it has telling words in one). A title with none
    ("hi") never matches, or "my robotics team" would find any entry at a
    robotics club on its organization alone. So "the IEEE
    Micromouse lead" finds the project "Micromouse" at "Stony Brook IEEE",
    and "an internship at Google" never finds another company's "Software
    Engineer Intern". Only one match counts: two is a guess."""
    heard = _words(said)
    found = []
    for entry in bank.entries:
        if entry.row.section not in _LENDERS:
            continue
        title = _words(entry.row.title)
        parts = [w for w in (title, _words(entry.row.organization)) if w]
        if title and all(part & heard for part in parts):
            found.append(entry)
    return found[0] if len(found) == 1 else None


def _from_bank(draft: IntakeDraft, entry: Entry) -> IntakeDraft:
    """The draft with the entry's facts in its empty fields. A group the
    section cannot take (it fails the entry schema) is skipped."""
    lent = {
        "organization": entry.row.organization,
        "location": entry.row.location,
        "start_month": entry.row.start_month,
        "end_month": entry.row.end_month,
        "end_kind": entry.row.end_kind,
        "bullets": [b.text for b in entry.bullets],
    }
    for group in _FROM_BANK:
        if not all(_empty(getattr(draft, name)) for name in group):
            continue
        if all(_empty(lent[name]) for name in group):
            continue
        try:
            draft = IntakeDraft.model_validate(
                {**draft.model_dump(), **{name: lent[name] for name in group}}
            )
        except ValidationError:
            pass
    return draft


def _after_match(section: bank_section, draft: IntakeDraft, entry: Entry) -> str:
    """WorkIt's line once the card took an entry's facts: what it used, then
    the first fact still missing, if any."""
    found = f"I filled in what your bank has on {entry.row.title}."
    missing = [fact for fact in _NEEDS[section] if not _has(draft, fact)]
    if not missing:
        return f"{found} It looks ready to save, or tell me more to add."
    title, organization = FIELD_MEANINGS[section]
    return f"{found} {_ASK[missing[0]].format(title=title, organization=organization)}"


def follow_ups(messages: Sequence[ChatMessage]) -> int:
    """The questions asked since the student first spoke. An assistant line
    before that is the opening question ("Tell me about a project"), which
    is not one of the MAX_FOLLOW_UPS."""
    first = next((i for i, m in enumerate(messages) if m.role == "user"), len(messages))
    return sum(m.role == "assistant" for m in messages[first:])


async def turn(
    section: bank_section,
    messages: Sequence[ChatMessage],
    draft: IntakeDraft | None,
    llm: LLM,
    *,
    identity: Identity,
    bank: Bank | None = None,
) -> IntakeReply:
    """One turn. Raises `ScoutUnavailable` (or its `InvalidReply`) when no
    model answers or the answer fails the schema; nothing then counts."""
    asked = follow_ups(messages)
    prompt = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": _context(section, draft, asked)},
        *({"role": m.role, "content": m.content} for m in messages),
    ]
    answer = await llm.complete_json(prompt, IntakeReply, identity=identity)
    if answer.draft.section != section:
        # Validated as some other kind of entry: the card cannot take it.
        raise InvalidReply(INVALID)
    answer.draft = _keep_filled(_keep_withheld(answer.draft, draft), draft)
    # The code, not the model, finds and copies a bank entry the student
    # named: told to copy from a bank in its context, a live model took the
    # club and left the dates, and asked to name a match it never did. This
    # way the bank also costs no tokens.
    entry = bank_match(messages[-1].content, bank) if bank and messages[-1].role == "user" else None
    if entry is not None:
        filled = _from_bank(answer.draft, entry)
        if filled != answer.draft:
            answer = answer.model_copy(update={
                "draft": filled,
                "reply": _after_match(section, filled, entry),
                "done": _complete(section, filled),
            })
    if not answer.done and _complete(section, draft) and _complete(section, answer.draft):
        # The card had every fact a resume needs before this turn too. The
        # model had its turn to ask what came of the work; a small model
        # then kept asking for facts the card held, so the code ends it.
        return answer.model_copy(update={"reply": READY, "done": True})
    if asked >= MAX_FOLLOW_UPS and not answer.done:
        answer = answer.model_copy(update={"reply": WRAP_UP, "done": True})
    return answer
