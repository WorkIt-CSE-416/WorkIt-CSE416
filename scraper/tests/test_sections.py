"""A description's sections (KAN-229): which lines are headings, and what each holds.

A bullet read as a heading cuts a section in two and files its text under the wrong
name; a heading read as content leaves a section inside the one before it. Both
still return sections, so neither fails loudly. Every heading here was seen in a
scraped description on the 2026-10-16 feed.
"""

from __future__ import annotations

import pytest

from workit_scraper.sections import INTRO, heading, split


class TestHeading:
    @pytest.mark.parametrize(
        ("line", "key"),
        [
            ("Responsibilities", "responsibilities"),
            ("What you'll do", "responsibilities"),
            ("What you’ll do", "responsibilities"),
            ("Key Responsibilities:", "responsibilities"),
            ("Essential Functions", "responsibilities"),
            ("How you'll make an impact", "responsibilities"),
            ("Requirements", "requirements"),
            ("Basic Qualifications", "requirements"),
            ("What we're looking for", "requirements"),
            ("What We Require", "requirements"),
            ("Who you are", "requirements"),
            ("Experience", "requirements"),
            ("ITAR Requirements", "requirements"),
            ("Preferred Qualifications", "preferred"),
            ("Nice to have", "preferred"),
            ("Bonus Points", "preferred"),
            ("We Prefer", "preferred"),
            ("About the role", "role"),
            ("About the team + role", "role"),
            ("Position Overview", "role"),
            ("The Internship", "role"),
            ("Technologies We Use", "role"),
            ("Who we are", "company"),
            ("About Us", "company"),
            ("About Stripe", "company"),
            ("Company Overview", "company"),
            ("A World-Changing Company", "company"),
            ("Our Values", "company"),
            ("Compensation", "pay"),
            ("Salary", "pay"),
            ("Hourly PhD Pay", "pay"),
            ("Estimated Starting Salary Range", "pay"),
            ("Benefits", "benefits"),
            ("What we offer", "benefits"),
            ("Life at Palantir", "benefits"),
            ("Why join us?", "benefits"),
            ("EEO Statement", "legal"),
            ("Equal Opportunity Employer", "legal"),
            ("Export Control", "legal"),
            ("Recruiting Fraud Alert", "legal"),
            ("#LI-Hybrid", "legal"),
            ("Interview Process", "apply"),
            ("To apply, please submit the following:", "apply"),
            ("Work Schedule", "logistics"),
            ("Internship Details", "logistics"),
            ("Location: Remote", "logistics"),
        ],
    )
    def test_a_real_heading_opens_its_section(self, line: str, key: str) -> None:
        assert heading(line) == key

    @pytest.mark.parametrize(
        ("line", "key"),
        [
            # Notices before pay: a disclosure is legal text, not the pay itself.
            ("Pay Transparency Disclosure", "legal"),
            # Benefits before pay: this heading opens the perks list.
            ("Compensation & Benefits", "benefits"),
            # Preferred before requirements.
            ("Preferred Skills and Experience", "preferred"),
            # Responsibilities before role.
            ("Role and Responsibilities", "responsibilities"),
        ],
    )
    def test_the_order_decides_a_heading_two_sections_could_claim(
        self, line: str, key: str
    ) -> None:
        assert heading(line) == key

    @pytest.mark.parametrize(
        "line",
        [
            # Bullets and list items: short, but no section's name.
            "Python",
            "Onsite gym",
            "Relocation assistance",
            "Experience with Git",
            "Strong knowledge of CS fundamentals",
            # A comma makes a list item, even with a section word in it.
            "Medical, dental, and vision insurance",
            "Generous vacation policy, plus holidays",
            # Sentences, however short.
            "We value curiosity and ownership.",
            "you will build tools for our customers",
            "In this role, you will partner with our product team to ship new features "
            "to millions of customers every week",
            "",
        ],
    )
    def test_content_is_not_a_heading(self, line: str) -> None:
        assert heading(line) is None


ROBINHOOD_SHAPED = """Join us in building the future of finance.
About the team + role
You will join the Android team and ship features to millions of customers.
What you'll do
Explore and build innovative Android UI/UX
Write well-tested Kotlin
What you bring
A solid foundation in software engineering
Familiarity with Kotlin or Java
What we offer
Market competitive compensation structure
Commuter benefits
EEO Statement
We are an equal opportunity employer."""


class TestSplit:
    def test_a_posting_splits_under_its_headings_in_order(self) -> None:
        sections = split(ROBINHOOD_SHAPED)

        assert [s.key for s in sections] == [
            INTRO,
            "role",
            "responsibilities",
            "requirements",
            "benefits",
            "legal",
        ]
        assert sections[0].heading is None
        assert sections[2].heading == "What you'll do"
        assert (
            sections[2].text
            == "Explore and build innovative Android UI/UX\nWrite well-tested Kotlin"
        )

    def test_a_list_item_that_names_a_section_stays_in_its_list(self) -> None:
        benefits = next(s for s in split(ROBINHOOD_SHAPED) if s.key == "benefits")

        # Names pay, but is the first item under What we offer.
        assert "Market competitive compensation structure" in benefits.text
        # Names benefits, the section already open.
        assert "Commuter benefits" in benefits.text
        assert not any(s.key == "pay" for s in split(ROBINHOOD_SHAPED))

    def test_a_preferred_list_keeps_an_item_that_names_requirements(self) -> None:
        sections = split("We prefer:\nStrong communication skills\nExperience with Go")

        assert [(s.key, s.heading) for s in sections] == [("preferred", "We prefer")]
        assert sections[0].text == "Strong communication skills\nExperience with Go"

    def test_a_posting_with_no_heading_is_one_intro(self) -> None:
        text = "We are hiring interns to build robots.\nYou will write firmware in C."

        assert [(s.key, s.text) for s in split(text)] == [(INTRO, text)]

    def test_a_heading_with_nothing_under_it_is_left_out(self) -> None:
        sections = split("Requirements\nA degree in CS\nBenefits")

        assert [s.key for s in sections] == ["requirements"]

    def test_no_text_is_no_sections(self) -> None:
        assert split(None) == ()
        assert split("") == ()
