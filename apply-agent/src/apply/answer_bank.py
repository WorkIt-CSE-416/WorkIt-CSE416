"""The Answer bank: one answer per one-off question (a required question no
Applicant profile fact or rule answers), by the question's wording, so the
same question gets the same answer on every form and costs no tokens again.

It lives in answer-bank.yaml beside the Applicant profile, which Lisul may
edit by hand: it is read and written with ruamel.yaml's round trip, so his
comments and order stay. Workers add Claude's drafts from their own threads,
and runs from several processes may at once, so every add takes a lock on
the file, reads it again and adds only what it still lacks: an answer in the
bank is never replaced by a new draft. Each answer counts how many later
Applications it answered, so a draft used again unreviewed shows."""

import fcntl
import io
import re
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap
from ruamel.yaml.scalarstring import SingleQuotedScalarString

from apply.model import Question, one_line

if TYPE_CHECKING:
    from apply.tracker import AnswerRow

CLAUDE, LISUL = "claude", "lisul"  # who gave an answer


def key(question: str) -> str:
    """A question's wording as the bank files it: case, spacing, curly quotes
    and a required field's asterisk don't count."""
    text = question.casefold().replace("’", "'").replace("“", '"').replace("”", '"')
    return one_line(text).strip(" *")


@dataclass(frozen=True)
class Entry:
    question: str  # as a form showed it
    answer: str | list[str]  # a multi-select's answer is the options ticked
    options: tuple[str, ...] = ()  # the options it was answered from, for a choice
    source: str = CLAUDE
    reviewed: bool = False  # Lisul has looked at it
    first_seen: date | None = None
    company: str = ""  # where it was first asked
    uses: int = 0  # how many Applications it answered after its first
    facts: tuple[str, ...] = ()  # the profile keys and Story bank lines Claude's draft drew on
    last_used: date | None = None
    none: bool = False  # a multi-select none of whose options holds (answer []): its boxes stay unticked


class AnswerBank:
    """The bank in the YAML file at `path`, or in memory without one."""

    def __init__(self, path: Path | None = None):
        self._path = path
        self._lock = threading.Lock()
        self._entries = self._read() if path and path.exists() else {}

    def get(self, question: str) -> Entry | None:
        found = _find(self._entries, question)
        if not isinstance(found, dict):
            return None
        # An empty answer is none, unless it says "none of these" (none: true) for a multi-select.
        none = found.get("none") is True and found.get("answer") == []
        return _entry(found) if none or found.get("answer") not in (None, "", []) else None

    def answers(self) -> dict[str, Entry]:
        """Every answer, by the question's wording as filed."""
        return {str(k): entry for k in list(self._entries) if (entry := self.get(str(k)))}

    def entries(self) -> list[Entry]:
        return [entry for k in list(self._entries) if (entry := self.get(k))]

    def add(self, question: Question, answer: str | list[str], company: str, day: date, facts: list[str] = (),
            wording: str | None = None) -> bool:
        """Add Claude's draft answer to `question`, first asked at `company` on `day`,
        drawn from `facts` (profile keys and Story bank lines), if Claude named any,
        filed under `wording` (a bare date's section and label, fill_engine.Plan.filed),
        else under the question's label. False if the bank already has an answer to it, which stays."""
        filed = wording or question.label
        with self._writing() as entries:
            if _find(entries, filed) is not None:
                return False
            entries[key(filed)] = {
                "question": one_line(filed),
                "answer": [_text(a) for a in answer] if isinstance(answer, list) else _text(answer),
                "options": [_text(o) for o in question.options],
                "source": CLAUDE,
                "reviewed": False,
                "first_seen": {"date": day, "company": company},
            } | ({"facts": list(facts)} if facts else {})
            return True

    def redraft(self, question: Question, answer: str | list[str], company: str, day: date) -> bool:
        """Claude's new draft to `question`, written again with context Lisul
        added (apply.regenerate), in place of its old draft: still Claude's and
        unreviewed, first seen as before. Lisul's own answer stays. False
        when the bank keeps his."""
        with self._writing() as entries:
            found = _find(entries, question.label)
            if isinstance(found, dict) and found.get("source") == LISUL:
                return False
            if not isinstance(found, dict):
                found = entries[key(question.label)] = {"question": one_line(question.label),
                                                        "options": [_text(o) for o in question.options],
                                                        "first_seen": {"date": day, "company": company}}
            found["answer"] = [_text(a) for a in answer] if isinstance(answer, list) else _text(answer)
            found["source"], found["reviewed"] = CLAUDE, False
            found.pop("facts", None)  # what the old draft drew on
            found.pop("none", None)
            return True

    def take_edits(self, rows: list["AnswerRow"]) -> list[str]:
        """Copy Lisul's edits from the Answers tab into the bank: an answer he
        changed from the one Apply listed becomes his (source lisul, reviewed),
        and a tick in Reviewed marks it reviewed. Returns the questions changed."""
        changed = []
        with self._writing() as entries:
            for row in rows:
                found = _find(entries, row.question)
                if not isinstance(found, dict):
                    continue
                was = found.get("answer")
                answer = [a.strip() for a in row.answer.split(";") if a.strip()] if isinstance(was, list) else row.answer.strip()
                if answer and row.answer.strip() != row.drafted.strip() and answer != was:
                    found["answer"] = [_text(a) for a in answer] if isinstance(answer, list) else _text(answer)
                    found["source"], found["reviewed"] = LISUL, True
                    found.pop("none", None)
                elif row.reviewed and found.get("reviewed") is not True:
                    found["reviewed"] = True
                else:
                    continue
                changed.append(row.question)
        return changed

    def use(self, questions: list[str], day: date) -> None:
        """Count one more use, on `day`, of each answer in the bank to `questions`:
        an answer a later form took from the bank. The file is only written
        when one of them is in it, and an answer never used again has no count."""
        with self._writing() as entries:
            for question in questions:
                found = _find(entries, question)
                if isinstance(found, dict):
                    was = found.get("uses") if isinstance(found.get("uses"), dict) else {}
                    found["uses"] = {"count": int(was.get("count") or 0) + 1, "last": day}

    def answer(self, question: str, answer: str | list[str], day: date) -> None:
        """Lisul's own answer to `question`, from the Apply window: it replaces
        any draft (source lisul, reviewed). A question new to the bank joins
        it as first seen on `day`."""
        with self._writing() as entries:
            found = _find(entries, question)
            if not isinstance(found, dict):
                found = entries[key(question)] = {"question": one_line(question), "answer": "", "options": [],
                                                  "first_seen": {"date": day, "company": ""}}
            found["answer"] = [_text(a) for a in answer] if isinstance(answer, list) else _text(answer)
            found["source"], found["reviewed"] = LISUL, True
            if answer == []:  # none of a multi-select's options holds
                found["none"] = True
            else:
                found.pop("none", None)

    def review(self, question: str) -> bool:
        """Mark `question`'s answer reviewed, unchanged. False if the bank lacks it."""
        with self._writing() as entries:
            found = _find(entries, question)
            if not isinstance(found, dict):
                return False
            found["reviewed"] = True
            return True

    def delete(self, question: str) -> bool:
        """Take `question` out of the bank, so the next form that asks it gets
        a new draft. False if the bank lacks it."""
        with self._writing() as entries:
            wanted = key(question)
            filed = next((k for k in entries if key(str(k)) == wanted), None)
            if filed is None:
                return False
            del entries[filed]
            return True

    def read_again(self) -> list[Entry]:
        """Every entry, read again from the file: what other runs and hand edits added since."""
        if self._path is not None and self._path.exists():
            with self._lock, open(self._path) as held:
                fcntl.flock(held, fcntl.LOCK_SH)
                self._entries = self._read()
        return self.entries()

    @contextmanager
    def _writing(self) -> Iterator[dict]:
        """The bank's entries, read again under its locks and saved after."""
        with self._lock:
            if self._path is None:
                yield self._entries
                return
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._path, "a+") as held:  # the lock is on the bank file itself: no lock file beside it
                fcntl.flock(held, fcntl.LOCK_EX)
                text = self._path.read_text()
                self._entries = self._read()
                before = _dump(self._entries)
                yield self._entries
                after = _dump(self._entries)
                if after == before:  # nothing changed: the file stays as it was
                    return
                # A bank with no entry yet keeps its notes on top: there is no entry for them to hang on.
                notes = "" if _yaml().load(text) else re.match(r"(?:#.*\n|[ \t]*\n)*", text).group()
                self._path.write_text(notes + after)

    def _read(self) -> dict:
        return _yaml().load(self._path.read_text()) or CommentedMap()


def _dump(entries: dict) -> str:
    out = io.StringIO()
    _yaml().dump(entries, out)
    return out.getvalue()


def _find(entries: dict, question: str) -> Any:
    """The entry for `question`, under its key or a key Lisul typed in his own spacing or case."""
    wanted = key(question)
    return entries[wanted] if wanted in entries else next((v for k, v in entries.items() if key(str(k)) == wanted), None)


def _entry(found: dict) -> Entry:
    seen = found.get("first_seen") or {}
    uses = found.get("uses") if isinstance(found.get("uses"), dict) else {}
    answer = found["answer"]
    return Entry(
        question=str(found.get("question") or ""),
        answer=[str(a) for a in answer] if isinstance(answer, list) else str(answer),
        options=tuple(str(o) for o in found.get("options") or ()),
        source=str(found.get("source") or CLAUDE),
        reviewed=found.get("reviewed") is True,
        first_seen=seen.get("date") if isinstance(seen.get("date"), date) else None,
        company=str(seen.get("company") or ""),
        uses=int(uses.get("count") or 0),
        facts=tuple(str(f) for f in found.get("facts") or ()),
        last_used=uses.get("last") if isinstance(uses.get("last"), date) else None,
        none=found.get("none") is True and answer == [],
    )


def _text(value: str) -> str:
    """Quoted when another YAML reader would take it for true or false ("Yes", "No")."""
    bool_like = value.strip().casefold() in ("yes", "no", "y", "n", "on", "off", "true", "false")
    return SingleQuotedScalarString(value) if bool_like else value


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.width = 4096  # a long question stays on one line
    return y

