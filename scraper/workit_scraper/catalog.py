"""The shared board CSV format and atomic, additive catalog updates."""

from __future__ import annotations

import csv
import io
import os
import tempfile
from collections.abc import Iterable
from pathlib import Path

from workit_scraper.providers import Board

BOARDS_CSV = Path(__file__).resolve().parent.parent / "boards.csv"


def load_boards(path: Path) -> list[Board]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = csv.DictReader(line for line in handle if not line.startswith("#"))
        boards = []
        for row in rows:
            ats = (row.get("ats") or "").strip()
            token = (row.get("token") or "").strip()
            if ats and token:
                boards.append(Board(ats, token, (row.get("company") or token).strip()))
    return boards


def _csv(boards: Iterable[Board], *, header: bool) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    if header:
        writer.writerow(["ats", "token", "company"])
    for board in sorted(boards, key=lambda b: (b.ats, b.token)):
        writer.writerow([board.ats, board.token, board.company])
    return output.getvalue()


def _atomic_write(path: Path, content: str) -> None:
    # A unique sibling avoids sharing a fixed .tmp name; this does not promise
    # concurrent read/modify/write transactions. Catalog writers run one at a time.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, prefix=path.name + ".",
                                         suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_boards(path: Path, boards: Iterable[Board], *, preamble: str = "") -> None:
    """Write a complete catalog selected by the caller, with LF CSV serialization."""
    _atomic_write(path, preamble + _csv(boards, header=True))


def add_boards(path: Path, boards: Iterable[Board]) -> int:
    """Append new keys only, retaining all existing names, rows, and comments."""
    exists = path.exists()
    known = {(b.ats, b.token) for b in load_boards(path)} if exists else set()
    fresh = {}
    for board in boards:
        key = (board.ats, board.token)
        if key not in known:
            fresh.setdefault(key, board)
    if not fresh:
        return 0
    prefix = path.read_text(encoding="utf-8").rstrip("\n") + "\n" if exists else ""
    _atomic_write(path, prefix + _csv(fresh.values(), header=not exists))
    return len(fresh)


def same_file(first: Path, second: Path) -> bool:
    """Catch lexical, symlink, and existing hard-link aliases before output writes."""
    return first.resolve() == second.resolve() or (
        first.exists() and second.exists() and first.samefile(second)
    )
