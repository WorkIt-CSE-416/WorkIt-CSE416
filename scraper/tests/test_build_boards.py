"""Apply links to board slugs: a pattern that misses grows no boards and says nothing.

Every link that names a board is from the curated lists build_boards.py reads, as
they were on 2026-10-10. The ones that name none are each provider's own addresses.
"""

from __future__ import annotations

import pytest

from build_boards import PATTERNS


def slugs(link: str) -> list[tuple[str, str]]:
    return [(ats, token) for ats, pattern in PATTERNS.items() for token in pattern.findall(link)]


@pytest.mark.parametrize(
    ("link", "board"),
    [
        ("https://apply.workable.com/coldquanta/j/32919D6F52/apply", ("workable", "coldquanta")),
        (
            "https://apply.workable.com/quadric-dot-i-o-inc/j/4F8EDFF366/apply",
            ("workable", "quadric-dot-i-o-inc"),
        ),
        ("https://1x.recruitee.com/o/data-analytics-intern", ("recruitee", "1x")),
        (
            "https://hardrockdigital.recruitee.com/o/associate-ai-agent-analyst",
            ("recruitee", "hardrockdigital"),
        ),
        ("https://nexthopai.bamboohr.com/careers/24", ("bamboohr", "nexthopai")),
        ("https://specteraerospace.bamboohr.com/careers/121/", ("bamboohr", "specteraerospace")),
    ],
)
def test_an_apply_link_names_its_board(link: str, board: tuple[str, str]) -> None:
    assert slugs(link) == [board]


@pytest.mark.parametrize(
    "link",
    [
        # Workable's account-less short link and its API name no board.
        "https://apply.workable.com/j/81B46579FE",
        "https://apply.workable.com/api/v1/widget/accounts/huggingface",
        # The vendors' own sites.
        "https://www.bamboohr.com/careers",
        "https://www.recruitee.com/",
    ],
)
def test_links_that_name_no_board(link: str) -> None:
    assert slugs(link) == []
