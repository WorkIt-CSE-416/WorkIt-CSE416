"""
The Essay plan's checks (KAN-369, Apply's evidence-first essay writer made
general). Pure: no session, no model; tested directly (tests/test_plans.py).

Before writing, the student's Claude plans each written answer: its
Question type, the story it leads with, the company brief fact it ties to
the student (if any), its angle, and the slots of its type
(question_types), each backed by quotes copied word for word from the
student's sources: their experience and skills, the posting, the company
brief and their earlier answers on the same application. The answer is
written from those quotes only, so a slot no source backs is a fact the
answer would invent. The save carries the plan, and `check` holds it to
that:

- every quote is at least QUOTED characters once folded (one line, any
  case, no markdown emphasis, straight quotes), and appears in the sources;
- every required slot (and every "asked" slot the plan gives) has a quote;
  without one the answer is refused, and the student is asked for the
  fact instead (written.ask_fact);
- an optional slot with no quote is dropped from the plan as kept;
- the story is a line of the student's experience, and no other answer on
  the application leads with it (an anything-else answer and a cover
  letter may reuse one);
- the company fact is one of the brief's, on a type that links the company.
"""

from collections.abc import Collection, Mapping
from dataclasses import dataclass

from app.auto_apply import question_types

QUOTED = 20  # characters a slot's quote needs once folded, so a stray word never backs a slot
REUSABLE = frozenset({"anything-else", "cover-letter"})  # types whose answer may lead with another's story
STORY = 8  # characters a story needs once folded, so "I" never names one


@dataclass(frozen=True)
class Backed:
    """One slot of an Essay plan and the quotes that back it."""

    slot: str
    quotes: tuple[str, ...]


@dataclass(frozen=True)
class Plan:
    """An Essay plan: what one answer says, picked before it is written."""

    type: str
    story: str = ""
    company_fact: str = ""
    angle: str = ""
    slots: tuple[Backed, ...] = ()

    def stored(self) -> dict:
        """The plan as `written_answers.review` keeps it."""
        return {"type": self.type, "story": self.story, "company_fact": self.company_fact, "angle": self.angle,
                "slots": {b.slot: list(b.quotes) for b in self.slots}}


@dataclass(frozen=True)
class Sources:
    """What a plan's quotes may come from, folded (`fold`)."""

    held: str  # every source as one folded text: experience, skills, posting, brief, earlier answers
    experience: str  # the student's experience as the connector gave it, folded: where a story must be
    facts: Collection[str]  # the company brief's facts, each folded


def fold(text: str) -> str:
    """`text` for matching a quote: one line, casefolded, with no markdown
    emphasis and straight quotes and apostrophes."""
    text = text.replace("*", "").replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'")
    return " ".join(text.split()).casefold()


def _story(text: str) -> str:
    """A story folded, without the marks a line of the experience may start or end with."""
    return fold(text).strip("#*->:. ")


def holds(held: str, quote: str) -> bool:
    """Whether the folded sources `held` hold `quote` word for word."""
    quote = fold(quote).strip()
    return len(quote) >= QUOTED and quote in held


def check(plan: Plan, sources: Sources, led: Mapping[str, str] | None = None) -> tuple[Plan, list[str]]:
    """`plan` as kept (each slot of its type in the guide's order, an
    optional slot no quote backs left out) and what is wrong with it, each
    a reason the student's Claude can act on. `led`: the stories other
    answers on the same application lead with (folded), each with its
    question's name."""
    led = led or {}
    guide = question_types.load().get(plan.type)
    if guide is None:
        return plan, [f"{plan.type!r} is not a Question type: use the question's type or one of other_types."]
    found: list[str] = []
    if story := _story(plan.story):
        if len(story) < STORY or story not in sources.experience:
            found.append(f"Its story {plan.story!r} is not a line of the experience: copy it word for word.")
        elif plan.type not in REUSABLE and story in led:
            found.append(f"Its story {plan.story!r} already leads the answer to {led[story]!r}: lead with another.")
    if plan.company_fact:
        if fold(plan.company_fact).strip() not in sources.facts:
            found.append(f"Its company_fact {plan.company_fact!r} is not one of the company_brief's facts: copy one "
                         "as given, or leave it empty.")
        elif guide.company_link == "never":
            found.append(f"A {plan.type} answer ties no company fact: leave company_fact empty.")
    given = {b.slot: b for b in plan.slots}
    kept: list[Backed] = []
    for slot in guide.slots:
        quotes = given[slot.name].quotes if slot.name in given else ()
        wrong = [q for q in quotes if not holds(sources.held, q)]
        found += [
            f"Slot {slot.name}: {q!r} is not word for word in the sources (or is under {QUOTED} characters): "
            "copy it exactly, or drop it and what the answer says from it."
            for q in wrong
        ]
        backing = tuple(q for q in quotes if q not in wrong)
        if backing:
            kept.append(Backed(slot.name, backing))
        elif not wrong and (slot.required is True or (slot.required == "asked" and slot.name in given)):
            found.append(f"Slot {slot.name} ({slot.holds}) has no quote backing it: quote the passage that states "
                         "it, or ask the student for the fact with save_fact_question and leave this answer out.")
    return Plan(plan.type, plan.story.strip(), plan.company_fact.strip(), plan.angle.strip(), tuple(kept)), found


def stories(plan: Mapping | None) -> str:
    """The folded story a stored plan (`Plan.stored`) leads with; "" for none."""
    return _story(str((plan or {}).get("story") or ""))
