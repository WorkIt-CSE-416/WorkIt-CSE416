"""
Intake (KAN-213): WorkIt asks about one thing at a time and fills a draft
entry from the student's own words. One turn here: the frozen prompt, the
card as it is, and this entry's chat in; the model's checked reply out.

No database and no HTTP: the route loads the identity, checks and counts the
daily uses, and streams the result. Nothing said here is stored.
"""

import json
from collections.abc import Sequence

from workit_scout.identity import Identity, placeholders_in
from workit_scout.llm import INVALID, LLM, InvalidReply
from workit_scout.schemas import ChatMessage

from app.models.dto import bank_section
from app.schemas.intake import IntakeDraft, IntakeReply

# Follow-up questions for each entry (spec). Counted from the chat the browser
# sends, which starts afresh with every entry; the opening question is not
# one (follow_ups).
MAX_FOLLOW_UPS = 3

# Said instead of a fourth question when the model asks one anyway.
WRAP_UP = "That's all I need. Check the card, fix anything I got wrong, and save it."

SECTION_NAMES = {
    bank_section.education: "Education",
    bank_section.experience: "Experience",
    bank_section.projects: "Projects",
    bank_section.leadership: "Leadership & Activities",
    bank_section.awards: "Awards",
    bank_section.certifications: "Certifications",
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
what they did and its result. Never ask for something already in the draft. If \
the student says they don't know or want to skip, accept it and move on. When \
no questions are left, say the entry looks ready to save and set done to true.
"""

def _context(section: bank_section, draft: IntakeDraft | None, asked: int) -> str:
    left = max(0, MAX_FOLLOW_UPS - asked)
    current = draft.model_dump(mode="json") if draft else {"section": section.value}
    return (
        f"Section: {SECTION_NAMES[section]} (section value \"{section.value}\").\n"
        f"Questions you may still ask for this entry: {left}."
        + (" Ask none: set done to true." if left == 0 else "")
        + f"\nCurrent draft:\n{json.dumps(current)}"
    )


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
    answer.draft = _keep_withheld(answer.draft, draft)
    if asked >= MAX_FOLLOW_UPS and not answer.done:
        answer = answer.model_copy(update={"reply": WRAP_UP, "done": True})
    return answer
