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
            ("Export Control", "requirements"),
            ("Export Compliance", "requirements"),
            ("Recruiting Fraud Alert", "legal"),
            ("#LI-Hybrid", "legal"),
            ("Interview Process", "apply"),
            ("To apply, please submit the following:", "apply"),
            ("Work Schedule", "logistics"),
            ("Internship Details", "logistics"),
            ("Location: Remote", "logistics"),
            # The 2026-10-17 Workday audit (docs/sections.md).
            ("Education:", "requirements"),
            ("You bring to the team:", "requirements"),
            ("What Will You Do?", "responsibilities"),
            ("Key Accountabilities", "responsibilities"),
            ("Health & Wellbeing", "benefits"),
            ("WHAT YOU WILL GAIN", "benefits"),
            ("Working Conditions:", "logistics"),
            ("Candidate AI Usage Policy", "legal"),
            ("Also helpful, but not required:", "preferred"),
            # A zero-width space before it (Morningstar).
            ("\u200bWho You Are", "requirements"),
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
            # A typed bullet makes a list item, whatever its words (Workday
            # postings type them into paragraphs).
            "• Perform other duties as assigned",
            "- Graduation date of Winter 2027 or Spring 2028",
            "· Cumulative 3.0 GPA or above (preferred)",
            "* Required skills",
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

    def test_a_heading_ending_in_a_colon_opens_its_section_straight_after_another(
        self,
    ) -> None:
        # Wade Trim: the company's pitch was stored, and embedded, as a
        # preferred qualification.
        text = (
            "Requirements\nA civil engineering degree\n"
            "Preferred Qualifications\n"
            "About Wade Trim:\nWade Trim is committed to infrastructure."
        )

        assert kept(text) == "Requirements\nA civil engineering degree"
        assert kept(kept(text)) == kept(text)

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

        # The pay line moves to Pay by what it says (fix 3), out of Benefits.
        assert page.description == (
            "Responsibilities\nBuild data pipelines.\n"
            "Pay\nThe pay for this role is $30-$40 per hour, plus a housing stipend."
        )
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


class TestHeadingVariants:
    """Fix 2: headings the 2026-10-17 audit found unread, each seen in real postings."""

    @pytest.mark.parametrize(
        ("line", "key"),
        [
            ("USA Hiring Timelines", "logistics"),
            # TensorWave's: its dates and hours, which a role pattern filed as Overview.
            ("Internship Information", "logistics"),
            ("Hybrid from one of our office locations:", "logistics"),
            ("What You Might Do", "responsibilities"),
            ("What you might work on:", "responsibilities"),
            ("WHAT YOU'LL ACHIEVE:", "responsibilities"),
            ("YOUR MISSION", "responsibilities"),
            ("What sets you apart", "preferred"),
            ("Profile:", "requirements"),
            ("WHY HARVEY", "company"),
            ("Why Fospha", "company"),
            ("Health & Wellness", "benefits"),
            ("What Celonis can offer you:", "benefits"),
            ("A NOTE ON AI", "legal"),
            ("Background Checks", "legal"),
            ("Massachusetts Applicants:", "legal"),
            ("REFERRAL INSTRUCTIONS", "apply"),
        ],
    )
    def test_an_audited_heading_opens_its_section(self, line: str, key: str) -> None:
        assert heading(line) == key

    @pytest.mark.parametrize(
        ("line", "key"),
        [
            # "Why" a company, but not the role or the perks.
            ("Why this role", "role"),
            ("Why join us?", "benefits"),
        ],
    )
    def test_why_is_the_company_only_when_it_names_one(self, line: str, key: str) -> None:
        assert heading(line) == key

    def test_insurance_in_a_requirement_is_not_a_benefits_heading(self) -> None:
        # An insurance-industry posting's requirement, which a loose "insurance"
        # would have read as the start of a benefits list.
        assert heading("Knowledge of insurance claims") is None

    def test_a_benefits_item_that_names_pay_stays_in_the_list(self) -> None:
        # Fospha's perks: "salary" in an item kept the company pitch under Pay.
        text = (
            "Benefits\n25 days' annual leave\nLife assurance worth 4x your annual salary\n"
            "Why Fospha\nReal production impact from day one."
        )

        assert [s.key for s in split(text)] == ["benefits", "company"]
        assert kept(text) == text  # nothing kept, so the whole text stays


class TestLinesSortedByWhatTheySay:
    """Fix 3: a line moves by what it says, whatever heading it sits under."""

    def test_a_pay_sentence_under_another_heading_goes_to_pay(self) -> None:
        # Tenstorrent's: under its hiring timelines, with no heading of its own.
        text = (
            "Responsibilities\nShip kernels\nUSA Hiring Timelines\nSummer Term: May–Aug.\n"
            "Compensation for all interns at Tenstorrent ranges from $50/hr - $70/hr "
            "including base and variable compensation."
        )

        assert kept(text) == (
            "Responsibilities\nShip kernels\n"
            "Pay\nCompensation for all interns at Tenstorrent ranges from $50/hr - $70/hr "
            "including base and variable compensation.\n"
            "Details\nSummer Term: May–Aug."
        )

    def test_pay_in_a_left_out_section_still_reaches_pay(self) -> None:
        text = (
            "Responsibilities\nShip kernels\nBenefits\nHealth insurance\n"
            "The pay range for this position is expected to be between $45 and $65/hour."
        )

        assert kept(text) == (
            "Responsibilities\nShip kernels\n"
            "Pay\nThe pay range for this position is expected to be between $45 and $65/hour."
        )

    def test_a_label_naming_another_section_is_left_off_a_moved_line(self) -> None:
        # Mendix's: the label is the perks list's, the sentence is the pay.
        text = (
            "Responsibilities\nShip features\nBenefits\n"
            "Comprehensive Benefits: The salary range for this position is "
            "€52,100- €78,200 annually."
        )

        stored = kept(text)

        assert stored is not None
        assert stored.endswith(
            "Pay\nThe salary range for this position is €52,100- €78,200 annually."
        )
        assert kept(stored) == stored

    @pytest.mark.parametrize(
        "line",
        [
            # Bree's and a cell phone plan: perks with a price, not the pay.
            "- Perks: $250 monthly lunch stipend, $150 monthly transportation stipend",
            "$20/pay period cell phone reimbursement",
        ],
    )
    def test_a_perk_with_a_price_is_not_pay(self, line: str) -> None:
        stored = kept(f"Responsibilities\nShip features\nBenefits\nHealth insurance\n{line}")

        assert stored == "Responsibilities\nShip features"

    def test_a_pay_line_that_mentions_a_stipend_is_still_pay(self) -> None:
        line = (
            "The estimated starting rate for this role is $25.00 an hour plus a $2,000 "
            "monthly housing stipend"
        )

        stored = kept(f"Responsibilities\nShip features\nBenefits\n{line}")

        assert stored is not None and stored.endswith(f"Pay\n{line}")

    def test_an_equal_opportunity_line_is_dropped_from_a_kept_section(self) -> None:
        text = (
            "Responsibilities\nShip kernels\n"
            "Tenstorrent is an equal opportunity employer and values diversity."
        )

        assert kept(text) == "Responsibilities\nShip kernels"

    def test_an_inline_label_whose_text_reads_as_a_heading_keeps_its_label(self) -> None:
        # Blue Origin: stored without its label, the text read back as a legal
        # heading and the requirement vanished on a second pass.
        line = "Required for all positions: Blue’s Standard Background Check"
        text = f"Benefits\nA 401(k) match\n{line}\nRequirements\nA CS degree"

        assert kept(text) == f"Requirements\n{line}\nA CS degree"
        assert kept(kept(text)) == kept(text)

    def test_a_label_naming_the_open_section_is_content_whatever_the_line_reads_as(
        self,
    ) -> None:
        line = "Required for all positions: Standard Background Check"
        text = f"Requirements\nA CS degree\n{line}"

        assert kept(text) == text

    def test_an_export_control_section_is_kept_as_requirements(self) -> None:
        # K2 Space's order: under legal, the ITAR rule left the job page entirely.
        text = (
            "Requirements\nA CS degree\n"
            "Benefits\nHealth insurance\n"
            "Export Compliance\n"
            "This role requires access to ITAR-controlled information; you must be a U.S. person."
        )

        assert kept(text) == (
            "Requirements\nA CS degree\n"
            "This role requires access to ITAR-controlled information; you must be a U.S. person."
        )

    def test_an_export_control_requirement_is_kept(self) -> None:
        # Students must meet it, unlike equal-opportunity boilerplate.
        line = "Applicant must be eligible to access U.S. export-controlled technology."

        assert kept(f"Requirements\nA CS degree\n{line}") == f"Requirements\nA CS degree\n{line}"

    def test_a_posting_whose_only_kept_line_is_its_pay_is_kept_whole(self) -> None:
        # Bose's whole posting sits under "About Bose": its pay line alone would
        # lose everything else.
        text = (
            "About Bose\nYou know the moment.\n"
            "The hiring range for this position is $21.15-$29.09 per hour."
        )

        assert kept(text) == text


class TestRoles:
    """Fix 3: each line's role in the HTML (`providers.plain_lines`) guides the walk."""

    def test_a_list_item_never_opens_a_section(self) -> None:
        # Workday lists "Good interpersonal skills", which used to open Requirements.
        text = "Responsibilities\nShip features\nGood interpersonal skills\nWrite tests"
        roles = ("h", "li", "li", "li")

        assert [s.key for s in split(text, roles)] == ["responsibilities"]

    def test_a_list_item_ending_in_a_colon_still_opens_one(self) -> None:
        text = "Requirements\nA CS degree\nPreferred:\nRust"
        roles = ("h", "li", "li", "li")

        assert [s.key for s in split(text, roles)] == ["requirements", "preferred"]

    def test_a_marked_heading_is_read_by_its_words_alone(self) -> None:
        # A comma and an ellipsis fail the shape test, not the markup.
        text = "Intro text.\nIn this internship, you will...\nWrite copy"
        roles = ("p", "b", "li")

        assert split(text, roles)[-1].key == "responsibilities"
        assert split(text)[-1].key == INTRO

    def test_a_quoted_title_is_a_heading_when_marked(self) -> None:
        text = "Intro text.\n“Let's find out about you.”\nA finance degree"
        roles = ("p", "b", "li")

        assert split(text, roles)[-1].key == "requirements"

    def test_a_bold_sentence_is_not_a_heading(self) -> None:
        text = "Logistics\nThe minimum length of the Internship must be 12 weeks.\nSummer only"
        roles = ("h", "b", "p")

        assert [s.key for s in split(text, roles)] == ["logistics"]

    def test_a_listed_line_is_stored_with_its_bullet_and_reads_back_the_same(self) -> None:
        text = "Requirements\nA CS degree\nCommunication skills"
        roles = ("h", "li", "li")

        stored = kept(text, roles)

        assert stored == "Requirements\n• A CS degree\n• Communication skills"
        assert kept(stored) == stored


class TestWhatALineSays:
    """Fix 4: a line moves out of the section its heading put it in by what it says."""

    @pytest.mark.parametrize(
        "line",
        [
            "Experience with automated testing is a plus.",
            "Spanish language proficiency is preferred",
            "Bachelor's degree (preferred)",
            "No experience required. Previous internship experience, a plus.",
        ],
    )
    def test_a_nice_to_have_goes_to_preferred(self, line: str) -> None:
        # As the scraper reads them: a heading, then a list.
        text, roles = f"Requirements\nA CS degree\n{line}", ("h", "li", "li")

        assert kept(text, roles) == (
            f"Requirements\n• A CS degree\nPreferred Qualifications\n• {line}"
        )

    @pytest.mark.parametrize(
        "line",
        [
            # A requirement with a nice-to-have aside stays a requirement.
            "Fluent in English and German (any additional language is a plus).",
            "Programming skills in C++ and/or python. Julia is a plus!",
            "Previous internship experience required. Finance internship preferred.",
        ],
    )
    def test_a_requirement_with_an_aside_stays(self, line: str) -> None:
        assert kept(f"Requirements\n{line}") == f"Requirements\n{line}"

    def test_a_qualification_in_a_duties_list_goes_to_requirements(self) -> None:
        # First Quality lists its qualifications under "Principal Accountabilities".
        text = (
            "Responsibilities\nPrepare equipment proposals.\n"
            "Standard knowledge of cost accounting principles."
        )

        assert kept(text) == (
            "Responsibilities\nPrepare equipment proposals.\n"
            "Requirements\nStandard knowledge of cost accounting principles."
        )

    def test_a_work_eligibility_line_goes_to_requirements(self) -> None:
        text = "Responsibilities\nShip code\nDetails\nVisa sponsorship is not available."

        assert kept(text) == (
            "Responsibilities\nShip code\nRequirements\nVisa sponsorship is not available."
        )

    def test_a_named_perk_and_an_apply_line_are_left_out(self) -> None:
        text = (
            "Responsibilities\nShip code\nReceive a competitive 401(k) match\n"
            "Requirements\nA CS degree\nTo apply, submit your resume and transcript."
        )

        assert kept(text) == "Responsibilities\nShip code\nRequirements\nA CS degree"

    def test_a_line_that_only_mentions_applying_stays(self) -> None:
        line = "Ability to apply critical thinking skills to client work"

        assert kept(f"Requirements\n{line}") == f"Requirements\n{line}"

    def test_discrimination_boilerplate_is_not_an_eligibility_line(self) -> None:
        text = (
            "Responsibilities\nShip code\nPay\nThe company prohibits discrimination based "
            "on race, religion or citizenship."
        )

        assert kept(text) == "Responsibilities\nShip code"


class TestHeadingVoice:
    """A heading in the company's voice opens no section about the reader."""

    @pytest.mark.parametrize(
        ("line", "key"),
        [
            # Perpay's: "make an impact" filed its products as Responsibilities.
            ("Products we’ve built to make an impact:", None),
            ("Our values", "company"),
            # "we" headings that still ask for the reader, each seen on the feed.
            ("What we look for", "requirements"),
            ("We're looking for someone who has", "requirements"),
            ("The student we’re looking for", "requirements"),
            ("Qualifications we value", "requirements"),
            ("We’re excited about you because you…", "requirements"),
            ("What you will learn with us", "responsibilities"),
        ],
    )
    def test_who_a_heading_addresses_decides(self, line: str, key: str | None) -> None:
        assert heading(line) == key
