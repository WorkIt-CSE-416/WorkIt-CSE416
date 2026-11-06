"""Personal values kept out of what Apply prints, and out of what an agent reads (KAN-664).

Two layers. `output()` wraps stdout and stderr for a command run from the shell, so every line goes through
scrub(): the Applicant profile's and Answer bank's own values become their key, addresses and phone numbers
their kind, and the ids and tokens in a URL go, wherever a line came from. The prints that carry a typed answer or
a message say only its size (`sized`), since text no one has saved yet can't be recognised.

shape() is `apply data`'s: what a value is (`<email>`, `<text, 12 chars>`), never any of it. A URL keeps only its
scheme and its host's last label, and counts the rest."""

import re
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import yaml

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
PHONE = re.compile(r"(?<![\w/.-])(?:\+\d{10,15}|(?:\+?\d{1,2}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})(?![\w-])")
URL = re.compile(r"\bhttps?://[^\s'\"<>)\]]+", re.IGNORECASE)
DATE = re.compile(r"^\d{4}-\d{2}(-\d{2})?([T ].*)?$")
# In a URL: a segment that names who or what session it is (user-36, xf-a1b2), one right after a word that does
# (/users/36, LinkedIn's /in/name), and a long opaque one. A job's own number or UUID is no one's and stays.
WHO = re.compile(r"^(?:user|usr|uid|candidate|applicant|member|session|token|sid|xf|auth)[-_=.]?[A-Za-z0-9_.~%-]+$", re.IGNORECASE)
AFTER = re.compile(r"^(?:users?|candidates?|applicants?|members?|profiles?|accounts?|in|sessions?|tokens?)$", re.IGNORECASE)
OPAQUE = re.compile(r"^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_~%+=-]{24,}$")
UUID = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.IGNORECASE)
QUERY = re.compile(r"token|auth|key|secret|session|sid|code|sig|user|uid|email|pass|otp|state|candidate|login|name|phone", re.IGNORECASE)
# The profile's sections that are the person, and how short a value goes unrecognised ("Yes", a state's "NY").
PERSON = ("identity", "links")
SHORTEST, SHORTEST_ANSWER = 3, 8
HIDDEN = "<hidden>"


def _clean_url(found: re.Match) -> str:
    url = found[0]
    trailing = re.search(r"[.,;:!?]+$", url)
    end = trailing[0] if trailing else ""
    url = url[:-len(end)] if end else url
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
    except ValueError:
        return f"{HIDDEN}{end}"
    netloc = host + (f":{parts.port}" if parts.port else "")
    segments, after = [], False
    for segment in parts.path.split("/"):
        hide = bool(segment) and not UUID.match(segment) and (after or WHO.match(segment) or OPAQUE.match(segment))
        segments.append(HIDDEN if hide else segment)
        after = bool(AFTER.match(segment))
    pairs = [f"{key}={HIDDEN if QUERY.search(key) or OPAQUE.match(value) or EMAIL.search(value) else value}"
             for key, value in parse_qsl(parts.query, keep_blank_values=True)]
    return f"{parts.scheme}://{netloc}{'/'.join(segments)}{'?' + '&'.join(pairs) if pairs else ''}{'#' + HIDDEN if parts.fragment else ''}{end}"


class Known:
    """The values to recognise: each as its whole word and not a path's folder (/Users/name/), longest first."""

    def __init__(self) -> None:
        self._values: dict[str, str] = {}
        self._pattern: re.Pattern | None = None

    def add(self, value: str, label: str, shortest: int = SHORTEST) -> None:
        value = value.strip()
        if len(value) >= shortest:
            self._values.setdefault(value, label)
            self._pattern = None

    def learn(self, profile: Path) -> None:
        """Read the Applicant profile beside its Answer bank. A file that won't read adds nothing."""
        self._values.clear()
        self._pattern = None
        tree = _read(profile)
        for section in PERSON:
            for key, value in _leaves(tree.get(section), section):
                self.add(value, key)
        for _, value in _leaves(tree.get("answered_questions"), ""):
            self.add(value, "answer", SHORTEST_ANSWER)
        for entry in _read(profile.parent / "answer-bank.yaml").values():
            if isinstance(entry, dict):
                for _, value in _leaves(entry.get("answer"), ""):
                    self.add(value, "answer", SHORTEST_ANSWER)

    def scrub(self, text: str) -> str:
        if self._values and self._pattern is None:
            self._pattern = re.compile(
                "|".join(rf"(?<![\w/]){re.escape(v)}(?![\w/])" for v in sorted(self._values, key=len, reverse=True)), re.IGNORECASE)
        if self._pattern:
            lowered = {v.lower(): label for v, label in self._values.items()}
            text = self._pattern.sub(lambda m: f"<{lowered[m[0].lower()]}>", text)
        return PHONE.sub("<phone>", EMAIL.sub("<email>", URL.sub(_clean_url, text)))


KNOWN = Known()


def scrub(text: str) -> str:
    return KNOWN.scrub(text)


def sized(text: Any, kind: str = "answer") -> str:
    """A typed answer or message, in a log line: how long it is, and none of it."""
    return f"<{kind}, {len(str(text))} chars>"


def _read(path: Path) -> dict:
    try:
        tree = yaml.safe_load(path.read_text())
    except (OSError, ValueError, yaml.YAMLError):
        return {}
    return tree if isinstance(tree, dict) else {}


def _leaves(value: Any, key: str) -> Iterator[tuple[str, str]]:
    if isinstance(value, dict):
        for name, inner in value.items():
            yield from _leaves(inner, f"{key}.{name}" if key else str(name))
    elif isinstance(value, list):
        for inner in value:
            yield from _leaves(inner, key)
    elif isinstance(value, str):
        yield key, value


class _Scrubbing:
    """A stream that scrubs each write, and is otherwise the stream under it."""

    def __init__(self, stream) -> None:
        self._stream = stream

    def write(self, text: str) -> int:
        self._stream.write(scrub(text))
        return len(text)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


@contextmanager
def output() -> Iterator[None]:
    """Stdout and stderr scrubbed for a shell command. A message sys.exit carries is scrubbed too, since
    the interpreter prints it after this ends. On any other error the streams stay wrapped, for the traceback."""
    streams = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = _Scrubbing(sys.stdout), _Scrubbing(sys.stderr)
    try:
        yield
    except SystemExit as leaving:
        if isinstance(leaving.code, str):
            leaving.code = scrub(leaving.code)
        sys.stdout, sys.stderr = streams
        raise
    else:
        sys.stdout, sys.stderr = streams


def shape(value: Any) -> str:
    """What a single value is, and none of it."""
    if value is None:
        return "<empty>"
    if isinstance(value, bool):
        return "<yes or no>"
    if isinstance(value, (int, float)):
        return "<number>"
    if isinstance(value, dict):
        return f"<{len(value)} keys>"
    if isinstance(value, (list, tuple)):
        return f"<{len(value)} items>"
    text = str(value).strip()
    if URL.fullmatch(text):
        return _url_shape(text)
    if EMAIL.fullmatch(text):
        return "<email>"
    if PHONE.fullmatch(text):
        return "<phone>"
    if DATE.match(text):
        return "<date>"
    return f"<text, {len(text)} chars>"


def _url_shape(text: str) -> str:
    try:
        parts = urlsplit(text)
        host = parts.hostname or ""
    except ValueError:
        return "<url>"
    segments = [s for s in parts.path.split("/") if s]
    params = len(parse_qsl(parts.query, keep_blank_values=True))
    return f"{parts.scheme}://<host>.{host.rsplit('.', 1)[-1]}/<{len(segments)} path parts>" + (f"?<{params} params>" if params else "")
