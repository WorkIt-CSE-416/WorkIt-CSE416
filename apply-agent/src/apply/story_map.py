"""The story map: routing tags for each Story bank episode (one experience
bullet), so a plan can pick a story whose kind of problem matches the
company's. One Opus call tags the episodes when Lisul runs `apply story-map`;
code then checks every tag against the bank. Each entry keeps a hash of its
bank line, and one whose line changed or is gone is never handed out, so a
stale map can misroute a story but never feed a wrong fact. The map states no
facts: the story bank stays the only source."""

import hashlib
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import yaml

from apply import answering, home
from apply.brief import TAGS as PROBLEM_KINDS

MAP = home.HOME / "story-map.yaml"
MODEL = "opus"
NONE = "none"  # a follow-up's `bank` when the story bank can't answer it
# The bank's sections that hold episodes: from the first of these headings up
# to (not including) the second. The voice sections before and the Skills and
# summary sections after are not stories.
FIRST, END = "Education", "Skills"


def area(heading: str) -> str:
    """A section's area: its heading's name before any ":" or "(", as a slug
    ("Clever Devices: Software Engineer Intern" is clever-devices)."""
    return re.sub(r"[^a-z0-9]+", "-", re.split(r"[:(]", heading, maxsplit=1)[0].lower()).strip("-") or "other"


SYSTEM = """You tag a student's experience stories so an essay planner can pick the right one for a company. You add no facts: every tag is either a quote from the story bank or routing.

Make one entry per episode: a single bullet line under the sections from Education to Honors (not the voice sections, Skills or "Not on the one-pager"). A section with several distinct stories gets one entry per bullet that tells a story.
- id: "<section-slug>/<short-name>", lowercase with hyphens, unique.
- anchor: the bullet's opening words, copied exactly (at least 6 words), enough to match that one line.
- types: the question types this story answers well, from the list given.
- problem_kinds: the kinds of problem it is, from the list given; none when none fits.
- skills: the languages, tools and techniques the line names.
- numbers: every number in that line, copied exactly with its unit (e.g. "about 40 ms").
- follow_ups: 2 to 4 questions an interviewer would ask next, each with what the bank says in a few words, or exactly "none" when the bank can't answer it.
- never_claim: what an answer must not claim, from the bank's own "not", "never" and "no" statements about this story.
- related: ids of other entries about the same system or event."""

ENTRY = {"type": "object", "properties": {
    "id": {"type": "string"},
    "anchor": {"type": "string"},
    "types": {"type": "array", "items": {"type": "string"}},
    "problem_kinds": {"type": "array", "items": {"type": "string"}},
    "skills": {"type": "array", "items": {"type": "string"}},
    "numbers": {"type": "array", "items": {"type": "string"}},
    "follow_ups": {"type": "array", "items": {"type": "object", "properties": {
        "q": {"type": "string"}, "bank": {"type": "string"}}, "required": ["q", "bank"]}},
    "never_claim": {"type": "array", "items": {"type": "string"}},
    "related": {"type": "array", "items": {"type": "string"}},
}, "required": ["id", "anchor", "types", "problem_kinds", "skills", "numbers", "follow_ups", "never_claim", "related"]}
SCHEMA = {"type": "object", "properties": {"episodes": {"type": "array", "items": ENTRY}}, "required": ["episodes"]}


@dataclass(frozen=True)
class Entry:
    id: str
    anchor: str
    area: str
    hash: str
    types: tuple[str, ...]
    problem_kinds: tuple[str, ...]
    skills: tuple[str, ...]
    numbers: tuple[str, ...]
    follow_ups: tuple[dict, ...]
    never_claim: tuple[str, ...]
    related: tuple[str, ...]


def line_hash(line: str) -> str:
    return hashlib.sha1(line.strip().encode()).hexdigest()


def episodes(text: str) -> list[tuple[str, str]]:
    """Each episode line of the bank, with its area."""
    found, where, inside = [], "other", False
    for line in text.splitlines():
        heading = re.match(r"## (.+)", line)
        if heading:
            name = heading[1].strip()
            inside = (inside or name.startswith(FIRST)) and not name.startswith(END)
            where = area(name)
        elif inside and line.startswith("- "):
            found.append((line.strip(), where))
    return found


def _match(anchor: str, lines: list[tuple[str, str]]) -> tuple[str, str] | None:
    """The one episode line holding the anchor, or None."""
    hits = [(line, area) for line, area in lines if anchor and anchor.strip() in line]
    return hits[0] if len(hits) == 1 else None


def build(claude, bank: Path | None = None) -> dict:
    """Tag every episode with one Opus call and check the tags: `episodes` is
    the map to write, `dropped` says what the checks removed and why."""
    text = (bank or home.STORY_BANK).read_text()
    prompt = (f"<document>\n<source>story-bank.md</source>\n<document_content>\n{text}</document_content>\n</document>\n\n"
              f"Question types: {', '.join(answering.load())}\nProblem kinds: {', '.join(PROBLEM_KINDS)}\n\n"
              "Tag every episode in the story bank.")
    given = claude.ask(model=MODEL, system=SYSTEM, prompt=prompt, schema=SCHEMA)["episodes"]
    return _checked(given, episodes(text))


def _checked(given: list[dict], lines: list[tuple[str, str]]) -> dict:
    types, kept, dropped = set(answering.load()), [], []
    for raw in given:
        id, anchor = str(raw.get("id", "")), str(raw.get("anchor", ""))
        hit = _match(anchor, lines)
        if hit is None:
            dropped.append(f"{id}: its anchor is not exactly one story-bank line ({anchor!r})")
            continue
        if any(e["id"] == id for e in kept):
            dropped.append(f"{id}: a second entry with this id")
            continue
        line, area = hit

        def known(field: str, allowed, what: str) -> list[str]:
            good = [v for v in raw.get(field) or [] if v in allowed]
            dropped.extend(f"{id}: {what} {v!r}" for v in raw.get(field) or [] if v not in allowed)
            return good

        entry = {"id": id, "anchor": anchor.strip(), "area": area, "hash": line_hash(line),
                 "types": known("types", types, "unknown question type"),
                 "problem_kinds": known("problem_kinds", PROBLEM_KINDS, "unknown problem kind"),
                 "skills": list(raw.get("skills") or []),
                 "numbers": known("numbers", _InLine(line), "a number not in its line,"),
                 "follow_ups": [{"q": f["q"], "bank": f["bank"]} for f in raw.get("follow_ups") or []],
                 "never_claim": list(raw.get("never_claim") or []),
                 "related": list(raw.get("related") or [])}
        if not entry["types"]:
            dropped.append(f"{id}: no known question type left")
            continue
        kept.append(entry)
    ids = {e["id"] for e in kept}
    for entry in kept:
        entry["related"] = [r for r in entry["related"] if r in ids and r != entry["id"]]
    return {"episodes": kept, "dropped": dropped}


class _InLine:
    """`number in _InLine(line)`: the number is copied from the line."""

    def __init__(self, line: str):
        self.line = line

    def __contains__(self, number: object) -> bool:
        return isinstance(number, str) and bool(number.strip()) and number.strip() in self.line


def _read(path: Path) -> list[dict]:
    return (yaml.safe_load(path.read_text()) or {}).get("episodes") or [] if path.exists() else []


def _stale(raw: dict, lines: list[tuple[str, str]]) -> str | None:
    """Why an entry is stale, or None while its line is unchanged."""
    hit = _match(raw.get("anchor", ""), lines)
    if hit is None:
        return "its line is no longer in the story bank"
    return None if line_hash(hit[0]) == raw.get("hash") else "its line in the story bank changed"


def load(path: Path | None = None, bank: Path | None = None) -> list[Entry]:
    """The map's fresh entries; a stale one is left out without a word."""
    lines = episodes((bank or home.STORY_BANK).read_text())
    return [Entry(**{k: raw[k] if k in ("id", "anchor", "area", "hash") else tuple(raw.get(k) or ())
                     for k in Entry.__dataclass_fields__})
            for raw in _read(path or MAP) if _stale(raw, lines) is None]


def check(path: Path | None = None, bank: Path | None = None) -> list[str]:
    """One line per stale entry. No model call."""
    lines = episodes((bank or home.STORY_BANK).read_text())
    return [f"{raw.get('id')}: {why}" for raw in _read(path or MAP) if (why := _stale(raw, lines))]


def gaps(path: Path | None = None, bank: Path | None = None, today: date | None = None) -> list[str]:
    """The follow-ups the bank can't answer, as bank/questions.md lines to ask."""
    day = (today or date.today()).isoformat()
    return [f"- {day} | {e.area} | {f['q']} | asked | story map: {e.id}"
            for e in load(path, bank) for f in e.follow_ups if f.get("bank", "").strip().lower() == NONE]


def prompt_block(entries: list[Entry]) -> str:
    """The fresh entries, one line each, for a plan's <story_map> block."""
    out = []
    for e in entries:
        parts = [f"types: {', '.join(e.types)}"]
        parts += [f"kinds: {', '.join(e.problem_kinds)}"] if e.problem_kinds else []
        parts += [f"numbers: {'; '.join(e.numbers)}"] if e.numbers else []
        parts += [f"never claim: {'; '.join(e.never_claim)}"] if e.never_claim else []
        open_ = [f["q"] for f in e.follow_ups if f.get("bank", "").strip().lower() == NONE]
        parts += [f"bank can't answer: {'; '.join(open_)}"] if open_ else []
        parts += [f"related: {', '.join(e.related)}"] if e.related else []
        out.append(f'{e.id} ({e.area}): "{e.anchor}" | ' + " | ".join(parts))
    return "\n".join(out)


def diff(old: list[dict], new: list[dict]) -> list[str]:
    """What writing `new` over `old` changes, one line per entry."""
    before, after = {e["id"]: e for e in old}, {e["id"]: e for e in new}
    lines = [f"- {id}" for id in before if id not in after]
    for id, entry in after.items():
        was = before.get(id)
        if was is None:
            lines.append(f"+ {id}")
        elif was != entry:
            fields = [k for k in entry if was.get(k) != entry[k]]
            lines.append(f"~ {id}: {', '.join(fields)}")
            lines += [f"    {k}: {was.get(k)} -> {entry[k]}" for k in ("types", "problem_kinds", "never_claim")
                      if k in fields]
        known = {f["q"] for f in (was or {}).get("follow_ups") or [] if f.get("bank") == NONE}
        lines += [f"    new gap: {f['q']}" for f in entry["follow_ups"] if f["bank"] == NONE and f["q"] not in known]
    return lines


def write(map: dict, path: Path | None = None) -> None:
    (path or MAP).write_text(yaml.safe_dump({"episodes": map["episodes"]}, sort_keys=False, allow_unicode=True,
                                            width=120))
