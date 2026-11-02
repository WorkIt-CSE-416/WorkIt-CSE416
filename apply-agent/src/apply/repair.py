"""Repair requests: an Application that went wrong for a reason of Apply's
own making leaves one for a Repair (see GLOSSARY: Repair request).

Three things ask for one: an Application that failed with an error (its
traceback says where), a Missing fact (the Repair judges whether the
Applicant profile already answers it), and an answer the Pre-submit check
caught wrong or a rehearsal's Filler couldn't fill. One cause makes one
request, found by its signature: the error's type, its innermost Apply frame
and its message's shape, or the question's wording. Requests live as one
JSON file each in a gitignored folder.
"""

import fcntl
import hashlib
import json
import re
import threading
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path

from apply.home import HOME
from apply.model import Posting, Status, one_line
from apply.records import SECRET, Filled

# Where live Repair requests are kept (gitignored).
FOLDER = HOME / "repairs"

OPEN = "open"  # waiting for a Repair
FIXED = "fixed"  # a Repair was merged
NEEDS_LISUL = "needs Lisul"  # a Repair failed its gate, or couldn't run; its branch waits for him
NOT_A_BUG = "not a bug"  # the Repair found nothing in Apply to fix: a new fact, say

FAILURE, MISSING, WRONG = "failure", "missing fact", "wrong answer"
# Apply's own frames in a traceback: the module and the function.
APPLY_FRAME = re.compile(r'File "[^"]*/src/apply/(\w+)\.py", line \d+, in (\w+)')
QUOTED = re.compile(r"'[^']*'|\"[^\"]*\"|“[^”]*”")
# An essay's problem is Lisul's to judge, not Apply's code.
ESSAY = re.compile(r"\bessays?\b", re.IGNORECASE)


@dataclass
class RepairRequest:
    signature: str
    kind: str
    job_system: str
    posting_url: str
    company: str = ""
    title: str = ""
    failure: str = ""  # the failure line: "TimeoutError: ..."
    traceback: str = ""
    questions: list[dict] = field(default_factory=list)  # the Question set, with planned and on-page answers
    missing: list[str] = field(default_factory=list)  # Missing fact labels
    problems: list[str] = field(default_factory=list)  # wrong or unfilled answers
    applications: list[dict] = field(default_factory=list)  # {"id", "url"} of each Application it hit
    status: str = OPEN
    branch: str = ""  # the Repair's branch, once one ran
    why: str = ""  # what the Repair did, or why it waits for Lisul
    attempted: str = ""  # the day (ISO) its Repair ran

    @classmethod
    def from_json(cls, text: str) -> "RepairRequest":
        return cls(**json.loads(text))

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, ensure_ascii=False) + "\n"


def requests_for(posting: Posting, result) -> list[RepairRequest]:
    """The Repair requests one Application's Result asks for: none if nothing
    went wrong of Apply's making."""
    base = {
        "job_system": posting.job_system, "posting_url": posting.url, "company": posting.company,
        "title": posting.title, "questions": _questions(result.filled),
        "applications": [{"id": posting.id, "url": posting.url}],
    }
    requests = []
    if result.status == Status.FAILED and result.traceback:
        failure = one_line(result.reason)
        requests.append(RepairRequest(_failure_signature(failure, result.traceback), FAILURE, failure=failure,
                                      traceback=result.traceback, **base))
    for label in [result.missing_fact] if result.missing_fact else list(result.missing):
        requests.append(RepairRequest(_signature("missing", _shape(label)), MISSING, missing=[label], **base))
    for problem in result.problems:
        if not ESSAY.search(problem):
            head = _shape(problem.split(":", 1)[0])
            requests.append(RepairRequest(_signature(f"answer-{posting.job_system}", head), WRONG,
                                          problems=[problem], **base))
    return requests


class RepairRequests:
    """The Repair requests, one JSON file each in `folder` (or, with none,
    kept in memory, for tests). Runs and rehearsals add to it from many
    threads and processes at once."""

    def __init__(self, folder: Path | None = None):
        self.folder = folder
        self._memory: dict[str, str] = {}
        self._lock = threading.Lock()

    def add(self, request: RepairRequest) -> bool:
        """Keep `request`; True if its cause is new. A known cause only
        notes the Application, whatever its request's status."""
        with self._locked():
            text = self._read(request.signature)
            if text is None:
                self._write(request)
                return True
            known = RepairRequest.from_json(text)
            known.applications += [a for a in request.applications if a not in known.applications]
            self._write(known)
            return False

    def save(self, request: RepairRequest) -> None:
        with self._locked():
            self._write(request)

    def all(self) -> list[RepairRequest]:
        if self.folder is None:
            texts = [self._memory[k] for k in sorted(self._memory)]
        else:
            texts = [p.read_text() for p in sorted(self.folder.glob("*.json"))] if self.folder.exists() else []
        return [RepairRequest.from_json(text) for text in texts]

    def waiting(self) -> list[RepairRequest]:
        """The requests no Repair has taken yet."""
        return [r for r in self.all() if r.status == OPEN]

    def _read(self, signature: str) -> str | None:
        if self.folder is None:
            return self._memory.get(signature)
        path = self.folder / f"{signature}.json"
        return path.read_text() if path.exists() else None

    def _write(self, request: RepairRequest) -> None:
        if self.folder is None:
            self._memory[request.signature] = request.to_json()
        else:
            (self.folder / f"{request.signature}.json").write_text(request.to_json())

    @contextmanager
    def _locked(self):
        with self._lock:
            if self.folder is None:
                yield
                return
            self.folder.mkdir(parents=True, exist_ok=True)
            with open(self.folder / ".lock", "a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)


def _questions(filled: Filled | None) -> list[dict]:
    if not filled:
        return []
    return [{
        "label": one_line(q.label), "kind": q.kind, "required": q.required, "options": list(q.options),
        "planned": _shown(q, filled.answers.get(q.name)), "on_page": _shown(q, filled.readback.get(q.name)),
    } for q in filled.questions]


def _shown(question, answer):
    if answer is None or isinstance(answer, list):
        return answer
    if SECRET.search(question.label) or SECRET.search(question.name):
        return "(secret)"
    return answer.name if isinstance(answer, Path) else answer


def _failure_signature(failure: str, traceback: str) -> str:
    kind, _, message = failure.partition(":")
    frames = APPLY_FRAME.findall(traceback)
    module, function = frames[-1] if frames else ("", "")
    return _signature(f"{kind}-{module}-{function}", _shape(message))


def _shape(text: str) -> str:
    """`text` without what varies between Applications: quoted names and numbers."""
    return one_line(re.sub(r"\d+", "N", QUOTED.sub("Q", text)).casefold()).strip(" ?.*")


def _signature(head: str, shape: str) -> str:
    words = re.sub(r"[^a-z0-9]+", "-", f"{head}-{shape}".casefold()).strip("-")[:60].rstrip("-")
    return f"{words}-{hashlib.sha1(f'{head}|{shape}'.encode()).hexdigest()[:6]}"
