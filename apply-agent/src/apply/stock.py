"""Stock answers: Lisul's approved core answer for a Question type, kept
only for types whose guide says `stock: true`.

One comes from a real essay: Claude writes a fresh answer, and Lisul's click
in the Answers tab proposes and approves it. Nothing is approved without
that click. Later essays of the type get it as material (its facts and
reasoning, not its sentences); it is never pasted into a form.

They live in stock-answers.yaml beside the Applicant profile, apart from the
profile's own `stock_answers` (his four older core answers), so no Stock
answer reaches the profile facts a drafted answer reads. The file is read
and written with ruamel.yaml's round trip, so his hand edits and comments stay:

    approved:
      why-field: {text: ..., approved: 2026-10-22, from_company: ..., from_question: ..., facts: [<sha1>, ...]}
    proposed:
      ai-tools: {...}

`facts` are sha1 hashes of the Story bank lines the answer draws on, when
known; a type whose lines changed is stale, and stale ones are not used."""

import hashlib
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from ruamel.yaml import YAML

from apply import answering, home

PATH = home.HOME / "stock-answers.yaml"
APPROVED, PROPOSED = "approved", "proposed"
_lock = threading.RLock()


@dataclass(frozen=True)
class Stock:
    type: str
    text: str
    approved: date | None  # None while only proposed
    from_company: str
    from_question: str
    facts: tuple[str, ...] = ()  # sha1 of each Story bank line it draws on


def get(type: str) -> Stock | None:
    """The approved Stock answer of `type`, if any."""
    raw = _read().get(APPROVED, {}).get(type)
    return _stock(type, raw) if raw else None


def approved() -> list[Stock]:
    """Every approved Stock answer, in file order."""
    return [_stock(t, raw) for t, raw in _read().get(APPROVED, {}).items() if raw]


def pending() -> list[Stock]:
    """Candidates proposed and not yet approved."""
    return [_stock(t, raw) for t, raw in _read().get(PROPOSED, {}).items() if raw]


def propose(type: str, text: str, company: str, question: str, facts: Iterable[str] = ()) -> Stock:
    """Record a candidate for `type`, not approved. `facts` are the Story bank
    lines it draws on (stored as hashes). An approved answer stays in use."""
    guide = answering.load().get(type)
    if guide is None or not guide.stock:
        raise ValueError(f"{type!r} takes no Stock answer")
    if not text.strip():
        raise ValueError("a Stock answer needs text")
    record = {"text": text.strip(), "approved": None, "from_company": company.strip(),
              "from_question": question.strip(), "facts": [line_hash(line) for line in facts if line.strip()]}
    with _lock:
        data = _read()
        data.setdefault(PROPOSED, {})[type] = record
        _write(data)
    return _stock(type, record)


def approve(type: str, today: date | None = None) -> Stock:
    """Make the candidate for `type` its Stock answer, replacing any before it."""
    with _lock:
        data = _read()
        record = (data.get(PROPOSED) or {}).pop(type, None)
        if record is None:
            raise KeyError(f"no Stock answer proposed for {type!r}")
        record["approved"] = today or date.today()
        data.setdefault(APPROVED, {})[type] = record
        _write(data)
    return _stock(type, record)


def edit(type: str, text: str) -> Stock:
    """Lisul's own wording of the approved Stock answer of `type`."""
    with _lock:
        data = _read()
        record = (data.get(APPROVED) or {}).get(type)
        if record is None:
            raise KeyError(f"no approved Stock answer for {type!r}")
        record["text"] = text.strip()
        _write(data)
    return _stock(type, record)


def stale(story_bank_text: str) -> list[str]:
    """Approved types whose Story bank lines are no longer all in the bank."""
    lines = {line_hash(line) for line in story_bank_text.splitlines() if line.strip()}
    return [s.type for s in approved() if s.facts and not set(s.facts) <= lines]


def material(types: Iterable[str]) -> str:
    """The approved, fresh Stock answer of each of `types` (each once), for the
    essay prompt as his core answer for that type; "" when there is none."""
    old = set(stale(home.STORY_BANK.read_text())) if home.STORY_BANK.exists() else set()
    found = [s for t in dict.fromkeys(types) if (s := get(t)) and t not in old]
    if not found:
        return ""
    body = "\n".join(f'<core_answer type="{s.type}">\n{s.text}\n</core_answer>' for s in found)
    return f"<core_answers>\n{body}\n</core_answers>"


def line_hash(line: str) -> str:
    """A Story bank line's hash, as the story map keeps it (story_map.line_hash)."""
    return hashlib.sha1(line.strip().encode()).hexdigest()


def _stock(type: str, raw: dict) -> Stock:
    day = raw.get("approved")
    return Stock(type=type, text=str(raw.get("text") or ""),
                 approved=date.fromisoformat(str(day)) if day else None,
                 from_company=str(raw.get("from_company") or ""), from_question=str(raw.get("from_question") or ""),
                 facts=tuple(str(h) for h in raw.get("facts") or ()))


def _read() -> dict:
    with _lock:
        return (_yaml().load(PATH.read_text()) if PATH.exists() else None) or {}


def _write(data: dict) -> None:
    with PATH.open("w") as f:
        _yaml().dump(data, f)


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.width = 120
    return y
