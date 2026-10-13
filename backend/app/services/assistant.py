"""
The editor assistant (KAN-221): the docked chat on the resume editor. Pure:
the router loads the rows and calls the model.

The model only **reads** the student's message: it names one of the
editor's actions (fit to one page, hide, move up or down, make it shorter)
or "none". Every line the student reads is written here, never by the model,
so the assistant cannot reword a line by talking about it. The one model
text that reaches the student is a "Make it shorter" proposal, and only
when it is shorter than the wording it replaces, keeps the truth rule
(`services/truth_rule.py`) and holds no identity placeholder (the model saw
the line de-identified, so it can echo `[name]` back). The student then uses it or keeps theirs; using
it saves it as typed wording, through the choices PATCH.
"""

import dataclasses

from workit_scout.identity import placeholders_in

from app.schemas.assistant import Action, AssistantReading, AssistantTurn
from app.services.bank import Bank, NotFound
from app.services.resume_view import Choices
from app.services.truth_rule import invented

# One frozen string, so providers can cache it as a prefix.
PROMPT = """\
You read one message a student typed in their resume editor and name the \
one action they asked for. Answer with JSON only: \
{"action": ..., "text": null}.

Actions:
- "fit": fit the resume to one page.
- "hide": hide the selected line.
- "move_up" / "move_down": move the selected line up or down.
- "shorter": make the selected bullet shorter. Put the shorter bullet in \
"text": the same facts in fewer words. Keep every number, tool and name; \
add nothing.
- "none": anything else, including any other change to the words.

Only "shorter" has text; every other action has "text": null.
"""

NO_LINE = "Click a line on the page first, then tell me what to change."
NOT_A_BULLET = "I can only shorten a bullet. Click one on the page first."
KEPT = "I couldn't make it shorter without changing its facts, so I left it as it is."
HELP = (
    "I can fit your resume to one page, hide or move a line, or make a bullet shorter. "
    "To change the words yourself, type on the page."
)
REPLIES: dict[Action, str] = {
    "fit": "Fitting it to one page.",
    "hide": "Hidden. It waits in Not on This Resume if you want it back.",
    "move_up": "Moved it up.",
    "move_down": "Moved it down.",
    "shorter": "Here's a shorter version with the same facts. Use it, or keep yours.",
    "none": HELP,
}


@dataclasses.dataclass(frozen=True)
class Line:
    """The selected line: its kind ("bullet", "entry", "skill") and the text
    the resume shows for it. A bullet also carries the bank's original."""

    kind: str
    text: str
    original: str | None = None


@dataclasses.dataclass(frozen=True)
class Answer:
    action: Action
    reply: str
    text: str | None = None
    original: str | None = None


def selected_line(bank: Bank, choices: Choices, turn: AssistantTurn) -> Line | None:
    """The line the turn names, read from the applicant's bank. NotFound when
    the id is not in it."""
    if turn.bullet_id:
        for entry in bank.entries:
            for bullet in entry.bullets:
                if bullet.id == turn.bullet_id:
                    choice = choices.bullets.get(bullet.id)
                    return Line("bullet", (choice and choice.text) or bullet.text, bullet.text)
        raise NotFound
    if turn.entry_id:
        row = next((e.row for e in bank.entries if e.row.id == turn.entry_id), None)
        if row is None:
            raise NotFound
        return Line("entry", ", ".join(p for p in (row.title, row.organization) if p))
    if turn.skill_id:
        skill = next((s for s in bank.skills if s.id == turn.skill_id), None)
        if skill is None:
            raise NotFound
        return Line("skill", skill.name)
    return None


def prompt(message: str, line: Line | None) -> list[dict[str, str]]:
    selected = f"The selected line ({line.kind}): {line.text}" if line else "No line is selected."
    return [
        {"role": "system", "content": PROMPT},
        {"role": "user", "content": f"{selected}\n\nThe student's message: {message}"},
    ]


def answer(reading: AssistantReading, line: Line | None, skills: list[str]) -> Answer:
    """What the editor does with the model's reading. A line action with no
    line selected, and a shorter wording that is not shorter or breaks the
    truth rule, become "none" with a line saying why."""
    action = reading.action
    if action in ("hide", "move_up", "move_down", "shorter") and line is None:
        return Answer("none", NO_LINE)
    if action != "shorter":
        return Answer(action, REPLIES[action])
    if line is None or line.kind != "bullet":
        return Answer("none", NOT_A_BULLET)
    text = " ".join((reading.text or "").split())
    given = f"{line.text}\n{line.original or ''}"
    if not text or len(text) >= len(line.text) or invented(text, given, skills) or placeholders_in(text):
        return Answer("none", KEPT)
    return Answer("shorter", REPLIES["shorter"], text, line.text)

