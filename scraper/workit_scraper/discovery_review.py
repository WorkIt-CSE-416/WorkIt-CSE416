"""Reconcile discovery proposals without undoing a developer's review decisions.

This module never writes files or talks to GitHub. Main is authoritative; the
proposal catalog and ledger are the durable record of edits made during review.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Iterable
from copy import deepcopy
from dataclasses import dataclass
from html import escape
from urllib.parse import urlsplit

from workit_scraper.providers import Board
from workit_scraper.providers.urls import board_keys


@dataclass
class ReviewUpdate:
    boards: list[Board]
    ledger: dict[str, dict]
    added: int


def _validate_ledger(ledger: dict[str, dict]) -> None:
    if not isinstance(ledger, dict) or any(
        not isinstance(key, str)
        or "/" not in key
        or not all(key.split("/", 1))
        or not isinstance(row, dict)
        or row.get("decision") not in ("proposed", "rejected")
        for key, row in ledger.items()
    ):
        raise ValueError("review ledger must map board keys to proposed/rejected records")


def validate_catalog(boards: Iterable[Board], ledger: dict[str, dict]) -> None:
    """Refuse to publish or scrape a catalog containing explicitly rejected boards.

    A ledger edit can precede the bot's next reconciliation. Before merge, the
    corresponding CSV row must also be removed; main's rows are never silently
    deleted by reconciliation after an inconsistent review has been merged.
    """
    _validate_ledger(ledger)
    rejected = {
        board.key for board in boards if ledger.get(board.key, {}).get("decision") == "rejected"
    }
    if rejected:
        raise ValueError(
            "Remove rejected CSV rows before merge; boards.csv still contains: "
            + ", ".join(sorted(rejected))
        )


def _http_url(value: object) -> bool:
    if not isinstance(value, str) or any(char.isspace() for char in value):
        return False
    try:
        parts = urlsplit(value)
        return (
            parts.scheme in {"http", "https"}
            and bool(parts.hostname)
            and parts.username is None
            and parts.password is None
        )
    except ValueError:
        return False


def _candidate(row: object) -> Board | None:
    if not isinstance(row, dict) or row.get("status") != "validated":
        return None
    names, ats, token = row.get("companies"), row.get("ats"), row.get("token")
    if (
        not isinstance(names, list)
        or len(names) != 1
        or not isinstance(names[0], str)
        or not names[0].strip()
        or not isinstance(ats, str)
        or not isinstance(token, str)
    ):
        return None
    postings = row.get("postings")
    if type(postings) is not int or postings < 0:
        return None
    evidence = row.get("evidence")
    if not isinstance(evidence, list) or not any(
        isinstance(item, dict)
        and _http_url(item.get("url"))
        and (ats, token) in board_keys(item["url"])
        and isinstance(item.get("source"), str)
        and item["source"].strip()
        and isinstance(item.get("company"), str)
        and item["company"].strip() == names[0].strip()
        for item in evidence
    ):
        return None
    return Board(ats, token, names[0].strip())


def reconcile(
    base_boards: Iterable[Board],
    proposal_boards: Iterable[Board],
    ledger: dict[str, dict],
    report: dict,
) -> ReviewUpdate:
    """Add validated candidates while retaining edits, rejections, and main rows.

    Deleting a proposed CSV row is a rejection, even if it was merged before
    another discovery run could record that decision. Rejections are permanent
    until a developer explicitly removes their ledger entry to permit discovery
    again. An already merged catalog row is never removed by this process.
    """
    _validate_ledger(ledger)
    if not isinstance(report, dict) or not isinstance(report.get("candidates"), list):
        raise ValueError("discovery report must contain a candidate list")
    timestamp = report.get("generated_at")
    if not isinstance(timestamp, str) or not timestamp.strip():
        raise ValueError("discovery report must contain generated_at")
    base = {board.key: board for board in base_boards}
    proposal = {board.key: board for board in proposal_boards}
    decisions = deepcopy(ledger)
    for key, row in decisions.items():
        if key not in proposal and key not in base:
            row["decision"] = "rejected"
        if row["decision"] == "rejected" and key not in base:
            proposal.pop(key, None)
    # Main may acquire the same board independently, or correct an existing name.
    proposal.update(base)
    eligible = [(row, _candidate(row)) for row in report["candidates"]]
    names: dict[str, set[str]] = {}
    for _, board in eligible:
        if board is not None:
            names.setdefault(board.key, set()).add(board.company)
    added = 0
    for row, board in eligible:
        if (
            board is None
            or board.key in proposal
            or decisions.get(board.key, {}).get("decision") == "rejected"
            or len(names[board.key]) != 1
        ):
            continue
        proposal[board.key] = board
        decisions[board.key] = {**deepcopy(row), "decision": "proposed", "validated_at": timestamp}
        added += 1
    return ReviewUpdate(
        sorted(proposal.values(), key=lambda board: (board.ats, board.token)), decisions, added
    )


def _code(value: object) -> str:
    return "<code>" + escape(str(value), quote=True) + "</code>"


def _link(value: object) -> str:
    if not _http_url(value):
        return _code(value)
    text = escape(str(value), quote=True)
    return f'<a href="{text}">{text}</a>'


#: Of each batch of pool boards (one run's, one `validated_at`), the share a
#: person checks, and the fewest (docs/adr/0007-trust-the-hiring-systems-name.md).
SAMPLE_SHARE = 0.1
SAMPLE_FEWEST = 5


def sampled(ledger: dict[str, dict], keys: Iterable[str]) -> set[str]:
    """The pool boards among `keys` a person checks: per batch, a random-looking
    but fixed choice, so every rendering of the review marks the same boards."""
    batches: dict[str, list[str]] = {}
    for key in keys:
        record = ledger.get(key, {})
        if record.get("kept"):
            batches.setdefault(str(record.get("validated_at")), []).append(key)
    chosen = set()
    for at, batch in batches.items():
        size = max(SAMPLE_FEWEST, math.ceil(len(batch) * SAMPLE_SHARE))
        batch.sort(key=lambda key: hashlib.sha256(f"{at} {key}".encode()).hexdigest())
        chosen.update(batch[:size])
    return chosen


def _ownership(record: dict, sample: bool) -> str:
    if not record.get("kept"):
        return "Unconfirmed; developer review required"
    if sample:
        return "<strong>Sample: check this name on the company's own website</strong>"
    return "Named by the hiring system; trusted if its batch's sample holds"


def render_review(update: ReviewUpdate, base_boards: Iterable[Board]) -> str:
    """Render review evidence as escaped HTML inside a Markdown document.

    Source-provided strings never become Markdown syntax or raw HTML. Evidence
    is historical: validation time is shown rather than claiming every pending
    board was re-read during the latest discovery run.
    """
    base = {board.key for board in base_boards}
    pending = [board for board in update.boards if board.key not in base]
    lines = [
        "# Review discovered job boards",
        "",
        "These are proposals, not approved company associations. A complete ATS read proves",
        "that the board responded, not that it belongs to the named company.",
        "",
        "Before merging, check each board's branding and jobs and corroborate ownership",
        "through the company's official website. Remove rejected rows from `boards.csv`",
        "before merging. A ledger-only `rejected` decision queues removal for the next",
        "discovery run; wait for that run or remove the CSV row yourself. Keep the ledger",
        "so future runs remember rejections. Merge only after checks pass and every",
        "remaining addition has been reviewed.",
        "",
        "New discovery runs may add rows; review the latest commit before merging.",
        "",
        "**Boards from the open-jobs pool are the exception** (ADR 0007). Each lists an",
        "early-career posting and carries the name its own hiring system gives it. Check",
        "only the boards marked Sample. If any sampled name is wrong, check every board",
        "validated at the same time as it, and remove the wrong ones.",
        "",
        f"{len(pending)} proposed board(s). "
        f"{sum(row['decision'] == 'rejected' for row in update.ledger.values())} "
        "recorded rejection(s).",
        "",
        "<table>",
        "<thead><tr><th>Company / board</th><th>Complete read</th>"
        "<th>Links and provenance</th><th>Ownership</th></tr></thead>",
        "<tbody>",
    ]
    sample = sampled(update.ledger, (board.key for board in pending))
    for board in pending:
        record = update.ledger.get(board.key, {})
        kept = record.get("kept")
        kept_cell = (
            "<br>Early career: " + ", ".join(_code(title) for title in kept)
            if isinstance(kept, list) and kept
            else ""
        )
        evidence = record.get("evidence", [])
        links = []
        for item in evidence if isinstance(evidence, list) else []:
            if not isinstance(item, dict):
                continue
            links.append(
                "Board: "
                + _link(item.get("url", ""))
                + "<br>Source: "
                + _link(item.get("source", ""))
                + "<br>Attributed company: "
                + _code(item.get("company", ""))
            )
        lines.append(
            "<tr><td>"
            + _code(board.company)
            + "<br>"
            + _code(board.key)
            + "</td><td>Postings: "
            + _code(record.get("postings", "not recorded"))
            + "<br>Validated: "
            + _code(record.get("validated_at", "not recorded"))
            + kept_cell
            + "</td><td>"
            + "<hr>".join(links)
            + "</td><td>"
            + _ownership(record, board.key in sample)
            + "</td></tr>"
        )
    lines.extend(["</tbody>", "</table>", ""])
    return "\n".join(lines)
