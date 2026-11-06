"""Records: each filled Application's planned answers, on-page answers and form
screenshot (and, once submitted, a screenshot of the page its submit led to), kept outside the Tracker (in the private apply-records repo) and
linked from its row."""

import fcntl
import json
import re
import subprocess
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from html import escape
from pathlib import Path

from apply.home import HOME
from apply.model import Answers, Posting, Question, QuestionSet, Readback, Status


@dataclass(frozen=True)
class Filled:
    """What a Worker saw once the form was filled, before any submit, and
    the page its submit click led to."""

    questions: QuestionSet
    answers: Answers  # planned
    readback: Readback  # on the page
    screenshot: bytes  # PNG of the whole filled form
    after_submit: bytes = b""  # PNG of the page the submit click left; none if it never ran
    html: str = ""  # the filled form's HTML, with its values (a plain Worker's page.record_html); none from a CDP Worker


@dataclass(frozen=True)
class Record:
    posting: Posting
    status: Status
    reason: str
    filled: Filled
    day: date
    essays: str = ""  # Claude's essays for the form, as in the Essay column
    drafted: tuple[tuple[str, str], ...] = ()  # (question, answer) Claude drafted into the Answer bank
    named_facts: tuple[tuple[str, str], ...] = ()  # (question, Named fact) of each essay that names one
    verification: dict | None = None  # how verifying the filled form went (apply.verify, Verification.as_json)
    history: tuple[str, ...] = ()  # a rehearsal's pauses and Resumes, "HH:MM Paused: why", in order
    asks: tuple[dict, ...] = ()  # each Ask Claude message on the held form and how it went (apply.ask), in order


def folder(record: Record) -> str:
    """Where the Record lives in the repo: one folder per Application."""
    slug = re.sub(r"[^a-z0-9]+", "-", record.posting.company.lower()).strip("-") or "company"
    return f"{record.day.isoformat()}/{slug}-{record.posting.id}"


# A question whose answer is a secret, such as an Employer account password
# asked on the form itself. Its answer never reaches a Record.
# A security clearance question ("an active U.S. Top Secret security clearance?", Astro Mechanica's) is no secret.
SECRET = re.compile(r"password|passcode|passphrase|(?<!top )secret(?!\s+(security\s+)?clearance)|security answer"
                    r"|social security|\bssn\b|\bpin\b", re.IGNORECASE)
REDACTED = "(secret, not recorded)"


def record_files(record: Record) -> dict[str, bytes]:
    """The Record's files by name: answers.json, form.png, a README.md that
    GitHub shows when the Record's link is opened, after-submit.png once the
    form was submitted, essays.md when Claude wrote any, verification.json
    once the form was verified, and page.html when the page's HTML was kept
    (a plain Worker's), and asks.json when Lisul asked Claude to fix the form, with every secret answer cut out."""
    rows = [
        {"question": q.label.strip(), "field": q.name, "kind": q.kind, "planned": _shown(q, record.filled.answers.get(q.name)),
         "on_page": _shown(q, record.filled.readback.get(q.name))}
        for q in record.filled.questions
    ]
    files = {
        "README.md": _readme(record, rows).encode(),
        "answers.json": (json.dumps(rows, indent=2, ensure_ascii=False) + "\n").encode(),
        "form.png": record.filled.screenshot,
    }
    if record.filled.after_submit:
        files["after-submit.png"] = record.filled.after_submit
    if record.filled.html:
        files["page.html"] = _without_secrets(record).encode()
    if record.essays:
        files["essays.md"] = record.essays.encode()
    if record.asks:
        files["asks.json"] = (json.dumps(list(record.asks), indent=2, ensure_ascii=False) + "\n").encode()
    if record.verification is not None:
        files["verification.json"] = (json.dumps(record.verification, indent=2, ensure_ascii=False) + "\n").encode()
    return files


def _without_secrets(record: Record) -> str:
    """The page's HTML with each secret question's answer, planned or on the page, put as REDACTED."""
    html = record.filled.html
    for q in record.filled.questions:
        if SECRET.search(q.label) or SECRET.search(q.name):
            for value in (record.filled.answers.get(q.name), record.filled.readback.get(q.name)):
                for text in value if isinstance(value, (list, tuple)) else [value]:
                    if isinstance(text, str) and text.strip():
                        for written in {text, escape(text), escape(text, quote=False)}:
                            html = html.replace(written, REDACTED)
    return html


def _shown(question: Question, answer: str | Path | None) -> str | None:
    if answer is None:
        return None
    if SECRET.search(question.label) or SECRET.search(question.name):
        return REDACTED
    # A file is recorded by name only, never its path on Lisul's Mac.
    return answer.name if isinstance(answer, Path) else answer


def _readme(record: Record, rows: list[dict]) -> str:
    p = record.posting

    def cell(value) -> str:
        return "" if value is None else str(value).replace("|", "\\|").replace("\n", "<br>")

    lines = [
        f"# {p.company}: {p.title}",
        "",
        f"- Posting: {p.url}",
        f"- Application ID: {p.id}",
        f"- Status: {record.status}" + (f" ({record.reason})" if record.reason else ""),
        f"- Date: {record.day.isoformat()}",
        *([f"- Verification: {record.verification['label']}"] if record.verification else []),
        "",
        "| Question | Planned | On page |",
        "| --- | --- | --- |",
        *(f"| {cell(r['question'])} | {cell(r['planned'])} | {cell(r['on_page'])} |" for r in rows),
        "",
        *(["## Verification", "", "What Apply found when it read the filled form back, before any submit:", "",
            *(f"- {f['field'] + ': ' if f['field'] else ''}{f['why']}" + (" (dismissed)" if f.get("dismissed") else "" if f["holds"] else " (note)")
              for f in record.verification["flags"]), ""] if record.verification and record.verification["flags"] else []),
        *(["## Pauses", "", "Where the fill stopped for you, and where you pressed Resume:", "",
            *(f"- {line}" for line in record.history), ""] if record.history else []),
        *(["## Ask Claude", "", "What you asked Claude to fix on the held form, and what it did:", "",
            *(line for a in record.asks for line in (
                f"- You: {a.get('message', '')}", f"  - Claude: {a.get('reply', '')}",
                *(f"  - Changed {c.get('field', '')} → {c.get('shown', '')} ({c.get('read_back', '')})"
                  for c in a.get("changed") or []),
                *(f"  - Couldn't: {c}" for c in a.get("couldnt") or []))), ""] if record.asks else []),
        *(["## Claude drafted", "", "Answers to one-off questions, now in the Answer bank for you to review:", "",
            *(f"- {question} → {answer}" for question, answer in record.drafted), ""] if record.drafted else []),
        *(["## Named facts", "", "What the essays name about the company: read up on each before an interview.", "",
            *(f"- {question} → {fact}" for question, fact in record.named_facts), ""] if record.named_facts else []),
        "![The filled form](form.png)",
        "",
        *(["The page itself, as it was filled: [page.html](page.html)", ""] if record.filled.html else []),
        *(["![The page after the submit](after-submit.png)", ""] if record.filled.after_submit else []),
    ]
    return "\n".join(lines)


def _write(target: Path, files: dict[str, bytes]) -> None:
    """Write a Record's files into its folder. An empty screenshot (the page was gone, as after a
    shutdown) never takes the place of one already there."""
    target.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        path = target / name
        if not data and name.endswith(".png") and path.is_file() and path.stat().st_size:
            continue
        path.write_bytes(data)


class InMemoryRecords:
    """The Records fake for whole-run tests."""

    def __init__(self):
        self._saved: dict[str, dict[str, bytes]] = {}

    def save(self, record: Record) -> str:
        link = f"memory://apply-records/{folder(record)}"
        kept = self._saved.get(link, {})
        self._saved[link] = {name: data or (kept.get(name, b"") if name.endswith(".png") else data)
                             for name, data in record_files(record).items()}
        return link

    def files(self, link: str) -> dict[str, bytes]:
        return self._saved[link]

    def links(self) -> list[str]:
        return list(self._saved)


class FolderRecords:
    """Records in a local folder, never pushed anywhere: where a rehearsal
    keeps its Records. The link is the Record's folder."""

    def __init__(self, root: Path):
        self.root = root

    def save(self, record: Record) -> str:
        target = self.root / folder(record)
        _write(target, record_files(record))
        return str(target)


CLONE = HOME / "apply-records"
BRANCH = "main"


class GitRecords:
    """Records in a git repo: written to a local clone, committed and pushed.
    Live, the remote is a private GitHub repo of the applicant's own, set as
    policies.yaml's records_remote (see docs/records-setup.md), and the link
    opens the Record's folder on GitHub, which shows its README with the
    answers and the screenshot.

    A push that fails (offline, say) never loses a Record: its commit stays in
    the clone and goes up with the next save."""

    def __init__(self, remote: str, clone: Path = CLONE, web: str | None = None):
        """`web` defaults to the remote's own page: its https URL without .git."""
        self._remote = remote
        self._clone = clone
        self._web = web or remote.removesuffix(".git")

    def save(self, record: Record) -> str:
        where = folder(record)
        with self._locked():
            self._ensure_clone()
            _write(self._clone / where, record_files(record))
            self._git("add", "--", where)
            if self._git("status", "--porcelain", "--", where):
                p = record.posting
                self._git("commit", "-q", "-m", f"{record.status}: {p.company}, {p.title}")
            self._push()
        return f"{self._web}/tree/{BRANCH}/{where}"

    @contextmanager
    def _locked(self):
        # Several Workers or runs on this Mac share one clone.
        self._clone.parent.mkdir(parents=True, exist_ok=True)
        with open(self._clone.parent / f"{self._clone.name}.lock", "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def _ensure_clone(self) -> None:
        if (self._clone / ".git").exists():
            return
        subprocess.run(["git", "clone", "-q", self._remote, str(self._clone)], check=True, capture_output=True)
        if not self._git("branch", "-r"):
            # A new, empty remote has no branch yet: start ours as main.
            self._git("symbolic-ref", "HEAD", f"refs/heads/{BRANCH}")

    def _push(self) -> None:
        try:
            self._git("push", "-q", "origin", f"HEAD:{BRANCH}")
        except subprocess.CalledProcessError:
            try:
                self._git("pull", "-q", "--rebase", "origin", BRANCH)
                self._git("push", "-q", "origin", f"HEAD:{BRANCH}")
            except subprocess.CalledProcessError as e:
                print(f"apply-records: push failed, the Record waits in {self._clone}: {e.stderr.strip()}", file=sys.stderr)

    def _git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(self._clone),
             "-c", "user.name=Apply", "-c", "user.email=apply@localhost", "-c", "commit.gpgsign=false", *args],
            check=True, capture_output=True, text=True,
        ).stdout
