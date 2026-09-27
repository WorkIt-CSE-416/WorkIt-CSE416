"""The shortlist is the only place a bug would be silent, so it is the only test.

Every title here was observed on a live board, including the ones that must be
rejected. Stdlib unittest, so `python3 -m unittest` runs it with nothing installed:

    cd scraper && python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import unittest

from workit_scraper.providers import Job
from workit_scraper.shortlist import classify, pick


def job(
    title: str,
    *,
    company: str = "Stripe",
    location: str | None = "New York, NY",
    seen: str = "2026-09-27",
    eid: str = "1",
    posted_at: str | None = "2026-09-20T00:00:00+00:00",
) -> Job:
    return Job(
        ats="greenhouse",
        token="stripe",
        company=company,
        external_id=eid,
        title=title,
        apply_url=f"https://example.test/{eid}",
        location=location,
        posted_at=posted_at,
        first_seen_at=seen,
    )


class TestClassify(unittest.TestCase):
    def test_keeps_software_internships(self):
        assert classify("Software Engineer, Intern") == ("intern", "swe")
        assert classify("Software Engineer Intern (Summer 2027)") == ("intern", "swe")
        assert classify("Software Developer Intern/Co-op, Backend (Winter 2027)") == (
            "intern",
            "swe",
        )

    def test_keeps_new_grad_roles(self):
        assert classify("Software Engineer, New Grad") == ("new-grad", "swe")
        assert classify("Software Engineer, Early Career") == ("new-grad", "swe")

    def test_tags_ai_ml_when_the_title_says_so(self):
        assert classify("Machine Learning Intern/Co-op (Winter 2027)") == ("intern", "ai-ml")
        tags = classify("Systems Research Engineer Intern - GPU Programming")
        assert tags[0] == "intern"
        assert "ai-ml" in tags and "swe" in tags

    def test_rejects_roles_with_no_early_career_stage(self):
        assert classify("Senior Software Engineer") == ()
        assert classify("Staff Machine Learning Engineer") == ()

    def test_rejects_early_career_roles_outside_software(self):
        assert classify("Marketing Intern") == ()
        assert classify("Sales Engineer Intern") == ()
        assert classify("Mechanical Engineering Co-op") == ()
        assert classify("Customer Support Intern") == ()

    def test_rejects_any_level_postings_that_merely_mention_junior(self):
        # Observed on Together AI's live board: one opening advertised at every level.
        # It matches \bjunior\b but is not a new-grad role.
        assert classify("Junior/Senior or Staff Software Engineer, Inference / Compute") == ()
        assert classify("[Junior / Senior / Staff] Software Engineer, Inference") == ()

    def test_internal_is_not_an_internship(self):
        # \bintern\b must not fire on "internal". This is the regex slip that would
        # quietly flood the page with senior roles.
        assert classify("Senior Full-Stack Engineer, Internal Applications") == ()

    def test_rejects_empty_title(self):
        assert classify("") == ()


class TestPick(unittest.TestCase):
    def test_collapses_one_role_posted_per_office(self):
        postings = [
            job("Software Engineer, New Grad", location=city, eid=str(i))
            for i, city in enumerate(
                ["New York, NY", "SF", "Seattle", "Chicago", "Austin", "Boston", "Remote"]
            )
        ]
        roles = pick(postings)
        assert len(roles) == 1
        assert roles[0].location_label == "7 locations"

    def test_keeps_suffixed_variants_separate(self):
        roles = pick(
            [
                job(
                    "Forward Deployed Software Engineer, Internship - Commercial",
                    company="Palantir",
                    eid="a",
                ),
                job(
                    "Forward Deployed Software Engineer, Internship - US Government",
                    company="Palantir",
                    eid="b",
                ),
            ]
        )
        assert len(roles) == 2

    def test_same_title_at_different_companies_stays_separate(self):
        roles = pick(
            [
                job("Software Engineer, Intern", company="Stripe", eid="a"),
                job("Software Engineer, Intern", company="Figma", eid="b"),
            ]
        )
        assert {role.company for role in roles} == {"Stripe", "Figma"}

    def test_keeps_the_earliest_first_seen(self):
        roles = pick(
            [
                job("Software Engineer, Intern", seen="2026-09-27", eid="a"),
                job("Software Engineer, Intern", seen="2026-09-20", eid="b"),
            ]
        )
        assert roles[0].first_seen_at == "2026-09-20"

    def test_drops_everything_that_does_not_classify(self):
        assert pick([job("Senior Software Engineer"), job("Marketing Intern")]) == []

    def test_single_location_prints_the_place_not_a_count(self):
        roles = pick([job("Software Engineer, Intern", location="Toronto")])
        assert roles[0].location_label == "Toronto"

    def test_a_posting_with_no_location_gets_no_label(self):
        roles = pick([job("Software Engineer, Intern", location=None)])
        assert roles[0].location_label == ""

    def test_orders_dated_roles_before_undated_ones(self):
        roles = pick(
            [
                job("Software Engineer Intern", company="X", posted_at=None, eid="z"),
                job("Software Engineer, Intern", company="Y", eid="y"),
            ]
        )
        assert roles[-1].posted_at is None


if __name__ == "__main__":
    unittest.main()
