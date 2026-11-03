"""
The skills catalog (KAN-369): which names count as a skill when a resume
reading or Tailor adds one to the bank. The list is data/skills.txt, one
skill a line with its other spellings; a name is a skill only when it is one
of them. Soft skills, degrees and vague phrases ("AI tools") are not lines,
so they never reach a bank on their own. A skill the student types is not
checked: what they type is theirs.

Matching (`key`) ignores case, spaces, hyphens and underscores, a ".js"
ending and one final plural "s" (not "ss"), so "ReactJS", "React.js" and
"react", or "REST API" and "REST APIs", are one skill. The student's own
spelling is kept; the catalog only says yes or no, and which names are the
same skill. A bracketed flavour or skills joined by a slash count too (see
`canonical`).
"""

import functools
import re
from pathlib import Path

_FILE = Path(__file__).resolve().parents[2] / "data" / "skills.txt"
_JS_RE = re.compile(r"(?<=[a-z0-9])[.\s]?js$")
_GAP_RE = re.compile(r"[\s\-_]+")


def key(name: str) -> str:
    """The name as the catalog compares it."""
    text = " ".join(name.lower().split())
    text = _JS_RE.sub("", text)
    text = _GAP_RE.sub("", text)
    if len(text) >= 4 and text.endswith("s") and not text.endswith("ss"):
        text = text[:-1]
    return text


@functools.cache
def _catalog() -> dict[str, str]:
    """Every spelling's key -> the line's first name."""
    names: dict[str, str] = {}
    for line in _FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        spellings = [s.strip() for s in line.split("|") if s.strip()]
        for spelling in spellings:
            names.setdefault(key(spelling), spellings[0])
    return names


@functools.cache
def _spellings() -> dict[str, tuple[str, ...]]:
    """Each line's first name -> every spelling on its line."""
    lines: dict[str, tuple[str, ...]] = {}
    for line in _FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        spellings = tuple(s.strip() for s in line.split("|") if s.strip())
        if spellings:
            lines.setdefault(spellings[0], spellings)
    return lines


def spellings(name: str) -> tuple[str, ...]:
    """The name and every other spelling of it the catalog knows ("React",
    "ReactJS", "React.js"), for a check that looks for the skill in text.
    A name the catalog lacks is its only spelling."""
    found = canonical(name)
    return tuple(dict.fromkeys((name, *_spellings().get(found or "", ()))))


_FLAVOUR_RE = re.compile(r"^(.+?)\s*\(([^()]*)\)$")
_JOINED_RE = re.compile(r"\s*(?:/|,|&)\s*")


def canonical(name: str) -> str | None:
    """The catalog's name for this skill, or None when it is not one.

    A skill with its flavour in brackets ("SQL (Postgres)") is the skill
    outside them; skills joined by a slash, comma or "&" ("HTML/CSS") are a
    skill when every part is one ("C/C++" is its own line, so it matches
    whole first).
    """
    if not name or not name.strip():
        return None
    found = _catalog().get(key(name))
    if found:
        return found
    flavour = _FLAVOUR_RE.match(name.strip())
    if flavour:
        return canonical(flavour.group(1))
    parts = [p for p in _JOINED_RE.split(name.strip()) if p]
    if len(parts) > 1:
        names = [_catalog().get(key(p)) for p in parts]
        if all(names):
            return "/".join(names)
    return None


def is_skill(name: str) -> bool:
    return canonical(name) is not None
