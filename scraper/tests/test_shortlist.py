"""The shortlist: a bad pattern here still renders a plausible, wrong page.

Every title here was observed on a live board, including the ones that must be
rejected.
"""

from __future__ import annotations

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
    url: str | None = None,
) -> Job:
    return Job(
        ats="greenhouse",
        token="stripe",
        company=company,
        external_id=eid,
        title=title,
        apply_url=url or f"https://example.test/{eid}",
        location=location,
        posted_at=posted_at,
        first_seen_at=seen,
    )


class TestClassify:
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
        assert tags == ("intern", "ai-ml")

    def test_engineer_alone_is_not_a_software_signal(self):
        # All observed live. Wade Trim is a civil engineering firm, Olsson does roads
        # and water, Rocket Lab does aerospace hardware. Each posts a real early-career
        # engineering role, and none of them belong on a page titled "software".
        assert classify("Engineer Summer Intern - #3036") == ()
        assert classify("Entry-Level Roadway Engineer") == ()
        assert classify("Thermal Engineering Intern Summer 2027") == ()
        assert classify("2027 New Graduate - Nuclear Engineer") == ()
        assert classify("2027 New Graduate - Materials Engineer") == ()
        assert classify("Structural Engineering Internship - Federal Infrastructure") == ()
        assert classify("Harness Design Engineer Intern (Winter 2027)") == ()

    def test_named_software_specialisms_still_qualify(self):
        # The other side of the same rule, also all observed live.
        for title in (
            "Software Developer Intern, Web (Summer 2027)",
            "Software Engineering Intern, Android (Summer 2027)",
            "SRE / Platform Infrastructure Engineer Intern",
            "Data Infrastructure Engineer Intern",
            "Embedded Software Engineer Co-op",
            "Reactor Software Engineering Intern - Summer 2027",
        ):
            assert "swe" in classify(title), title

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

    def test_hardware_engineering_is_out_but_hardware_ml_research_is_in(self):
        # Both observed on IMC's live board. The exclusion is the phrase "hardware
        # engineer", not the word "hardware", so the ML research role survives.
        assert classify("Graduate Hardware Engineer") == ()
        assert classify("Hardware Machine Learning PhD Research Internship") == (
            "intern",
            "ai-ml",
        )

    def test_firmware_and_embedded_are_software(self):
        # Samsara and Verkada respectively; both are software roles.
        assert classify("Firmware Engineer Co-Op") == ("intern", "swe")
        assert classify("Embedded Software Engineering Intern 2027") == ("intern", "swe")

    def test_internal_is_not_an_internship(self):
        # \bintern\b must not fire on "internal". This is the regex slip that would
        # quietly flood the page with senior roles.
        assert classify("Senior Full-Stack Engineer, Internal Applications") == ()

    def test_rejects_empty_title(self):
        assert classify("") == ()


def roles_of(jobs: list[Job]) -> list:
    """`pick` for tests that are not about newness."""
    return pick(jobs, is_new=lambda _: False)


class TestPick:
    def test_each_application_is_its_own_role(self):
        # Stripe posts "Software Engineer, New Grad" once per office, each with its
        # own application. Collapsing them would leave one link and hide six jobs.
        postings = [
            job("Software Engineer, New Grad", location=city, eid=str(i))
            for i, city in enumerate(
                ["New York, NY", "SF", "Seattle", "Chicago", "Austin", "Boston", "Remote"]
            )
        ]
        roles = roles_of(postings)
        assert len(roles) == 7
        assert {role.location_label for role in roles} == {job.location for job in postings}

    def test_copies_of_one_application_collapse(self):
        url = "https://example.test/shared"
        roles = roles_of(
            [
                job("Software Engineer, Intern", location="Toronto", eid="a", url=url),
                job("Software Engineer, Intern", location="Seattle", eid="b", url=url),
            ]
        )
        assert len(roles) == 1
        assert roles[0].location_label == "2 locations"

    def test_keeps_suffixed_variants_separate(self):
        roles = roles_of(
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
        roles = roles_of(
            [
                job("Software Engineer, Intern", company="Stripe", eid="a"),
                job("Software Engineer, Intern", company="Figma", eid="b"),
            ]
        )
        assert {role.company for role in roles} == {"Stripe", "Figma"}

    def test_the_earliest_copy_decides_whether_a_role_is_new(self):
        # A new copy of an application we already knew is not a new role.
        url = "https://example.test/shared"
        roles = pick(
            [
                job("Software Engineer, Intern", seen="2026-09-27", eid="a", url=url),
                job("Software Engineer, Intern", seen="2026-09-20", eid="b", url=url),
            ],
            is_new=lambda posting: posting.first_seen_at == "2026-09-27",
        )
        assert [role.new for role in roles] == [False]

    def test_drops_everything_that_does_not_classify(self):
        assert roles_of([job("Senior Software Engineer"), job("Marketing Intern")]) == []

    def test_single_location_prints_the_place_not_a_count(self):
        roles = roles_of([job("Software Engineer, Intern", location="Toronto")])
        assert roles[0].location_label == "Toronto"

    def test_a_posting_with_no_location_gets_no_label(self):
        roles = roles_of([job("Software Engineer, Intern", location=None)])
        assert roles[0].location_label == ""

    def test_orders_dated_roles_before_undated_ones(self):
        roles = roles_of(
            [
                job("Software Engineer Intern", company="X", posted_at=None, eid="z"),
                job("Software Engineer, Intern", company="Y", eid="y"),
            ]
        )
        assert roles[-1].posted_at is None
