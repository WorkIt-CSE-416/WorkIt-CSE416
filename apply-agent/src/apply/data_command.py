"""`apply data`: what the data folder holds, masked, so an agent can inspect it without reading a value (KAN-664).

`apply data keys [FILE]` lists each file, and each key of a YAML or JSON file with its shape. `apply data show-key
KEY [--file FILE]` shows one key the same way, down its tree. No path here prints a value; a key that is itself
private (an address used as a key) is scrubbed too. Worker profiles are one line: they hold cookies, never read here."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml

from apply import masked
from apply.home import HOME

DEFAULT_FILE = "applicant-profile.yaml"
NOT_WALKED = {"profiles", "rehearsals", "traces", "records", "tailored", "sent", "repairs"}
STRUCTURED = {".yaml", ".yml", ".json"}


class Refused(Exception):
    """The file or key can't be shown, and why."""


def _inside(name: str, home: Path) -> Path:
    path = (home / name).resolve()
    if not path.is_relative_to(home.resolve()):
        raise Refused(f"{name} is outside the data folder.")
    if not path.is_file():
        raise Refused(f"No file {name} in the data folder. `apply data keys` lists them.")
    return path


def _tree(path: Path) -> Any:
    try:
        return json.loads(path.read_text()) if path.suffix == ".json" else yaml.safe_load(path.read_text())
    except (ValueError, yaml.YAMLError, UnicodeDecodeError) as error:
        raise Refused(f"{path.name} doesn't parse ({type(error).__name__}).") from error


def _key(name: Any) -> str:
    return masked.scrub(str(name))


def _lines(value: Any, key: str = "") -> Iterator[str]:
    """Each leaf under `value` and its shape. A list says its size, and then its items' keys once, as key[]."""
    if isinstance(value, dict) and value:
        for name, inner in value.items():
            yield from _lines(inner, f"{key}.{_key(name)}" if key else _key(name))
    elif isinstance(value, list) and value:
        yield f"{key}  {masked.shape(value)}"
        seen = set()
        for inner in value:
            for line in _lines(inner, f"{key}[]"):
                name = line.split("  ", 1)[0]
                if name not in seen:
                    seen.add(name)
                    yield line
    else:
        yield f"{key}  {masked.shape(value)}"


def keys(file: str | None = None, home: Path = HOME) -> list[str]:
    if file:
        path = _inside(file, home)
        if path.suffix not in STRUCTURED:
            return [_file_line(path, home)]
        return list(_lines(_tree(path)))
    found = []
    for path in sorted(home.iterdir()) if home.is_dir() else []:
        if path.is_dir():
            found.append(f"{path.name}/  <folder{', not listed' if path.name in NOT_WALKED else ''}>")
            if path.name not in NOT_WALKED:
                found += [_file_line(p, home) for p in sorted(path.rglob("*")) if p.is_file() and not p.is_symlink()]
        elif path.is_file() and not path.is_symlink():
            found.append(_file_line(path, home))
            if path.suffix in STRUCTURED:
                try:
                    found += [f"  {line}" for line in _lines(_tree(path))]
                except Refused as refused:
                    found.append(f"  {refused}")
    return found


def _file_line(path: Path, home: Path) -> str:
    return f"{_key(path.relative_to(home))}  <file, {path.stat().st_size} bytes>"


def show_key(key: str, file: str | None = None, home: Path = HOME) -> list[str]:
    value = _tree(_inside(file or DEFAULT_FILE, home))
    for part in key.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            raise Refused(f"No key {_key(key)} in {file or DEFAULT_FILE}. `apply data keys {file or DEFAULT_FILE}` lists them.")
    return list(_lines(value, _key(key)))
