"""A description's sections (KAN-229): which lines are headings, and what each holds.

A bullet read as a heading cuts a section in two and files its text under the wrong
name; a heading read as content leaves a section inside the one before it. Both
still return sections, so neither fails loudly. Every heading here was seen in a
scraped description on the 2026-10-16 feed.
"""

from __future__ import annotations

import pytest

from workit_scraper import providers
from workit_scraper.details import Pay
from workit_scraper.sections import INTRO, heading, kept, split


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

    def test_a_whole_posting_job_description_heading_opens_nothing(self) -> None:
        # Workday's records open with it (Bose, General Motors).
        sections = split("Job Description\nAbout Bose\nYou know the moment.")

        assert [(s.key, s.heading) for s in sections] == [("company", "About Bose")]


# SpaceX's shape: requirements, then pay, then a second requirement.
SPACEX_SHAPED = """SpaceX was founded under the belief that humanity should explore the stars.
Responsibilities
Write flight software for Starship.
Basic Qualifications
Bachelor's degree in computer science.
Compensation
Software Engineer/Level I: $125,000.00 - $150,000.00/per year
ITAR Requirements
Applicant must be a U.S. citizen or national.
Benefits
Comprehensive medical, vision, and dental coverage.
Equal Opportunity Employer
SpaceX is an equal opportunity employer."""


class TestKept:
    def test_the_kept_sections_come_in_a_fixed_order_under_fixed_headings(self) -> None:
        assert kept(SPACEX_SHAPED) == (
            "SpaceX was founded under the belief that humanity should explore the stars.\n"
            "Responsibilities\n"
            "Write flight software for Starship.\n"
            "Requirements\n"
            "Bachelor's degree in computer science.\n"
            "Applicant must be a U.S. citizen or national.\n"
            "Pay\n"
            "Software Engineer/Level I: $125,000.00 - $150,000.00/per year"
        )

    def test_benefits_and_legal_text_are_left_out(self) -> None:
        text = kept(SPACEX_SHAPED)

        assert text is not None
        assert "dental" not in text
        assert "equal opportunity" not in text

    def test_the_company_pitch_is_left_out_but_the_role_kept(self) -> None:
        text = kept(ROBINHOOD_SHAPED)

        assert text == (
            "Join us in building the future of finance.\n"
            "Overview\n"
            "You will join the Android team and ship features to millions of customers.\n"
            "Responsibilities\n"
            "Explore and build innovative Android UI/UX\n"
            "Write well-tested Kotlin\n"
            "Requirements\n"
            "A solid foundation in software engineering\n"
            "Familiarity with Kotlin or Java"
        )

    def test_a_line_that_is_only_a_kept_heading_is_dropped(self) -> None:
        # The backend finds a section by its heading line, so no content line may be one.
        text = kept("Requirements:\nRequirements\nA degree in CS")

        assert text == "Requirements\nA degree in CS"

    def test_a_posting_that_keeps_nothing_is_kept_whole(self) -> None:
        # Every heading names a left-out section: the headings were misread.
        whole = "About Us\nWe build robots and you will write their firmware in C."

        assert kept(whole) == whole

    @pytest.mark.parametrize("text", [SPACEX_SHAPED, ROBINHOOD_SHAPED])
    def test_the_stored_format_reads_back_the_same(self, text: str) -> None:
        # Every KEPT heading is one the splitter reads, so formatting twice
        # changes nothing: a bare "Pay" once fell into the section before it.
        once = kept(text)

        assert kept(once) == once

    def test_no_text_keeps_nothing(self) -> None:
        assert kept(None) is None
        assert kept("") is None


class TestStoredPage:
    def test_pay_in_a_left_out_section_still_reaches_the_card(self) -> None:
        # Facts are read from the whole text before the boilerplate is left out.
        full = (
            "Responsibilities\nBuild data pipelines.\n"
            "Benefits\nThe pay for this role is $30-$40 per hour, plus a housing stipend."
        )

        page = providers._page("Data Engineering Intern", full)

        assert page.description == "Responsibilities\nBuild data pipelines."
        assert page.facts.pay == Pay("USD", 30, 40, "hour")


class TestInlineLabels:
    """Fix 1: a label and its text on one line ("Overview: This is the team…")."""

    def test_an_inline_label_moves_its_line_and_the_open_section_carries_on(self) -> None:
        # Tenstorrent's AI Software Intern: its role summary was in the intro.
        text = (
            "Tenstorrent is leading the industry on cutting-edge AI technology.\n"
            "Overview: This is the team that makes it run on Tenstorrent hardware.\n"
            "This role is on-site based out of Austin, TX or Santa Clara, CA."
        )

        assert [(s.key, s.heading, s.text) for s in split(text)] == [
            (INTRO, None, "Tenstorrent is leading the industry on cutting-edge AI technology."),
            ("role", "Overview", "This is the team that makes it run on Tenstorrent hardware."),
            (INTRO, None, "This role is on-site based out of Austin, TX or Santa Clara, CA."),
        ]

    def test_a_label_inside_a_list_covers_itself_alone(self) -> None:
        text = "Responsibilities\nShip kernels\nLocation: Austin, TX\nProfile models"

        assert [(s.key, s.text) for s in split(text)] == [
            ("responsibilities", "Ship kernels"),
            ("logistics", "Austin, TX"),
            ("responsibilities", "Profile models"),
        ]

    def test_a_bonus_item_in_a_requirements_list_is_preferred(self) -> None:
        # Ambrook's requirements list marks its nice-to-haves inline.
        text = "Requirements\n- Strong Python\n- Bonus: Experience with Typescript, React."

        sections = split(text)

        assert [s.key for s in sections] == ["requirements", "preferred"]
        assert sections[1].text == "Experience with Typescript, React."

    def test_a_label_naming_the_open_section_is_content(self) -> None:
        text = "Requirements\nExperience: 2+ years of Python"

        assert [(s.key, s.text) for s in split(text)] == [
            ("requirements", "Experience: 2+ years of Python")
        ]

    @pytest.mark.parametrize(
        "line",
        [
            # A time, not a label.
            "Hours are 9:00 AM to 5:00 PM.",
            # A label that names no section.
            "Kernels: Develops high performance kernels on Tenstorrent hardware",
        ],
    )
    def test_a_line_that_is_not_a_section_label_stays_in_place(self, line: str) -> None:
        sections = split(f"Responsibilities\nShip kernels\n{line}")

        assert sections[0].key == "responsibilities"
        assert line in sections[0].text

    def test_a_line_ending_at_its_colon_is_a_heading_not_a_label(self) -> None:
        # Palantir's: the text it heads is on the lines after it.
        text = "Requirements\nA CS degree\nTo apply, please submit the following:\nA resume"

        assert [(s.key, s.text) for s in split(text)] == [
            ("requirements", "A CS degree"),
            ("apply", "A resume"),
        ]
