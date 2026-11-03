"""The Match queue: which Matches this run applies to, in order. Zero tokens."""

import re
import sys
from collections import Counter
from collections.abc import Callable
from datetime import date, timedelta

from apply.feed import repost_keys
from apply.model import Posting, Status, is_company, one_line
from apply.tracker import Row

# Applications not submitted yet but on their way: each takes a slot under the cap.
IN_FLIGHT = {Status.QUEUED, Status.FILLING, Status.PAUSED, Status.HELD, Status.MISSING_FACT}
# Titles that get a company's capped slots first.
SWE_OR_ML = re.compile(
    r"software|developer|\bswe\b|\bsde\b|programmer|full[- ]stack|back[- ]?end|front[- ]?end"
    r"|machine learning|\bml\b|\bai\b|artificial intelligence|deep learning|\bllm|computer vision"
)


def match_queue(matches: list[Posting], rows: list[Row], today: date, cap: int,
                limits: dict[str, dict] | None = None,
                skipped: Callable[[Posting, str], None] = lambda posting, why: None) -> list[Posting]:
    """`matches` (newest first) that this run applies to, still newest first:
    - no Repost, and no repeated title at one company, whether already in the
      Tracker or newer in this run;
    - at most `cap` Applications per company in the 7 days to `today`
      (policies.yaml: company_cap), and at most an employer's own limit
      (`limits`, policies.yaml: employer_limits) in its window,
      counting those still on their way (queued, held, waiting on a Missing
      fact...), the slots going to SWE and ML titles first, then to the newest.
    A Match over an employer's limit is skipped, saying why on stderr and to `skipped`."""
    return _within_cap(_unseen(matches, rows), rows, today, cap, limits or {}, skipped)


def over_employer_limits(company: str, rows: list[Row], today: date, limits: dict[str, dict] | None) -> list[str]:
    """Each employer's own limit (`limits`, policies.yaml: employer_limits)
    one more Application to `company` would go over, counting `rows` as the
    Match queue does, in words. The weekly cap is not one: Requests skip it."""
    limits = limits or {}
    used = _used(rows, today, None, limits)
    return [_takes_at_most(name, count, days)
            for (_, name), count, days in _windows(company, None, limits) if used["employer_limits", name] >= count]


def _unseen(matches: list[Posting], rows: list[Row]) -> list[Posting]:
    seen = set().union(*(_keys(row.application_id, row.posting_url, row.company, row.role) for row in rows))
    fresh = []
    for posting in matches:
        keys = _keys(posting.id, posting.url, posting.company, posting.title)
        if keys & seen:
            continue
        seen |= keys
        fresh.append(posting)
    return fresh


def _keys(application_id: str, url: str, company: str, title: str) -> set[tuple[str, ...]]:
    # One title at one company gets one Application, however many reqs it has.
    return repost_keys(application_id, url) | {("title", _simple(company), _simple(title))}


def _within_cap(matches: list[Posting], rows: list[Row], today: date, cap: int,
                limits: dict[str, dict], skipped: Callable[[Posting, str], None]) -> list[Posting]:
    used = _used(rows, today, cap, limits)
    chosen = set()
    # A stable sort keeps newest first within SWE/ML titles and within the rest.
    for posting in sorted(matches, key=lambda p: not SWE_OR_ML.search(p.title.casefold())):
        windows = list(_windows(posting.company, cap, limits))
        full = [(key, count, days) for key, count, days in windows if used[key] >= count]
        if not full:
            used.update(key for key, _, _ in windows)
            chosen.add(posting.id)
        for (policy, name), count, days in full:
            if policy == "employer_limits":  # the weekly cap skips quietly, as it always has
                print(f"Skipped {posting.title} at {posting.company}: {_takes_at_most(name, count, days)}",
                      file=sys.stderr)
                skipped(posting, _takes_at_most(name, count, days))
    return [posting for posting in matches if posting.id in chosen]


def _windows(company: str, cap: int | None, limits: dict[str, dict]):
    """Each window an Application to `company` counts in: its policy and name,
    how many, in how many days. With no `cap`, only employers' own limits."""
    if cap is not None:
        yield ("company_cap", _simple(company)), cap, 7
    for name, limit in limits.items():
        if is_company(company, name):
            yield ("employer_limits", name), limit["applications"], limit["days"]


def _used(rows: list[Row], today: date, cap: int | None, limits: dict[str, dict]) -> Counter:
    """How many of `rows` count in each window: applied within it, or still on their way."""
    return Counter(
        key for row in rows for key, _, days in _windows(row.company, cap, limits)
        if row.date_applied and row.date_applied > today - timedelta(days=days) or row.status in IN_FLIGHT
    )


def _takes_at_most(name: str, count: int, days: int) -> str:
    return f"{name} takes at most {count} applications in any {days} days (policies.yaml: employer_limits)"


def _simple(text: str) -> str:
    return one_line(text.casefold())
