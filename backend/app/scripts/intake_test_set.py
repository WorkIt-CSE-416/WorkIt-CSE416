"""
Run intake's fixed test set against a live model. By hand, never in CI.

    uv run python -m app.scripts.intake_test_set              the SCOUT_* chain
    uv run python -m app.scripts.intake_test_set --verbose    print every turn

Use it to tune intake's prompt (`app/services/intake.py`, SYSTEM_PROMPT) and
before a new endpoint joins the chain (spec: "the provider switch"). It reads
the same SCOUT_* settings as the API, so point them at the endpoint under
test. It costs real model calls (about 25) and writes nothing to any database.

Each case plays a student who answers WorkIt's questions with prepared lines,
one per turn, through the same `intake.turn` the route calls. A case passes
when every reply came back in the entry schema, intake asked at most three
follow-ups, the draft holds the fields the case expects (and its title, when
a case gives one: a line naming both a role and its club puts each in its own
field), and the draft states
nothing the student did not say (the truth rule: every number, and every
word of the title and organization, appears in what the student said).
"""

import argparse
import asyncio
import re
import sys
from dataclasses import dataclass, field

from workit_scout.identity import Identity
from workit_scout.llm import LLM, ScoutUnavailable
from workit_scout.schemas import ChatMessage
from workit_scout.settings import ScoutSettings

from app.config import ENV_FILE
from app.models.dto import bank_section
from app.schemas.intake import IntakeDraft
from app.services import intake


@dataclass
class Case:
    name: str
    section: bank_section
    # The student's first message, then the answers to any questions, in order.
    # An answer runs out as "I don't know."
    said: list[str]
    # Fields the draft must have filled by the end.
    expect: list[str] = field(default_factory=list)
    # The title the draft must end with, when one line also names the
    # organization: the two belong in separate fields.
    title: str | None = None


CASES = [
    Case(
        "education, all in one go",
        bank_section.education,
        ["B.S. in Computer Science at Stony Brook University, Aug 2023 to expected May 2027, GPA 3.7 out of 4."],
        ["title", "degree", "field_of_study", "start_month", "end_month", "gpa"],
    ),
    Case(
        "project, a little at a time",
        bank_section.projects,
        [
            "I made a budgeting app.",
            "It's called PennyWise, I built it for my CSE 316 class.",
            "From January to May 2025.",
            "React and Firebase. I added charts of spending by category and 40 classmates used it.",
        ],
        # A project's dates are not asked for (no application form takes
        # them); said here, they still land in the draft if intake is still
        # listening, but the case does not count on it.
        ["title", "organization", "bullets"],
    ),
    Case(
        "project, one answer is enough",
        bank_section.projects,
        [
            (
                "I built a line-following robot called LineBot in C++ on an Arduino. "
                "It used PID control and finished a 10 meter track in 14 seconds."
            ),
        ],
        ["title", "bullets"],
        title="LineBot",
    ),
    Case(
        "experience, ongoing job",
        bank_section.experience,
        [
            "I'm a software engineering intern at Datadog in New York since June 2025.",
            "I work on the alerting team. I wrote a Go service that groups duplicate alerts.",
        ],
        ["title", "organization", "start_month", "end_kind", "bullets"],
    ),
    Case(
        "leadership, a student who doesn't know",
        bank_section.leadership,
        ["I'm treasurer of the Robotics Club.", "I don't know.", "Skip this question.", "I don't know."],
        ["title", "organization"],
    ),
    Case(
        "project, name and course in one line",
        bank_section.projects,
        ["PennyWise, a budgeting app for my CSE 316 class.", "January to May 2025.", "40 classmates used it."],
        ["title", "organization", "bullets"],
        title="PennyWise",
    ),
    Case(
        "leadership, role and club in one line",
        bank_section.leadership,
        ["Robotics Club, I was treasurer from Sep 2023 to May 2024.", "I ran a $5,000 budget."],
        ["title", "organization", "start_month", "end_month"],
        title="Treasurer",
    ),
    Case(
        "experience, summer with no month",
        bank_section.experience,
        ["I was a research assistant in Professor Smith's AI lab at Stony Brook, summer 2024."],
        ["title", "organization"],
    ),
    Case(
        "award, no invented date",
        bank_section.awards,
        ["I won first place at HackSBU.", "I don't remember when."],
        ["title"],
    ),
    Case(
        "certification",
        bank_section.certifications,
        ["AWS Certified Cloud Practitioner, got it in March 2024."],
        ["title", "start_month"],
    ),
]


def _invented(draft: IntakeDraft, said: str) -> list[str]:
    """What the draft states that the student never said, by a crude test."""
    heard = said.lower()
    numbers = re.findall(r"\d+(?:\.\d+)?", " ".join(b for b in draft.bullets) + f" {draft.gpa or ''}")
    words = re.findall(r"[A-Za-z][A-Za-z+#.]*", f"{draft.title} {draft.organization or ''}")
    small = {"of", "in", "at", "the", "and", "for", "a", "an", "b.s.", "bs", "intern", "member"}
    return [n for n in numbers if n not in heard] + [
        w for w in words if w.lower() not in small and w.lower().rstrip(".") not in heard
    ]


async def run_case(case: Case, llm: LLM, verbose: bool) -> list[str]:
    """Plays one case; returns its failures (empty when it passes)."""
    answers = iter(case.said)
    messages: list[ChatMessage] = [ChatMessage(role="user", content=next(answers))]
    draft: IntakeDraft | None = None
    questions = 0
    for _ in range(intake.MAX_FOLLOW_UPS + 2):
        try:
            answer = await intake.turn(case.section, messages, draft, llm, identity=Identity())
        except ScoutUnavailable as exc:
            return [f"turn {len(messages)}: {type(exc).__name__}: {exc}"]
        draft = answer.draft
        if verbose:
            print(f"    student: {messages[-1].content}\n    workit:  {answer.reply}")
        if answer.done:
            break
        questions += 1
        messages += [
            ChatMessage(role="assistant", content=answer.reply),
            ChatMessage(role="user", content=next(answers, "I don't know.")),
        ]

    failures = []
    if questions > intake.MAX_FOLLOW_UPS:
        failures.append(f"asked {questions} follow-ups")
    assert draft is not None
    missing = [f for f in case.expect if getattr(draft, f) in (None, "", [])]
    if missing:
        failures.append(f"missing {', '.join(missing)}")
    if case.title and draft.title.lower() != case.title.lower():
        failures.append(f"title {draft.title!r}, not {case.title!r}")
    invented = _invented(draft, " ".join(case.said))
    if invented:
        failures.append(f"not said by the student: {', '.join(invented)}")
    if verbose:
        print(f"    draft:   {draft.model_dump_json(exclude_defaults=True)}")
    return failures


async def main(verbose: bool) -> int:
    settings = ScoutSettings(_env_file=ENV_FILE)
    print("Chain: " + ", ".join(f"{e.model} at {e.base_url}" for e in settings.chain()))
    llm = LLM.from_settings(settings)
    failed = 0
    for case in CASES:
        print(f"- {case.name}")
        failures = await run_case(case, llm, verbose)
        failed += bool(failures)
        print("  PASS" if not failures else "  FAIL: " + "; ".join(failures))
    print(f"\n{len(CASES) - failed} of {len(CASES)} cases passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--verbose", action="store_true", help="print every turn and draft")
    sys.exit(asyncio.run(main(parser.parse_args().verbose)))
