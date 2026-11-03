"""The Answers tab of the Apply window: everything Apply answers from, in
one place for Lisul to read, and his edits to what is his to edit.

It shows the Answer bank (his one-off answers, each Claude-drafted or his),
his answers to Missing facts and his Stock answers, all three editable, and
the rest of the Applicant profile to read. An essay of a Question type that
takes a Stock answer, written for a held Application, is offered as one:
only his click keeps it (apply.stock), and kept ones are editable too. A key that looks like it holds a
secret is never shown, and a file shows by its name alone.

The bank is written only through AnswerBank, whose locks keep a run's
Workers and the window from losing each other's answers; the profile only
through ApplicantProfile. While a run goes, the tab edits the run's own
profile, so the run's next save keeps his edit; with no run, it reads the
profile file afresh for every view and edit."""

from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

from ruamel.yaml.scalarstring import (
    FoldedScalarString,
    LiteralScalarString,
    SingleQuotedScalarString,
)

from apply import answering, stock
from apply.answer_bank import AnswerBank, Entry
from apply.model import Status
from apply.profile import ANSWERED, SECRET, ApplicantProfile

STOCK = "stock_answers"
# How long a question or an answer may be, and how many options a multi-select may tick.
MAX_QUESTION, MAX_ANSWER, MAX_CHOICES = 1_000, 20_000, 100


class Refused(ValueError):
    """An edit the tab won't make, with the HTTP status that says why: 400
    (not a valid answer), 404 (no such entry), 409 (one is there already)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class AnswersTab:
    def __init__(self, bank: AnswerBank, profile: ApplicantProfile | Path, today: Callable[[], date] = date.today,
                 held: Callable[[], list] | None = None):
        """`held` gives the Tracker's rows, read once (a Sheet read takes seconds)."""
        self._bank = bank
        self._profile = profile
        self._today = today
        self._held = held
        self._rows: list | None = None

    def view(self) -> dict:
        """What the tab shows, read again from the bank and the profile."""
        facts = self._profile_now().facts()
        return {
            "bank": [_shown(entry) for entry in _reused_first(self._bank.read_again())],
            "answered": [{"question": q, "answer": _text(a)} for q, a in (facts.get(ANSWERED) or {}).items()
                         if not SECRET.search(str(q))],
            "stock": [{"key": k, "answer": _text(a)} for k, a in (facts.get(STOCK) or {}).items()
                      if not SECRET.search(str(k))],
            "stock_types": [{"type": s.type, "answer": s.text, "company": s.from_company, "question": s.from_question,
                             "approved": s.approved.isoformat() if s.approved else ""} for s in stock.approved()],
            "stock_offers": self._offers(),
            "profile": [{"section": section, "facts": _flat(value, files=section == "files")}
                        for section, value in facts.items()
                        if section not in (ANSWERED, STOCK) and not SECRET.search(str(section))],
        }

    def save(self, question: str, answer: str | list[str]) -> None:
        """Lisul's answer to a question in the bank: his from now on, reviewed."""
        question, answer = _question(question), _answer(answer)
        if not self._has(question):
            raise Refused("That question is no longer in the Answer bank.", 404)
        self._bank.answer(question, answer, self._today())

    def add(self, question: str, answer: str | list[str]) -> None:
        """A question Lisul adds to the bank himself, with his answer."""
        question, answer = _question(question), _answer(answer)
        if self._has(question):
            raise Refused("That question is already in the Answer bank: edit it there.", 409)
        self._bank.answer(question, answer, self._today())

    def review(self, question: str) -> None:
        if not self._bank.review(_question(question)):
            raise Refused("That question is no longer in the Answer bank.", 404)

    def delete(self, question: str) -> None:
        """Take a question out of the bank: Claude drafts it again the next time a form asks."""
        if not self._bank.delete(_question(question)):
            raise Refused("That question is no longer in the Answer bank.", 404)

    def save_answered(self, question: str, answer: str) -> None:
        """Lisul's answer to a Missing fact, saved into the Applicant profile."""
        question, answer = _question(question), _answer(answer, choices=False)
        try:
            self._profile_now().save_answered(question, _scalar(answer))
        except ValueError as refused:  # a question that looks like it asks for a secret
            raise Refused(str(refused)) from refused

    def save_stock(self, key: str, answer: str) -> None:
        """One of Lisul's Stock answers, saved into the Applicant profile in the style it had."""
        profile, answer = self._profile_now(), _answer(answer, choices=False)
        was = (profile.get(STOCK) or {}).get(key) if isinstance(key, str) else None
        if was is None:
            raise Refused("There is no such Stock answer.", 404)
        style = next((s for s in (FoldedScalarString, LiteralScalarString) if isinstance(was, s)), None)
        try:
            profile.save_fact(f"{STOCK}.{key}", style(answer) if style else _scalar(answer))
        except ValueError as refused:
            raise Refused(str(refused)) from refused

    def keep_stock(self, type: str, company: str, question: str, answer: str) -> None:
        """Lisul's click on "Save as stock answer?": the offered essay, as he
        left it, becomes the Stock answer of its type."""
        answer = _answer(answer, choices=False)
        if not any(o["type"] == type and o["company"] == company and o["question"] == question for o in self._offers()):
            raise Refused("That essay is no longer offered as a Stock answer.", 404)
        stock.propose(type, answer, company, question)
        stock.approve(type, self._today())

    def save_stock_type(self, type: str, answer: str) -> None:
        """His own wording of a kept Stock answer."""
        answer = _answer(answer, choices=False)
        if not isinstance(type, str) or stock.get(type) is None:
            raise Refused("There is no such Stock answer.", 404)
        stock.edit(type, answer)

    def _offers(self) -> list[dict]:
        """Each held Application's essays whose Question type takes a Stock
        answer and has none kept yet."""
        from apply import (
            essays,  # imported here: essays imports the adapters, which import this tab
        )
        if self._rows is None:
            try:
                self._rows = list(self._held()) if self._held else []
            except Exception:  # the Sheet unreachable: no offers, the rest of the tab still shows
                self._rows = []
        guides, kept, offers = answering.load(), {s.type for s in stock.approved()}, []
        for row in self._rows:
            if row.status != Status.HELD or not row.essay:
                continue
            for essay in essays.from_cell(row.essay, essays.headings(row.essay)):
                type = answering.classify(essay.question.label)
                if essay.text and type in guides and guides[type].stock and type not in kept:
                    offers.append({"type": type, "company": row.company, "question": essay.question.label,
                                   "answer": essay.text})
        return offers

    def _has(self, question: str) -> bool:
        self._bank.read_again()
        return self._bank.get(question) is not None

    def _profile_now(self) -> ApplicantProfile:
        return self._profile if isinstance(self._profile, ApplicantProfile) else ApplicantProfile.load(self._profile)


def _question(question: object) -> str:
    if not isinstance(question, str) or not question.strip():
        raise Refused("Give the question.")
    if len(question) > MAX_QUESTION:
        raise Refused(f"A question may be at most {MAX_QUESTION:,} characters.")
    return question.strip()


def _answer(answer: object, choices: bool = True) -> str | list[str]:
    """An answer as Lisul gave it: text, or (for a choice) the options he picked."""
    if choices and isinstance(answer, list) and all(isinstance(a, str) for a in answer):
        picked = [a.strip() for a in answer if a.strip()]
        if not picked:
            raise Refused("Pick at least one option, or write an answer.")
        if len(picked) > MAX_CHOICES:
            raise Refused(f"An answer may pick at most {MAX_CHOICES} options.")
        if any(len(a) > MAX_ANSWER for a in picked):
            raise Refused(f"An answer may be at most {MAX_ANSWER:,} characters.")
        return picked
    if not isinstance(answer, str) or not answer.strip():
        raise Refused("Write an answer.")
    if len(answer) > MAX_ANSWER:
        raise Refused(f"An answer may be at most {MAX_ANSWER:,} characters.")
    return answer.strip()


def _scalar(text: str) -> str:
    """Quoted when a YAML reader would take it for true or false ("Yes", "No")."""
    bool_like = text.casefold() in ("yes", "no", "y", "n", "on", "off", "true", "false")
    return SingleQuotedScalarString(text) if bool_like else text


def _reused_first(entries: list[Entry]) -> list[Entry]:
    """The unreviewed drafts used again first, the most used first; the rest in bank order."""
    return sorted(entries, key=lambda e: -e.uses if e.uses and not e.reviewed else 0)


def _shown(entry: Entry) -> dict:
    return {"question": entry.question, "answer": entry.answer, "options": list(entry.options), "source": entry.source,
            "reviewed": entry.reviewed, "company": entry.company.strip(),
            "date": entry.first_seen.isoformat() if entry.first_seen else "",
            "uses": entry.uses, "last_used": entry.last_used.isoformat() if entry.last_used else ""}


def _flat(value: Any, prefix: str = "", files: bool = False) -> list[list[str]]:
    """A section's facts as [dotted key, readable value] pairs, secrets left out."""
    if not isinstance(value, dict):
        return [[prefix, _text(value, files)]]
    pairs = []
    for k, v in value.items():
        if SECRET.search(str(k)):
            continue
        name = f"{prefix}.{k}" if prefix else str(k)
        pairs += _flat(v, name, files) if isinstance(v, dict) and v else [[name, _text(v, files)]]
    return pairs


def _text(value: Any, files: bool = False) -> str:
    """A fact as Lisul reads it: a list on one line, a list of records a line each."""
    if value is None or value == {} or value == []:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        rows = [_text(v, files) for v in value]
        return ("\n" if any(isinstance(v, dict) for v in value) else
                "; " if any(isinstance(v, list) for v in value) else ", ").join(rows)
    if isinstance(value, dict):
        return " · ".join(f"{k}: {_text(v, files)}" for k, v in value.items() if not SECRET.search(str(k)) and v not in (None, ""))
    return Path(str(value)).name if files else str(value)
