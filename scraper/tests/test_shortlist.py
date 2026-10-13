"""The shortlist: a bad pattern here still renders a plausible, wrong page.

Every title here was observed on a live board, including the ones that must be
rejected; the company that posted it is in a comment where it matters. Most were
read on 2026-10-10, in the scan of every board that KAN-172's twelve categories
were measured on.
"""

from __future__ import annotations

from workit_scraper.providers import Job
from workit_scraper.shortlist import CATEGORY_TAGS, Tag, classify, pick


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


def first(title: str) -> str | None:
    """The title's first category, or None if it is not kept."""
    tags = classify(title)
    return tags[1] if tags else None


class TestClassify:
    def test_keeps_software_internships(self):
        assert classify("Software Engineer, Intern") == ("intern", "software")
        assert classify("Software Engineer Intern (Summer 2027)") == ("intern", "software")
        assert classify("Software Developer Intern/Co-op, Backend (Winter 2027)") == (
            "intern",
            "software",
        )

    def test_keeps_new_grad_roles(self):
        assert classify("Software Engineer, New Grad") == ("new-grad", "software")
        assert classify("Software Engineer, Early Career") == ("new-grad", "software")

    def test_data_and_ai_when_the_title_says_so(self):
        assert classify("Machine Learning Intern/Co-op (Winter 2027)") == (
            "intern",
            "data_ai",
            "data_ai/ml",
        )
        # A research engineer researches: one category, not a software second.
        tags = classify("Systems Research Engineer Intern - GPU Programming")
        assert tags == ("intern", "data_ai", "data_ai/ml")

    def test_engineer_alone_is_not_a_signal(self):
        # Wade Trim is a civil firm, Decagon a software one: nothing in either title
        # tells them apart, so neither is kept.
        assert classify("Engineer Summer Intern - #3036") == ()
        assert classify("Engineering Intern (Summer 2027)") == ()
        assert classify("Harness Design Engineer Intern (Winter 2027)") == ()

    def test_named_software_specialisms_still_qualify(self):
        for title in (
            "Software Developer Intern, Web (Summer 2027)",
            "Software Engineering Intern, Android (Summer 2027)",
            "SRE / Platform Infrastructure Engineer Intern",
            "Data Infrastructure Engineer Intern",
            "Reactor Software Engineering Intern - Summer 2027",
        ):
            assert first(title) == "software", title

    def test_rejects_roles_with_no_early_career_stage(self):
        assert classify("Senior Software Engineer") == ()
        assert classify("Staff Machine Learning Engineer") == ()
        assert classify("Credit Analyst") == ()

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

    def test_the_categories_are_twelve(self):
        # The scraper's own keep-or-drop categories; the backend's roles are
        # its job_roles list since KAN-155.
        assert [tag.value for tag in CATEGORY_TAGS] == [
            "software",
            "data_ai",
            "hardware",
            "quant",
            "product",
            "engineering",
            "business",
            "finance",
            "marketing",
            "sales",
            "hr",
            "design",
        ]
        specialties = {tag.value for tag in Tag if "/" in tag.value}
        assert specialties == {
            "software/security",
            "data_ai/ml",
            "data_ai/data_science",
            "data_ai/analytics",
            "data_ai/data_engineering",
            "engineering/civil",
            "engineering/mechanical",
            "engineering/manufacturing",
            "engineering/aerospace",
        }


class TestStage:
    """Who fills the role, read from the title (KAN-172 added the last two)."""

    def test_a_banks_summer_analyst_is_an_intern(self):
        for title in (
            "2027 Equity Research Summer Analyst (US)",  # FT Partners
            "London Summer Investment Analyst",  # Arena Investors
            "Investment Analyst - Summer 2027",  # UVIMCO
            "Investment Banking Summer Analyst - Infrastructure M&A Advisory - Summer 2027",
        ):
            assert classify(title) == ("intern", "finance"), title

    def test_summer_alone_or_analyst_alone_is_no_stage(self):
        # JCC Greater Boston's day camp, and an analyst at any level.
        assert (
            classify("Advocate Camp Counselor for children w/disabilities, JCC Sports Camp, Summer")
            == ()
        )
        assert classify("Credit Analyst") == ()

    def test_a_working_student_is_an_intern(self):
        assert classify("Trader Assistant (Working Student)") == ("intern", "quant")  # IMC
        assert classify("Working Student -- Software Engineer: Munich") == (
            "intern",
            "software",
        )  # Uncountable
        assert classify("DSP Engineer - Werkstudent") == ("intern", "hardware")  # Axon
        assert classify("Werkstudent/in Recruiting") == ("intern", "hr")  # Clera
        assert classify("Contract Student Worker - Data Scientist") == (
            "intern",
            "data_ai",
            "data_ai/data_science",
        )  # Zoox

    def test_a_junior_manager_starts_a_career(self):
        assert classify("Junior Account Manager") == ("new-grad", "sales")  # Smartsheet
        assert classify("Junior Project Manager") == ("new-grad", "business")  # Canonical
        assert classify("Sales Partner Manager Intern") == ("intern", "sales")  # Aircall

    def test_a_manager_of_a_program_is_not_in_one(self):
        assert classify("Early Careers Lead/Program Manager") == ()  # FluidStack
        assert classify("Campus Infrastructure Project Manager") == ()  # SpaceX

    def test_who_a_recruiter_recruits_is_not_their_stage(self):
        for title in (
            "University Recruiter",  # Stripe
            "Campus Recruiter, Machine Learning and Quantitative Research",  # Jane Street
            "Early Career Talent Partner - Trading",  # Belvedere Trading
            "Campus Talent Associate",  # Bridgewater
            "Campus Relations & Events Associate",  # Chicago Trading Company
            "Early Career & University Relations Recruiter",  # Path Robotics
            "Talent Scientist - Graduate Lead",  # Canonical
        ):
            assert classify(title) == (), title

    def test_a_graduate_in_hr_is_a_graduate(self):
        assert classify("Graduate Talent Scientist") == ("new-grad", "hr")  # Canonical
        assert classify("Technical Recruiter - New Grad") == ("new-grad", "hr")

    def test_campus_recruitment_with_a_year_is_a_graduate_program(self):
        assert classify("Applied AI Engineer - China Campus Recruitment 2027") == (
            "new-grad",
            "data_ai",
            "software",
            "data_ai/ml",
        )  # Artefact

    def test_a_university_or_campus_by_name_is_a_place(self):
        assert classify("Retail Sales Associate, University Village") == ()  # Brooks
        assert classify("Bastrop Campus Planning Manager") == ()  # SpaceX
        assert classify("Software Engineering Intern - Waterloo University") == (
            "intern",
            "software",
        )  # Brave: still an intern


class TestCategories:
    """The first discipline a title names is its category. Every title was seen on a
    live board on 2026-10-10."""

    def test_quant(self):
        for title in (
            "Quantitative Researcher - Intern",  # Point72
            "Campus Quantitative Trader (Intern)",  # Jump Trading
            "Junior Algorithmic Trader",
            "Commodities Trading Intern",
            "Quantitative Risk Intern - Summer 2027",  # DV Trading
            "Trading Analyst Intern, Credit",  # Garda: the desk's analyst, not credit
        ):
            assert first(title) == "quant", title

    def test_software_at_a_trading_firm_is_software(self):
        assert classify("Campus Python Software Engineer (Intern)") == ("intern", "software")

    def test_trading_operations_is_business_and_recruiting_for_traders_is_not_quant(self):
        assert classify("Junior Trading Operations Analyst") == ("new-grad", "business")
        # Waymo's: it studies users, not markets.
        title = (
            "2027 Summer Intern, MS/PhD, Quantitative UX Researcher, Growth/International Expansion"
        )
        assert classify(title) == ("intern", "design")

    def test_product_management(self):
        for title in (
            "Product Management Intern",  # Datadog
            "[2027] Associate Product Manager, Early Career",  # Roblox
            "Product Manager: New Grad Accelerator",  # Stripe
            "Junior Product Owner",  # Hawk-Eye Innovations
            "Product Analyst Intern (US) - Summer 2027",  # TELUS Digital
            "Product Operations Intern, Rewards",  # Sezzle
        ):
            assert first(title) == "product", title

    def test_a_product_manager_is_not_a_senior_manager(self):
        # `manager` marks a senior role everywhere else.
        assert classify("Junior Product Manager") == ("new-grad", "product")  # Teya

    def test_designers_design(self):
        for title in (
            "Product Designer, New Grad",  # Palantir
            "Product Design Intern – Mobile Experience (Work-from-Home)",  # Businessolver
            "UX Research Intern (Summer 2027)",  # Lyft
            "Graphic Design Intern",  # Sezzle
            "Visual Design Co-op 2027",  # MegazoneCloud
            "Fall 2026: Industrial Design Co-op (October through December)",  # SharkNinja
        ):
            assert first(title) == "design", title

    def test_a_designer_of_parts_is_an_engineer(self):
        # SharkNinja, Skydio: a product design engineer designs hardware.
        assert classify("Product Design Engineering Intern Opportunities") == (
            "intern",
            "engineering",
            "engineering/mechanical",
        )

    def test_data_and_ai(self):
        for title in (
            "Data Analyst, Intern",  # Stripe
            "Data Engineer Intern (2027)",  # Figma
            "Applied Scientist Intern",  # Ramp
            "Robot Learning Engineer Intern",  # Gritt Robotics
            "2027 Summer Intern, MS/PhD, Perception, Evaluation",  # Waymo
            "AI Engineer Internship – LLM Data",
            "Business Intelligence Intern",  # ibotta
            "Data Science Intern (Customer Success)",  # Cresta: not support
        ):
            assert first(title) == "data_ai", title

    def test_ai_as_a_modifier_leaves_a_software_job_software(self):
        assert classify("Software Engineer Intern (AI Internal Tools)") == ("intern", "software")
        assert classify("Software Engineer, AI Platform - New Grad") == ("new-grad", "software")
        assert classify("AI Software Intern (USA)") == ("intern", "software")  # Tenstorrent

    def test_an_ai_engineer_works_on_ai(self):
        # EQ Bank's builds models; the loans are its subject.
        assert first("Intern - Commercial Lending AI Engineer, Winter 2027") == "data_ai"

    def test_hardware(self):
        for title in (
            "Electrical Engineering Intern Summer 2027",  # Rocket Lab
            "Design Verification Engineer Intern",  # Astera Labs
            "Campus FPGA Engineer (Intern)",  # Jump Trading
            "RF Hardware Intern (Summer 2027)",  # Astranis
            "Robotics Engineering Intern",  # Bracket Bot
            "Mechatronics Intern",  # Physical Intelligence
            "Digital IC Design Engineer Intern",  # Neuralink
            "Radio Frequency Test Engineer Intern",  # Rocket Lab
            "GNC Hardware Engineering Intern (Summer 2027)",  # Muon Space
            "Software Defined Radio Hardware Intern (Summer 2027)",  # Astranis
        ):
            assert first(title) == "hardware", title

    def test_robotics_software_is_software(self):
        assert classify("Software Engineer Intern, Robotics") == ("intern", "software")  # Neuralink
        title = (
            "Flight Software Engineering Intern (Simulation/Hardware-In-The-Loop)"
            " - Spring & Summer 2027"
        )
        assert classify(title) == ("intern", "software")  # Hermeus

    def test_forward_deployed_engineers_are_software(self):
        assert classify("Forward Deployed Engineer (New Grad)") == ("new-grad", "software")

    def test_engineering(self):
        for title in (
            "Mechanical Engineering Co-op",
            "Entry-Level Roadway Engineer",  # Olsson
            "2027 New Graduate - Nuclear Engineer",  # Radiant
            "2027 New Graduate - Materials Engineer",  # Radiant
            "2027 Systems Engineer Intern",  # Anduril
            "Test Engineering Intern Summer 2027",  # Rocket Lab
        ):
            assert first(title) == "engineering", title

    def test_thermal_and_building_electrical_work_is_engineering_not_hardware(self):
        # Rivian's thermal work on hardware is thermal work.
        title = (
            "Hardware Thermal Simulation Engineering Intern at UIUC Research Park"
            " (January-August 2027)"
        )
        assert first(title) == "engineering"
        assert first("Hardware Test/Mechanical Engineer Intern") == "engineering"  # Astera
        # An electrical engineer for buildings and utilities is a civil discipline.
        assert first("AUSTIN - Electrical Engineer-Power Systems, Internship") == "engineering"
        assert first("Electrical Engineering Internship - Facilities (Healthcare)") == "engineering"
        assert first("Midstream Electrical Engineer Intern") == "engineering"  # EQT

    def test_business(self):
        for title in (
            "Business Operations Intern - Summer 2027",  # Assured Guaranty
            "Supply Chain Intern Summer 2027",  # Rocket Lab
            "2027 Graduate Analyst",  # Zopa
            "Deployment Strategist, Internship",  # Palantir
            "Intern, Business Analyst (PC Insurance), Winter 2027",  # EQ Bank
        ):
            assert first(title) == "business", title

    def test_buying_and_managing_programs_beats_what_is_bought(self):
        # Base Power: the old list vetoed both for their business words.
        assert classify("Hardware Sourcing Intern") == ("intern", "business")
        assert classify("Hardware Technical Program Management Intern") == ("intern", "business")

    def test_finance(self):
        for title in (
            "Accounting Intern",  # Coinbase
            "Credit Analyst Intern (Jan 2027)",  # Lendable
            "Private Equity Investment Intern",  # Viking Global
            "Actuarial Intern  - Summer 2027",  # National Life
            "Venture Capital Analyst Intern",  # DRW
        ):
            assert first(title) == "finance", title

    def test_marketing(self):
        for title in (
            "Marketing Intern",
            "Social Media Intern",  # Nuro
            "Product Marketing Intern",  # Astera Labs: not product management
            "Junior Copywriter",  # Accenture
            "Media Planning Internship",  # WPP Media
            "Junior Video Buyer (Mensch)",  # WPP Media: buys ads, not parts
            "Developer Community Engagement Intern",  # TensorWave: not a programmer
        ):
            assert first(title) == "marketing", title

    def test_sales(self):
        for title in (
            "Sales Engineer Intern",
            "Sales Development Representative - New Grad",  # Flexport
            "Junior Account Executive",  # Uncountable
            "Entry Level Business Development Representative",  # Bisnow
            "Solutions Engineering Intern",  # Envoy
            "Business Developer Junior - CDI - H/F",  # MARGO: French for a sales rep
            "Partnerships Intern",  # ONE Finance
        ):
            assert first(title) == "sales", title

    def test_a_team_named_for_partnerships_does_not_make_a_developer_sell(self):
        title = (
            "Junior Application Specialist - Salesforce Developer, Strategic Partnerships"
            " (Bangkok-based, Relocation Provided)"
        )
        assert first(title) == "software"  # Agoda
        # One partnership is a program, not a sales team (the title's dash is an
        # em dash, as posted).
        assert classify("Bluestaq Graduate Research Scholar \u2014 NDSU Partnership") == ()

    def test_hr(self):
        for title in (
            "Talent Acquisition Intern (Remote)",  # Sezzle
            "People Operations Intern",  # TensorWave
            "Junior Recruiter",  # TSMG
            "Technical Recruiting Intern (Open to Engineers Transitioning into Recruiting)",
            "Total Rewards Intern (Winter/January 2027, 8+ Months)",  # Geotab
        ):
            assert first(title) == "hr", title

    def test_a_team_or_a_program_named_for_people_is_not_hr(self):
        assert first("People Team: Software Engineer Intern (Winter/Spring 2027)") == "software"
        assert first("Forward Deployed Engineer Intern (HR Technology)") == "software"
        assert first("Emerging Talent - Electrical Engineering Internship") == "hardware"  # VAST

    def test_held_off_disciplines_are_not_kept(self):
        # Law, consulting, teaching, the arts, policy and support are not among the
        # twelve (KAN-172), and a title naming one first is dropped.
        for title in (
            "Legal Intern",  # Sezzle
            "Corporate Compliance Intern (Winter/January 2027, 12 Months)",  # Geotab
            "Associate Consultant - Entry-Level Technology Consulting",  # Veeva
            "Teen Health Education Internship",  # HealthCorps
            "Illustrator, Intern",  # Duolingo
            "Policy Intern",  # Coinbase
            "Customer Success Intern",  # Tanium
            "Technical Support Engineer - University Graduate 2027",  # Verkada
            "Hardware Support Internship - Summer 2027",  # RF-SMART
        ):
            assert classify(title) == (), title

    def test_a_consultant_who_names_data_keeps_that_job(self):
        assert first("Data Analyst Consultant Intern (H/F)") == "data_ai"  # Fifty-Five

    def test_trades_operators_and_kitchens_are_never_ours(self):
        assert classify("Electrical Apprentice") == ()
        assert classify("Electronics Test and Assembly Technician (Entry-Level)") == ()
        assert classify("Robotics Data Operator Intern") == ()
        assert classify("Internship for Train Operations - F&B (Malaysian Students Only)") == ()

    def test_words_that_look_like_a_discipline_but_are_not(self):
        # Palantir's civil liberties, DRW's UK year in industry, Ginkgo's lab
        # scientist and Astera Labs' office facilities.
        assert first("Privacy and Civil Liberties Software Engineer, Internship") == "software"
        assert first("Software Developer Intern - Industrial Placement") == "software"
        assert classify("Automation Scientist Intern, RAC Operations") == ()
        assert classify("Facilities Intern") == ()
        assert first("Mission Operations Internship - Summer 2027") == "engineering"  # Varda


class TestSpecialties:
    def test_security_and_it(self):
        for title in (
            "IT Helpdesk Intern - Summer 2027",  # Antares Nuclear
            "IT Systems Administrator Intern",  # Neuralink
            "Cybersecurity Internship - Summer 2027",  # Varda Space
            "2026 Junior Analyst, Threat Intelligence",  # Anduril
            "Information Security Engineer, Internship",  # Palantir
        ):
            assert classify(title)[1:] == ("software", "software/security"), title

    def test_physical_security_is_not_computer_security(self):
        assert classify("Physical Security Specialist (PhySS) – Junior") == ()  # CGS Federal

    def test_data_and_ai(self):
        assert classify("Research Scientist Intern")[2:] == ("data_ai/ml",)
        assert classify("Data Scientist Intern - PhD")[2:] == ("data_ai/data_science",)
        assert classify("Business Intelligence Intern")[2:] == ("data_ai/analytics",)
        assert classify("Data Engineering Intern")[3:] == ("data_ai/data_engineering",)

    def test_engineering(self):
        assert classify("Civil Engineering Internship - Roadway")[2:] == ("engineering/civil",)
        assert classify("Survey Internship")[2:] == ("engineering/civil",)  # Olsson
        assert classify("Water Infrastructure Engineering Intern")[2:] == (
            "engineering/civil",
        )  # EQT: water, not software infrastructure
        assert classify("Turbomachinery Intern Summer 2027")[2:] == ("engineering/mechanical",)
        assert classify("Supplier Quality Engineer Intern")[2:] == ("engineering/manufacturing",)
        assert classify("Guidance, Navigation & Controls (GNC) Internship - Summer 2027")[2:] == (
            "engineering/aerospace",
        )  # Varda
        # Rocket Lab: both, in the order the specialties are listed.
        assert classify("Propulsion Manufacturing Intern (Summer 2027)")[2:] == (
            "engineering/manufacturing",
            "engineering/aerospace",
        )

    def test_an_engineering_title_naming_no_specialty_has_none(self):
        assert classify("2027 New Graduate - Nuclear Engineer") == ("new-grad", "engineering")


class TestTwoCategories:
    """Only engineering jobs that are two jobs at once get a second category."""

    def test_ml_ai_and_data_engineers_write_software(self):
        assert classify("Machine Learning Engineering Intern") == (
            "intern",
            "data_ai",
            "software",
            "data_ai/ml",
        )  # Cresta
        assert classify("Data Engineer Intern (2027)") == (
            "intern",
            "data_ai",
            "software",
            "data_ai/data_engineering",
        )  # Figma
        assert classify("Analytics Engineer Intern")[1:3] == ("data_ai", "software")  # Coinbase

    def test_firmware_and_embedded_engineers_write_software(self):
        assert classify("Firmware Engineer Co-Op") == ("intern", "hardware", "software")  # Samsara
        assert classify("Graduate Firmware Engineer") == ("new-grad", "hardware", "software")
        assert classify("Embedded Software Engineering Intern 2027") == (
            "intern",
            "hardware",
            "software",
        )  # Verkada

    def test_quant_developers_write_software(self):
        assert classify("Quantitative Developer Intern") == ("intern", "quant", "software")
        assert classify("Junior Quantitative Developer & Strategist") == (
            "new-grad",
            "quant",
            "software",
        )  # Akuna Capital

    def test_researchers_scientists_and_analysts_do_not(self):
        assert classify("Research Scientist Intern")[:2] == ("intern", "data_ai")
        assert len(classify("Research Scientist Intern")) == 3
        assert "software" not in classify("Systems Research Engineer Intern - GPU Programming")
        assert "software" not in classify("Data Scientist Intern - PhD")
        assert "software" not in classify("Campus Quantitative Trader (Intern)")

    def test_a_weak_word_never_adds_one(self):
        assert classify("Software Engineer Intern (AI Internal Tools)") == ("intern", "software")
        assert classify("Software Engineer Intern, Robotics") == ("intern", "software")


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
        assert roles_of([job("Senior Software Engineer"), job("Customer Support Intern")]) == []

    def test_a_roles_keys_are_its_categories_then_its_specialties(self):
        (role,) = roles_of([job("Machine Learning Engineering Intern")])
        assert role.category == "data_ai"
        assert role.roles == ("data_ai", "software", "data_ai/ml")

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
