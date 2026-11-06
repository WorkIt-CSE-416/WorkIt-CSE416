"""The Applicant profile: the facts Lisul gives once.

It is read and written with ruamel.yaml's round trip, so a Missing fact Lisul
answers is saved into the file without losing his comments or its order.
"""

import json
import re
import threading
from pathlib import Path
from typing import Any

import yaml
from ruamel.yaml import YAML

from apply.home import CODE, HOME

# The default answer policies (consent boxes, opt-ins, compensation, defense roles), in the checkout.
POLICIES = CODE / "policies.default.yaml"
# The applicant's own policies.yaml in the data folder overrides the defaults key by key.
OVERRIDE = HOME / "policies.yaml"
# Keys that would hold a secret. Secrets live only in Keychain or gitignored files.
SECRET = re.compile(r"password|passwd|secret|token|api[_ -]?key|private[_ -]?key|credential", re.IGNORECASE)
# Answers to Missing facts that no profile key holds, by the question's wording.
ANSWERED = "answered_questions"
JOINED_FROM = ("identity", "education", "links")  # facts a whole form section shows at once


class ApplicantProfile:
    """Workers add Lisul's answers from their own threads while the
    Orchestrator saves, so every write and save takes one lock."""

    def __init__(self, facts: dict, home: Path, policies: dict | None = None, path: Path | None = None):
        self._lock = threading.RLock()
        self._facts = facts
        self._changes: list[tuple[str, ...]] = []  # what this process set, to lay over the file as it is now
        self._home = home
        self._policies = policies or {}
        self._path = path

    @classmethod
    def load(cls, path: Path, policies: Path = POLICIES) -> "ApplicantProfile":
        """A policies.yaml beside the profile overrides `policies` key by key."""
        facts = _yaml().load(path.read_text()) or {}
        _refuse_secrets(facts)
        rules = load_policies(policies)
        beside = path.parent / "policies.yaml"
        if beside.exists() and beside.resolve() != policies.resolve():
            rules |= yaml.safe_load(beside.read_text()) or {}
        return cls(facts, path.parent, rules, path)

    def save(self) -> None:
        """Write this process's changes into the profile's file as it is now:
        the copy loaded at its start would undo what changed on disk since
        (seen live: a rehearsal's dashboard answer dropped a fact added meanwhile)."""
        with self._lock:
            facts = (_yaml().load(self._path.read_text()) or {}) if self._path.exists() else {}
            for change in self._changes:
                _apply(facts, *change)
            _refuse_secrets(facts)
            with self._path.open("w") as f:
                _yaml().dump(facts, f)
            self._facts, self._changes = facts, []

    @property
    def folder(self) -> Path:
        """The folder the profile is in: the data folder, unless --profile named another."""
        return self._home

    def get(self, key: str) -> Any:
        """A fact by dotted key, such as "identity.email". A file's path is absolute, from the home
        folder (~/...), or relative to the profile's folder: the data folder, APPLY_HOME."""
        value = _lookup(self._facts, key)
        if value is not None and key.startswith("files."):
            return self._home / Path(value).expanduser()
        return value

    def set(self, key: str, value: Any) -> None:
        """Set a fact by dotted key, creating its sections as needed."""
        with self._lock:
            _apply(self._facts, "set", key, value)
            self._changes.append(("set", key, value))

    def facts(self) -> dict:
        """Every fact, as plain data (a copy)."""
        with self._lock:
            return json.loads(json.dumps(self._facts, default=str))

    def tree(self) -> dict:
        """Every fact as loaded, dates as dates: for the Fill engine, which must not change it."""
        return self._facts

    def policies(self) -> dict:
        """Every policy, by section."""
        return self._policies

    def answered(self, question: str) -> str | None:
        """Lisul's answer to a question no profile key holds, by its wording."""
        return (self._facts.get(ANSWERED) or {}).get(question.strip())

    def set_answered(self, question: str, answer: str) -> None:
        """Lisul's answer to `question`, kept by its wording; never a page's values joined (KAN-693)."""
        if joins_facts(self._facts, answer):
            return
        with self._lock:
            _apply(self._facts, "answered", question.strip(), answer)
            self._changes.append(("answered", question.strip(), answer))

    def save_fact(self, key: str, value: Any) -> None:
        """Set a fact by dotted key and save the profile, refusing first, with
        nothing changed, a key that looks like it holds a secret."""
        with self._lock:
            _refuse_secrets({key: None})
            self.set(key, value)
            self.save()

    def save_answered(self, question: str, answer: Any) -> None:
        """Lisul's answer to a question no profile key holds, saved, refusing
        first, with nothing changed, a question that looks like it asks for a secret."""
        with self._lock:
            _refuse_secrets({question.strip(): None}, f"{ANSWERED}.")
            if joins_facts(self._facts, answer):
                raise ValueError(f"'{question.strip()}' was given several of the form's values at once, not one answer:"
                                 " answer it again")
            self.set_answered(question, answer)
            self.save()

    def policy(self, key: str) -> Any:
        """A policy by dotted key, such as "compensation.expectation"."""
        return _lookup(self._policies, key)


def _apply(facts: dict, kind: str, key: str, value: Any) -> None:
    """One change to the facts: a dotted key set, or an answered question."""
    if kind == "answered":
        if not isinstance(facts.get(ANSWERED), dict):
            facts[ANSWERED] = {}
        facts[ANSWERED][key] = value
        return
    *sections, last = key.split(".")
    for part in sections:
        if not isinstance(facts.get(part), dict):
            facts[part] = {}
        facts = facts[part]
    facts[last] = value


def load_policies(path: Path = POLICIES) -> dict:
    """The policies, for what runs without an Applicant profile (the dry run, the Feed):
    the defaults with the data folder's policies.yaml laid over them key by key."""
    rules = yaml.safe_load(path.read_text()) or {}
    if Path(path).resolve() == POLICIES.resolve() and OVERRIDE.is_file():
        rules |= yaml.safe_load(OVERRIDE.read_text()) or {}
    return rules


def joins_facts(facts: dict, answer: Any) -> bool:
    """Whether `answer` is a form's values joined with "; ", never one answer to one question (KAN-693): two or
    more of them his own name, contact, school or links facts, or Yes and No at once."""
    parts = {part.strip().casefold() for part in str(answer).split("; ")}
    if len(parts) < 2:
        return False
    if {"yes", "no"} <= parts:
        return True
    known = set()

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for inner in value.values():
                walk(inner)
        elif isinstance(value, str | int | float) and not isinstance(value, bool) and str(value).strip():
            known.add(str(value).strip().casefold())
    for section in JOINED_FROM:
        walk(facts.get(section))
    return len(parts & known) >= 2


def _refuse_secrets(tree: dict, prefix: str = "") -> None:
    for key, value in tree.items():
        if SECRET.search(str(key)):
            raise ValueError(f"the Applicant profile must not hold secrets: {prefix}{key}")
        if isinstance(value, dict):
            _refuse_secrets(value, f"{prefix}{key}.")


def _lookup(tree: dict, key: str) -> Any:
    value: Any = tree
    for part in key.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    return value


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.width = 4096  # never wrap: a wrapped long key (a question's wording) no longer reads back
    return y
