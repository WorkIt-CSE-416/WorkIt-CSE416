"""feed.json is the backend's only view of the shortlist: a wrong row here is a wrong
card in the app, with nothing on the scraper's own page to show it.

The roles below are shaped after ones in jobs.json on 2026-09-28.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from workit_scraper import feed
from workit_scraper.shortlist import Role, Tag


def role(**changes: object) -> Role:
    base = {
        "title": "Software Engineering Intern",
        "company": "Terranova",
        "apply_url": "https://jobs.ashbyhq.com/terranova/a8e5a8d2/application",
        "ats": "ashby",
        "board_key": "ashby/terranova",
        "tags": (Tag.INTERN, Tag.SWE),
        "posted_at": "2026-09-26T02:53:16.063000+00:00",
        "new": False,
        "department": None,
        "work_style": "On site",
        "locations": ("Berkeley",),
    }
    return Role(**{**base, **changes})


LOGO = "https://app.ashbyhq.com/api/images/org-theme-logo/f789d90e/terranova.png"


def feed_row(r: Role) -> dict[str, object]:
    return feed.row(r, {"ashby/terranova": LOGO})


class TestRow:
    def test_logo_is_looked_up_by_board(self) -> None:
        assert feed_row(role())["logo_url"] == LOGO
        assert feed_row(role(board_key="lever/nologo"))["logo_url"] is None

    def test_labels_become_the_schemas_enum_values(self) -> None:
        row = feed_row(role())
        assert row["work_style"] == "onsite"
        assert row["experience_level"] == "internship"
        assert row["id"] == "https://jobs.ashbyhq.com/terranova/a8e5a8d2/application"

    def test_new_grad_whatever_the_topic(self) -> None:
        # Quora: "Software Engineer New Grad, Machine Learning Platform" -- two topics.
        tags = (Tag.NEW_GRAD, Tag.AI_ML, Tag.SWE)
        assert feed_row(role(tags=tags))["experience_level"] == "new_grad"

    def test_unstated_facts_are_null_not_guessed(self) -> None:
        # A Greenhouse board states no work model, and a role can lack a date.
        row = feed_row(role(work_style=None, posted_at=None, locations=()))
        assert row["work_style"] is None
        assert row["posted_at"] is None
        assert row["location"] is None

    def test_several_offices_read_as_a_count(self) -> None:
        row = feed_row(role(locations=("New York, NY", "Seattle, WA", "Remote")))
        assert row["location"] == "3 locations"

    def test_an_unknown_work_style_label_fails_loudly(self) -> None:
        with pytest.raises(KeyError):
            feed_row(role(work_style="Flexible"))


class TestWrite:
    def test_keeps_picks_order(self, tmp_path: Path) -> None:
        roles = [role(title="B Intern"), role(title="A Intern")]
        path = tmp_path / "feed.json"
        feed.write(roles, {}, path)
        rows = json.loads(path.read_text(encoding="utf-8"))
        assert [r["title"] for r in rows] == ["B Intern", "A Intern"]
