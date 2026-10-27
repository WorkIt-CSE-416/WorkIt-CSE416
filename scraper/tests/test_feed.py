"""feed.json is the backend's only view of the shortlist: a wrong row here is a wrong
card in the app, with nothing on the scraper's own page to show it.

The roles below are shaped after ones in jobs.json on 2026-09-28.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from workit_scraper import feed, store
from workit_scraper.details import Facts
from workit_scraper.providers import Job
from workit_scraper.shortlist import Role, Tag, pick
from workit_scraper.store import RunStats, Store


def role(**changes: object) -> Role:
    base = {
        "title": "Software Engineering Intern",
        "company": "Terranova",
        "apply_url": "https://jobs.ashbyhq.com/terranova/a8e5a8d2/application",
        "ats": "ashby",
        "board_key": "ashby/terranova",
        "tags": (Tag.INTERN, Tag.SOFTWARE),
        "posted_at": "2026-09-26T02:53:16.063000+00:00",
        "new": False,
        "department": None,
        "locations": ("Berkeley",),
        "description": None,
    }
    # The card's work style lives in the role's facts.
    style = changes.pop("work_style", "On site")
    return Role(**{**base, **changes}, facts=Facts(work_style=style))


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
        assert row["experience_level"] == "student"
        assert row["id"] == "https://jobs.ashbyhq.com/terranova/a8e5a8d2/application"

    def test_an_internship_is_its_job_type_whatever_its_hours(self) -> None:
        # KAN-233: the job type internship, for a student; hours it states
        # stay in its facts, not on the card.
        row = feed_row(role())
        assert (row["job_type"], row["experience_level"]) == ("internship", "student")

    def test_new_grad_whatever_the_category(self) -> None:
        # Quora: "Software Engineer New Grad, Machine Learning Platform".
        tags = (Tag.NEW_GRAD, Tag.DATA_AI)
        assert feed_row(role(tags=tags))["experience_level"] == "new_grad"

    def test_roles_are_its_categories_then_its_specialties(self) -> None:
        # shortlist.Tag's values, as feed.json has always carried them.
        assert feed_row(role())["roles"] == ["software"]
        # Cresta's "Machine Learning Engineering Intern".
        tags = (Tag.INTERN, Tag.DATA_AI, Tag.SOFTWARE, Tag.ML)
        assert feed_row(role(tags=tags))["roles"] == ["data_ai", "software", "data_ai/ml"]

    def test_role_category_is_left_to_the_import(self) -> None:
        # The backend dropped the old one-category column (KAN-155).
        assert "role_category" not in feed_row(role())

    def test_description_is_passed_through(self) -> None:
        # Scout reads it; the backend's JobListing carries the same field.
        assert feed_row(role(description="Build robots."))["description"] == "Build robots."
        assert feed_row(role())["description"] is None

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


class TestClosings:
    """closings.json says why each stored posting is not in the feed; the import
    writes it as `job_postings.closed_reason`. A wrong reason sends whoever reads
    it to fix the wrong thing."""

    MON = "2026-10-26T09:00:00+00:00"
    TUE = "2026-10-27T09:00:00+00:00"
    WED = "2026-10-28T09:00:00+00:00"

    def job(self, eid: str, title: str = "Software Engineer Intern", token: str = "acme") -> Job:
        return Job(
            ats="greenhouse",
            token=token,
            company=token.title(),
            external_id=eid,
            title=title,
            apply_url=f"https://example.test/{token}/{eid}",
        )

    def found(self, run: Store, *, leave_out: str | None = None) -> dict[str, str]:
        roles = pick([j for j in run.jobs if run.is_listed(j)], is_new=lambda j: False)
        return feed.closings(run, [r for r in roles if r.apply_url != leave_out])

    def runs(self, *reads: tuple[str, list[Job]]) -> Store:
        """Each (time, postings) a complete read of acme's board listing them."""
        run = None
        for at, jobs in reads:
            run = store.update(run, jobs, sorted({j.board_key for j in jobs}), RunStats(), at)
        return run

    def test_a_posting_two_reads_lacked_is_gone_from_board(self) -> None:
        kept, gone = self.job("1"), self.job("2")
        run = self.runs((self.MON, [kept, gone]), (self.TUE, [kept]), (self.WED, [kept]))
        assert self.found(run) == {gone.apply_url: "gone_from_board"}

    def test_one_missed_read_is_no_closing(self) -> None:
        kept, missed = self.job("1"), self.job("2")
        run = self.runs((self.MON, [kept, missed]), (self.TUE, [kept]))
        assert self.found(run) == {}

    def test_a_board_that_said_no_such_board_twice_is_board_gone(self) -> None:
        left = self.job("1", token="left")
        run = store.update(None, [left], [left.board_key], RunStats(), self.MON)
        for at in (self.TUE, self.WED):
            run = store.update(run, [], [], RunStats(), at, missing=[left.board_key])
        assert self.found(run) == {left.apply_url: "board_gone"}

    def test_a_title_the_shortlist_no_longer_keeps_is_filtered_out(self) -> None:
        # pick() reads every title again, so a narrowed rule drops listed postings.
        sales = self.job("1", title="Senior Sales Director")
        run = self.runs((self.MON, [sales]))
        assert self.found(run) == {sales.apply_url: "filtered_out"}

    def test_a_kept_title_another_copy_leads_is_replaced(self) -> None:
        copy = self.job("1")
        run = self.runs((self.MON, [copy]))
        assert self.found(run, leave_out=copy.apply_url) == {copy.apply_url: "replaced"}

    def test_copies_at_one_url_take_the_listed_ones_reason(self) -> None:
        listed = self.job("1", title="Senior Sales Director")
        gone = replace(self.job("2", token="other"), apply_url=listed.apply_url)
        both = [listed.board_key, gone.board_key]
        run = store.update(None, [listed, gone], both, RunStats(), self.MON)
        for at in (self.TUE, self.WED):
            run = store.update(run, [listed], both, RunStats(), at)
        assert not run.is_listed(next(j for j in run.jobs if j.board_key == gone.board_key))
        assert self.found(run) == {listed.apply_url: "filtered_out"}

    def test_it_is_written_sorted(self, tmp_path: Path) -> None:
        path = tmp_path / "closings.json"
        feed.write_closings({"https://b.test": "replaced", "https://a.test": "board_gone"}, path)
        assert list(json.loads(path.read_text(encoding="utf-8"))) == [
            "https://a.test",
            "https://b.test",
        ]
