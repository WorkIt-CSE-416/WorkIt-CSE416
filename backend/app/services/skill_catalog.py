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
same skill.
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


def canonical(name: str) -> str | None:
    """The catalog's name for this skill, or None when it is not one."""
    return _catalog().get(key(name)) if name and name.strip() else None


def is_skill(name: str) -> bool:
    return canonical(name) is not None
