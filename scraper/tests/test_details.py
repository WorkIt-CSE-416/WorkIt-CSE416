"""The card's job type, salary and years, read from a provider field or a description.

A wrong one is silent: the card prints "$38/yr" or "Part-Time" with nothing to show it
came from a misread sentence. Every string below was observed in a scraped posting.
"""

from __future__ import annotations

from dataclasses import replace

from workit_scraper import details, feed, providers, store
from workit_scraper.details import Facts, Pay
from workit_scraper.providers import Job, Page
from workit_scraper.shortlist import pick
from workit_scraper.store import RunStats


class TestPay:
    def test_hourly_range(self) -> None:
        text = "The hourly pay range for this internship is $32–$46 per hour"
        assert details.pay(text) == Pay("USD", 32, 46, "hour")

    def test_label_on_the_line_above(self) -> None:
        # Coinbase.
        assert details.pay("Hourly Rate:\n$50—$50 USD") == Pay("USD", 50, 50, "hour")

    def test_monthly_stays_monthly(self) -> None:
        # Cloudflare, Lisbon: a year would be twelve times an internship's pay.
        text = "For Portugal based hires: the monthly salary is €2,450."
        assert details.pay(text) == Pay("EUR", 2450, 2450, "month")

    def test_currency_code_after_a_dollar_sign(self) -> None:
        # Bree is Canadian and says so after the amount.
        text = "- Compensation: $50-$70/hour CAD, based on experience"
        assert details.pay(text) == Pay("CAD", 50, 70, "hour")

    def test_annual_salary_with_k(self) -> None:
        text = "The salary range for this role is USD $110,000 - $140,000 annual base salary"
        assert details.pay(text) == Pay("USD", 110_000, 140_000, "year")

    def test_a_label_the_amount_contradicts_loses(self) -> None:
        # Samsara: "Annual Base Salary" over an hourly intern rate.
        assert details.pay("Annual Base Salary\n$38—$58 USD") == Pay("USD", 38, 58, "hour")

    def test_funding_is_not_pay(self) -> None:
        text = "We have raised $120M from top investors and pay a competitive salary."
        assert details.pay(text) is None

    def test_an_amount_nothing_calls_pay_is_skipped(self) -> None:
        assert details.pay("Customers save $40,000 a year with our product.") is None


class TestJobType:
    def test_full_time_internship(self) -> None:
        # Cloudflare, after "not considering remote or part-time".
        text = (
            "We are not considering remote or part-time for either terms. "
            "This is a full-time (40hr/week internship) with in-person expectations"
        )
        assert details.job_type(text) == "full_time"

    def test_either_is_neither(self) -> None:
        # Datadog and Perplexity offer both; the role has no one type.
        assert details.job_type("complete a full-time or part-time internship") is None
        assert details.job_type("Internship program: 12 - 24 weeks, full-time, part-time") is None

    def test_a_later_job_is_not_this_one(self) -> None:
        text = "Post-internship career opportunities (full-time or part-time)"
        assert details.job_type(text) is None
        assert details.job_type("with the chance to convert to a full-time role") is None

    def test_benefits_blurbs_say_nothing(self) -> None:
        # Xcimer: "all regular employees (including part-time), fixed-term, and interns".
        text = "13 company-paid holidays for all regular employees (including part-time)"
        assert details.job_type(text) is None

    def test_provider_labels(self) -> None:
        assert details.job_type_label("FullTime") == "full_time"  # Ashby
        assert details.job_type_label("Full-time") == "full_time"  # Lever
        assert details.job_type_label("PartTime") == "part_time"
        assert details.job_type_label("Contract") == "contract"
        # Says nothing about hours.
        assert details.job_type_label("Intern") is None
        assert details.job_type_label("Intern - Fixed Term - Trainee") is None  # Celonis


class TestWorkStyle:
    def test_role_sentence(self) -> None:
        # Tenstorrent.
        text = "This role is on-site, based out of Austin or Santa Clara."
        assert details.work_style(text) == "On site"

    def test_days_in_office(self) -> None:
        assert details.work_style("Expect 3 days a week in the office in SF.") == "Hybrid"

    def test_the_company_is_not_the_role(self) -> None:
        assert details.work_style("We are a remote-first company building hybrid cloud.") is None

    def test_two_answers_are_none(self) -> None:
        text = "This role is remote. This role is hybrid for Bay Area hires."
        assert details.work_style(text) is None


class TestMinYears:
    def test_plus(self) -> None:
        text = "Required Qualifications:\n2+ years of experience with embedded systems"
        assert details.min_years(text) == 2

    def test_range_takes_its_floor(self) -> None:
        text = "- 0-2 years of professional software development experience"
        assert details.min_years(text) == 0

    def test_alternatives_take_the_lowest_bar(self) -> None:
        # Redhorse.
        text = (
            "Bachelor's degree with 5+ years of experience "
            "OR a Master's degree with 3+ years of experience."
        )
        assert details.min_years(text) == 3

    def test_a_ceiling_is_not_a_minimum(self) -> None:
        # Lyft and DoorDash cap experience for their internships.
        assert (
            details.min_years(
                "should also have less than 2 years of relevant full-time work experience"
            )
            is None
        )
        assert details.min_years("with no more than 2 years of full-time work experience") is None

    def test_schooling_is_not_experience(self) -> None:
        # Stripe.
        assert (
            details.min_years(
                "At least 1 year of university education, or equivalent work experience."
            )
            is None
        )


def greenhouse_job(**changes: object) -> Job:
    base = {
        "ats": "greenhouse",
        "token": "cloudflare",
        "company": "Cloudflare",
        "external_id": "8245197",
        "title": "Software Engineer Intern (2027)",
        "apply_url": "https://boards.greenhouse.io/cloudflare/jobs/8245197?gh_jid=8245197",
        "location": "In-Office",
    }
    return Job(**{**base, **changes})


def read_page(
    description: str | None = None, facts: Facts | None = None, offices: tuple[str, ...] = ()
) -> Page:
    return Page(providers.PAGE_VERSION, description, facts or Facts(), offices)


class TestCloudflare:
    """Two "Software Engineer Intern (2027)" cards, both "In-Office": Lisbon and London."""

    PAGE = {
        "content": "&lt;p&gt;Build things.&lt;/p&gt;",
        "offices": [{"name": "Lisbon, Portugal"}],
        "metadata": [{"name": "Cost Center", "value": "4991 - R&D Interns"}],
        "pay_input_ranges": [],
    }

    def test_in_office_is_a_work_style(self, monkeypatch) -> None:
        monkeypatch.setattr(providers, "_get_json", lambda url: self.PAGE)
        job = providers.describe_greenhouse(greenhouse_job())
        assert job.facts.work_style == "On site"

    def test_the_office_is_the_place(self, monkeypatch) -> None:
        monkeypatch.setattr(providers, "_get_json", lambda url: self.PAGE)
        job = providers.describe_greenhouse(greenhouse_job())
        assert job.places == ("Lisbon, Portugal",)

    def test_a_work_model_with_no_offices_is_no_place(self) -> None:
        assert greenhouse_job(location="Hybrid", page=read_page()).places == ()
        assert greenhouse_job(location="Remote").places == ("Remote",)

    def test_a_real_location_wins_over_offices(self) -> None:
        job = greenhouse_job(location="Austin, TX", page=read_page(offices=("Austin, TX HQ",)))
        assert job.places == ("Austin, TX",)

    def test_the_page_survives_the_next_listing(self) -> None:
        # The next run's listing says "In-Office" again and nothing else.
        facts = Facts(job_type="full_time", pay=Pay("GBP", 3000, 3000, "month"))
        read = greenhouse_job(
            page=read_page("Build things.", facts, offices=("London, United Kingdom",))
        )
        monday = store.update(None, [read], [], RunStats(), "2026-10-05T09:00:00+00:00")
        tuesday = store.update(
            monday, [greenhouse_job()], [], RunStats(), "2026-10-06T09:00:00+00:00"
        )
        [job] = tuesday.jobs
        assert job.places == ("London, United Kingdom",)
        assert job.facts == facts


class TestWholeDescription:
    """Facts are read from the whole description; only the stored copy is cut."""

    def ashby_row(self, description: str, **changes: object) -> dict:
        return {
            "id": "a8e5a8d2",
            "title": "Software Engineering Intern",
            "applyUrl": "https://jobs.ashbyhq.com/terranova/a8e5a8d2/application",
            "descriptionPlain": description,
            **changes,
        }

    def fetch(self, monkeypatch, *rows: dict) -> list[Job]:
        monkeypatch.setattr(providers, "_get_json", lambda url: {"jobs": list(rows)})
        return providers.ashby("terranova", "Terranova")

    def test_pay_past_the_cut_is_found(self, monkeypatch) -> None:
        # 67 of 1,099 descriptions ran past DESCRIPTION_CHARS, pay often last.
        blurb = "We build robots. " * 600
        [job] = self.fetch(monkeypatch, self.ashby_row(f"{blurb}\nHourly pay: $32–$46 per hour"))
        assert job.description is not None and job.description.endswith(" …")
        assert "$32" not in job.description
        assert job.facts.pay == Pay("USD", 32, 46, "hour")

    def test_the_description_fills_what_fields_do_not(self, monkeypatch) -> None:
        text = (
            "This is a full-time (40hr/week internship).\n"
            "1+ years of experience with Go.\n"
            "This role is on-site in Berkeley.\n"
            "Our Summer 2027 cohort starts in June."
        )
        [job] = self.fetch(monkeypatch, self.ashby_row(text))
        facts = job.facts
        assert (facts.job_type, facts.min_years, facts.work_style) == ("full_time", 1, "On site")
        assert facts.start_term == "Summer 2027"

    def test_sponsorship_past_the_cut_is_found(self, monkeypatch) -> None:
        # Sigma's visa line is near the end; 635 of ~1,090 stored copies are cut.
        blurb = "We build robots. " * 600
        text = f"{blurb}\nVisa sponsorship is not available for our internship positions"
        [job] = self.fetch(monkeypatch, self.ashby_row(text))
        assert "Visa" not in (job.description or "")
        assert job.facts.sponsorship == "no_sponsorship"

    def test_a_provider_field_beats_the_description(self, monkeypatch) -> None:
        row = self.ashby_row("This is a part-time internship.", employmentType="FullTime")
        [job] = self.fetch(monkeypatch, row)
        assert job.facts.job_type == "full_time"


class TestStartTerm:
    def test_title_year(self) -> None:
        # Cloudflare.
        assert details.start_term("Software Engineer Intern (2027)", None) == "2027"

    def test_title_season(self) -> None:
        assert (
            details.start_term("Software Engineering Intern (Summer 2027)", None) == "Summer 2027"
        )
        # Waymo.
        assert (
            details.start_term("2027 Summer Intern, PhD, Machine Learning", None) == "Summer 2027"
        )

    def test_description_names_the_season_of_the_titles_year(self) -> None:
        title = "Software Engineer Intern (2027)"
        assert details.start_term(title, "Join our Summer 2027 program") == "Summer 2027"
        # A different cohort's season does not override the title.
        assert details.start_term(title, "Our Summer 2026 interns shipped") == "2027"

    def test_start_month(self) -> None:
        # Cartesian.
        text = "Dates: Full-Time; January 4, 2027 - January 29, 2027. Start date: January 4, 2027"
        assert details.start_term("Software Engineer Intern", text) == "January 2027"

    def test_work_period(self) -> None:
        intern = "Software Engineer Intern"
        # Flagship Pioneering, Apera AI, Datadog, Fundwell.
        assert (
            details.start_term(intern, "Work Period: January 2027 to June 2027.") == "January 2027"
        )
        assert (
            details.start_term(intern, "8 months term commitment (Jan 2027 - August 2027).")
            == "January 2027"
        )
        assert details.start_term(intern, "May 24 - Aug 20, 2027") == "May 2027"
        assert details.start_term(intern, "DURATION: JUNE – AUGUST 2026 (3 MONTHS)") == "June 2026"

    def test_graduation_and_deadline_dates_are_not_the_term(self) -> None:
        # DRW, ZipRecruiter.
        text = "an expected graduation date between December 2027 and June 2028"
        assert details.start_term("Software Engineer Intern", text) is None
        assert (
            details.start_term(
                "Software Engineer Intern", "Applications close Nov 1 - Nov 15, 2026"
            )
            is None
        )

    def test_a_graduation_season_is_not_the_start(self) -> None:
        # Databricks, Together AI.
        intern = "Software Engineering Intern (2027 Start)"
        text = "You will graduate between Autumn 2027 and Summer 2028 with a degree"
        assert details.start_term(intern, text) == "2027"
        text = "a related field, earned or expected by Summer 2027"
        assert details.start_term("Software Engineer Intern", text) is None

    def test_season_after_year_in_a_description(self) -> None:
        # DV Trading.
        text = "to join our equities desk for the 2027 Summer Internship."
        assert details.start_term("2027 Software Developer Intern", text) == "Summer 2027"

    def test_season_in_the_title_without_a_year(self) -> None:
        assert details.start_term("Software Engineering Intern (Summer)", None) == "Summer"

    def test_years_are_judged_against_today(self, monkeypatch) -> None:
        # No fixed range to go stale: a far year is not a cohort, whatever the date.
        assert details.start_term("Software Engineer Intern (2015)", None) is None
        assert details.start_term("Software Engineer Intern", "Our Summer 2031 program") is None

        class Later(details.date):
            @classmethod
            def today(cls):
                return cls(2031, 1, 1)

        monkeypatch.setattr(details, "date", Later)
        assert details.start_term("Software Engineer Intern (Summer 2031)", None) == "Summer 2031"

    def test_a_bare_year_in_a_description_says_nothing(self) -> None:
        assert details.start_term("Software Engineer Intern", "Founded in 2025.") is None


class TestProviderPay:
    def test_ashby_salary_component(self) -> None:
        # afterquery's Software Engineering Intern.
        row = {
            "compensation": {
                "summaryComponents": [
                    {"compensationType": "Bonus", "interval": "1 YEAR", "currencyCode": "USD"},
                    {
                        "compensationType": "Salary",
                        "interval": "1 MONTH",
                        "currencyCode": "USD",
                        "minValue": 10000,
                        "maxValue": 10000,
                    },
                ]
            }
        }
        assert providers._ashby_pay(row) == Pay("USD", 10000, 10000, "month")

    def test_lever_salary_range(self) -> None:
        row = {
            "salaryRange": {"currency": "USD", "interval": "per-hour-wage", "min": 30, "max": 40}
        }
        assert providers._lever_pay(row) == Pay("USD", 30, 40, "hour")

    def test_greenhouse_ranges_across_zones(self) -> None:
        # Robinhood posts one range per pay zone; the card shows the span.
        ranges = [
            {"min_cents": 4400, "max_cents": 4400, "currency_type": "USD", "title": "Zone 1"},
            {"min_cents": 3960, "max_cents": 3960, "currency_type": "USD", "title": "Zone 2"},
        ]
        assert providers._greenhouse_pay(ranges) == Pay("USD", 39.6, 44, "hour")

    def test_greenhouse_titled_hourly(self) -> None:
        ranges = [
            {
                "min_cents": 1900,
                "max_cents": 2800,
                "currency_type": "USD",
                "title": "Hourly Pay Range",
            }
        ]
        assert providers._greenhouse_pay(ranges) == Pay("USD", 19, 28, "hour")

    def test_greenhouse_employment_type_field(self) -> None:
        metadata = [{"name": "Employment Type", "value": "Full Time"}]  # Attentive
        assert providers._greenhouse_job_type(metadata) == "full_time"


class TestFeed:
    def role(self, facts: Facts):
        job = greenhouse_job(first_seen_at="2026-10-05T09:00:00+00:00", page=read_page(facts=facts))
        [role] = pick([job], is_new=lambda job: False)
        return feed.row(role, {})

    def test_one_amount_is_a_range_whose_ends_meet(self) -> None:
        row = self.role(Facts(pay=Pay("GBP", 3000, 3000, "month")))
        assert (row["salary"], row["salary_min"], row["salary_max"]) == (None, 3000, 3000)
        assert (row["salary_currency"], row["salary_period"]) == ("GBP", "month")

    def test_a_range_fills_min_and_max(self) -> None:
        row = self.role(Facts(pay=Pay("USD", 32, 46, "hour")))
        assert (row["salary"], row["salary_min"], row["salary_max"]) == (None, 32, 46)

    def test_unstated_stays_null(self) -> None:
        row = self.role(Facts())
        assert row["job_type"] is None
        assert row["salary"] is None and row["salary_currency"] is None
        assert row["min_years_experience"] is None


class TestRoleFacts:
    def test_facts_come_whole_from_one_copy(self) -> None:
        # Two copies at one URL: pay from one and job type from the other would
        # describe no posting at all.
        first = greenhouse_job(page=read_page(facts=Facts(pay=Pay("USD", 40, 40, "hour"))))
        second = replace(
            greenhouse_job(page=read_page(facts=Facts(job_type="full_time"))),
            token="cloudflare-2",
            external_id="2",
        )
        stamped = [replace(j, first_seen_at="2026-10-05T09:00:00+00:00") for j in (first, second)]
        [role] = pick(stamped, is_new=lambda j: False)
        assert role.facts.pay == Pay("USD", 40, 40, "hour")
        assert role.facts.job_type is None


class TestCardWorkStyle:
    """Stated first, then the company's other postings, then On site for a place
    with no word of anything else."""

    def card(self, *jobs: Job) -> dict[str, str | None]:
        roles = pick(
            [replace(j, first_seen_at="2026-10-05T09:00:00+00:00") for j in jobs],
            is_new=lambda j: False,
        )
        return {role.title: role.facts.work_style for role in roles}

    def posting(
        self, eid: str, title: str, company: str, location: str, text: str, style=None
    ) -> Job:
        return Job(
            ats="greenhouse",
            token=company.lower(),
            company=company,
            external_id=eid,
            title=title,
            apply_url=f"https://example.test/{company}/{eid}",
            location=location,
            page=read_page(text, Facts(work_style=style)),
        )

    def test_a_stated_sentence(self) -> None:
        # Sigma Computing.
        text = (
            "Note: We have an in-office work environment in all our offices in SF, NYC, and London."
        )
        assert details.work_style(text) == "On site"

    def test_silent_with_a_place_is_on_site(self) -> None:
        # Figure: "San Jose, CA", and not a word about where the work happens.
        figure = self.posting(
            "1", "Security Engineer Intern", "Figure", "San Jose, CA", "Build robots."
        )
        assert self.card(figure) == {"Security Engineer Intern": "On site"}

    def test_the_company_speaks_for_a_silent_posting(self) -> None:
        stated = self.posting("1", "Software Engineer Intern", "Acme", "NYC", "Build.", "Hybrid")
        silent = self.posting("2", "Data Engineer Intern", "Acme", "NYC", "Build data.")
        assert self.card(stated, silent)["Data Engineer Intern"] == "Hybrid"

    def test_any_word_of_remote_or_hybrid_is_no_guess(self) -> None:
        text = "Remote candidates in the US are welcome to apply."
        silent = self.posting("1", "Software Engineer Intern", "Acme", "NYC", text)
        assert self.card(silent) == {"Software Engineer Intern": None}

    def test_no_place_is_no_guess(self) -> None:
        silent = self.posting("1", "Software Engineer Intern", "Acme", "", "Build.")
        assert self.card(silent) == {"Software Engineer Intern": None}


class TestStatedInterval:
    """A period the provider states is trusted: size alone cannot tell a month from a week."""

    def test_ashby_monthly_stipend(self) -> None:
        # Strada's Software Engineer (Intern): "$7.5K per month", and nothing in the
        # description but "Competitive salary".
        row = {
            "compensation": {
                "summaryComponents": [
                    {
                        "compensationType": "Salary",
                        "interval": "1 MONTH",
                        "currencyCode": "USD",
                        "minValue": 7500,
                        "maxValue": 7500,
                    }
                ]
            }
        }
        assert providers._ashby_pay(row) == Pay("USD", 7500, 7500, "month")

    def test_lever_weekly(self) -> None:
        row = {
            "salaryRange": {
                "currency": "USD",
                "interval": "per-week-salary",
                "min": 1800,
                "max": 2000,
            }
        }
        assert providers._lever_pay(row) == Pay("USD", 1800, 2000, "week")

    def test_an_impossible_amount_for_the_period_is_dropped(self) -> None:
        row = {
            "salaryRange": {"currency": "USD", "interval": "per-year-salary", "min": 40, "max": 45}
        }
        assert providers._lever_pay(row) is None


def test_ashby_values_are_never_carried_forward() -> None:
    # Strada was stored "full-time"; Ashby now says "Intern", which states no hours.
    first = Job(
        ats="ashby",
        token="stradahq",
        company="Strada",
        external_id="d277be89",
        title="Software Engineer (Intern)",
        apply_url="https://jobs.ashbyhq.com/stradahq/d277be89",
        page=read_page(facts=Facts(job_type="full_time")),
    )
    monday = store.update(None, [first], [], RunStats(), "2026-10-06T09:00:00+00:00")
    now = replace(first, page=read_page())
    tuesday = store.update(monday, [now], [], RunStats(), "2026-10-07T09:00:00+00:00")
    assert tuesday.jobs[0].facts.job_type is None


class TestAuditFindings:
    """Facts the 2026-10-08 audit found stated but missed. Each string is from the
    posting named; each "stays empty" case is from a real posting too."""

    def test_pay_proved_by_its_period(self) -> None:
        # xAI, Freeform, Cresta, Qualified Health: labelled by level, not by "pay".
        text = "Software Engineering Intern/Freshman/Sophomore: $30 USD per hour"
        assert details.pay(text) == Pay("USD", 30, 30, "hour")
        assert details.pay("Perks & Benefits:\n$30-$50 per hour subject to taxes") == Pay(
            "USD", 30, 50, "hour"
        )

    def test_pay_with_a_currency_code_and_no_symbol(self) -> None:
        # Sezzle, ION Group.
        text = "The salary for the SRE Intern is 800 USD monthly gross."
        assert details.pay(text) == Pay("USD", 800, 800, "month")
        assert details.pay("Gross Salary Range\n34.000 - 38.000 EUR") == Pay(
            "EUR", 34000, 38000, "year"
        )

    def test_pay_shorthand_and_european_thousands(self) -> None:
        # Mendix, Atoms.
        text = "The salary range for this position is €55-65,000 annually"
        assert details.pay(text) == Pay("EUR", 55000, 65000, "year")
        text = "The base salary range for this role is $120.000 - $140.000 per year."
        assert details.pay(text) == Pay("USD", 120000, 140000, "year")

    def test_pay_currency_before_the_symbol(self) -> None:
        # Cresta.
        assert details.pay("Compensation: CAD $30-50/hour") == Pay("CAD", 30, 50, "hour")
        assert details.pay("💰£42,500 pro rata") == Pay("GBP", 42500, 42500, "year")  # Monzo

    def test_money_that_is_not_pay(self) -> None:
        # Canonical's learning budget, Awetomaton's 401(k) limit.
        assert details.pay("development budget of USD 2,000 per year") is None
        assert details.pay("This is a benefit of up to $24,500 for 2026.") is None

    def test_ashby_bi_weekly_pay_is_halved_to_a_week(self) -> None:
        # Persona: "$7.5K – $8K bi-weekly".
        pay = Pay.from_interval("USD", 7500, 8000, "2 WEEK")
        assert pay == Pay("USD", 3750, 4000, "week")

    def test_linkedin_tags_are_the_employers_label(self) -> None:
        # Pure Storage, Shift, Notion.
        assert details.work_style("Able to work full-time | #LI-ONSITE") == "On site"
        assert details.work_style("#LI-RH1 #LI-REMOTE") == "Remote"

    def test_hybrid_beside_on_site_is_hybrid(self) -> None:
        # Lyft.
        text = (
            "This role will be in-office on a hybrid schedule — Team Members will be "
            "expected to work in the office 3 days per week"
        )
        assert details.work_style(text) == "Hybrid"

    def test_more_hybrid_phrasings(self) -> None:
        # Profluent, NISC, WPP, Dev Technology, Roblox.
        for text in (
            "Hybrid: 2–3 days on-site per week at our Emeryville, CA headquarters",
            "Work Schedule:\nHybrid from one of our office locations",
            "we've adopted a hybrid approach, with teams in the office around four days a week",
            "Must be able to commute to the Reston, Virginia office a minimum of 2 days a week",
            "Roles that are based in an office are onsite Tuesday, Wednesday, and Thursday",
        ):
            assert details.work_style(text) == "Hybrid", text

    def test_more_on_site_and_remote_phrasings(self) -> None:
        # SpaceX, Amperesand, CoVar, Stripe; Axon, Docugami.
        for text in (
            "Able to work full time, onsite for a minimum of 12 consecutive weeks",
            "Available to work on-site.",
            "In-person in Durham, NC",
            "working in person from Stripe’s San Francisco or Seattle office",
        ):
            assert details.work_style(text) == "On site", text
        assert details.work_style("Location: Remote anywhere in Australia") == "Remote"
        assert details.work_style("This position will primarily be remote") == "Remote"

    def test_an_offered_choice_stays_empty(self) -> None:
        # GenScript.
        text = "Onsite preferably, but open to US Remote for the right candidate"
        assert details.work_style(text) is None

    def test_more_start_phrasings(self) -> None:
        intern = "Software Engineer Intern"
        assert details.start_term(intern, "through the summer of 2027") == "Summer 2027"
        assert details.start_term(intern, "12 weeks between June and September 2027") == "June 2027"
        text = "a 6-month internship beginning in February, March, April, May, or June 2027"
        assert details.start_term(intern, text) == "February 2027"
        assert details.start_term("Software Development Co-op (Jan '27)", None) == "January 2027"

    def test_a_title_range_starts_at_its_first_month(self) -> None:
        # Rivian (whose title also says "Applications"), Visier, EQ Bank.
        title = (
            "Software Engineering Intern - Applications, Infotainment & Mobile "
            "(January - August 2027)"
        )
        assert details.start_term(title, None) == "January 2027"
        assert (
            details.start_term("Software Developer Intern (January to June 2027)", None)
            == "January 2027"
        )
        assert (
            details.start_term("Intern, AI Adoption Operations, Jan - Dec 2027", None)
            == "January 2027"
        )

    def test_a_month_or_season_with_no_year(self) -> None:
        # TensorWave, Shift, ZipRecruiter, Brave; with the title's year when it has one.
        intern = "Software Engineer Intern"
        assert details.start_term(intern, "- Paid Internship\n- May - August (12 weeks)") == "May"
        assert details.start_term(intern, "start your internship around August 31th") == "August"
        assert details.start_term(intern, "As a summer intern, you’ll join our program") == "Summer"
        assert details.start_term(intern, "Remote - Fall Semester") == "Fall"
        assert (
            details.start_term(f"{intern} (2027)", "Join our summer internship program")
            == "Summer 2027"
        )

    def test_dates_that_are_not_the_start(self) -> None:
        intern = "Software Engineer Intern"
        # Jump, Rackner, SharkNinja.
        assert details.start_term(intern, "internships during a non-summer term") is None
        assert details.start_term(intern, "Lease covering March 26-September 23") is None
        assert details.start_term(intern, "may affect starting pay within this range") is None

    def test_more_years_phrasings(self) -> None:
        # Synack, Akuna, Rover.
        assert details.min_years("~1yr of work/internship experience relevant to this role") == 1
        assert details.min_years("0-2 years’ experience, must be graduating by Jul 2027") == 0
        assert details.min_years("1-4 years as a professional software developer") == 1

    def test_more_job_type_phrasings(self) -> None:
        # SingleStore, Sezzle, Stripe; IMC's experience is not a job type.
        assert details.job_type("Employment Status: Full-time") == "full_time"
        assert details.job_type("#Li-remote #Full-time") == "full_time"
        assert (
            details.job_type("Must be available to start full-time before December 1")
            == "full_time"
        )
        assert (
            details.job_type("requires 1–3 years of full-time, post-graduation work experience")
            is None
        )
        assert details.job_type_label("Employee-Regular") == "full_time"


class TestProviderWorkStyleFields:
    def test_greenhouse_working_conditions(self) -> None:
        assert (
            providers._greenhouse_work_style([{"name": "Working Conditions", "value": "Hybrid"}])
            == "Hybrid"
        )
        assert providers._greenhouse_work_style([{"name": "Is Remote?", "value": True}]) == "Remote"
        assert providers._greenhouse_work_style([{"name": "Cost Center", "value": "4991"}]) is None


class TestSponsorship:
    """What a posting says about visas, from the 2026-10-09 feed. Each string is from
    the posting named."""

    INTERN = "Software Engineer Intern"

    def says(self, text: str, title: str = INTERN) -> str | None:
        return details.sponsorship(title, text)

    def test_will_not_sponsor(self) -> None:
        for text in (
            # Enova: a loose "able to sponsor visas" once read this as a yes.
            "However, we are not able to sponsor visas or take over sponsorship at this time.",
            "Visa sponsorship is not available for our internship positions",  # Sigma
            # Zettabyte, Gallup, Qumulo, mthree.
            "- Applicants must be authorized to work in the United States without visa sponsorship",
            "Eligibility to work in the United States required; this position is not eligible "
            "for employment visa sponsorship",
            "Must be authorized to work in the United States. We are unable to provide visa "
            "sponsorship or transfer.",
            "Applicants must be currently authorized to work in the United States on a full-time "
            "basis. The Company will not sponsor applicants for work visas.",
            # Roblox, Monzo.
            "For US based roles only, please note the Company may not be able to employ "
            "candidates for this role who have United States work authorization related to "
            "certain U.S. visa categories, or support future H-1B sponsorship at this time.",
            "You have the right to work in the UK without restrictions for the full 12-week "
            "internship and would not require visa sponsorship if offered a permanent position.",
        ):
            assert self.says(text) == "no_sponsorship", text

    def test_says_it_sponsors(self) -> None:
        # SingleStore, Verkada, Belvedere, Ambrook, Samaya; Fab2's benefits list.
        for text in (
            "Sponsorship is available for this position and other select roles.",
            "We do sponsor and take over sponsorship of employment visas for this role.",
            "Sponsorship: Yes",
            "Ambrook can support visa sponsorship (OPT/CPT, TN, J-1) for eligible candidates.",
            "Visa Sponsorship: We do sponsor visas! However, we aren't able to successfully "
            "sponsor visas for every role and every candidate.",
            "Internship Benefits:\n- Paid Time Off inclusive of Holidays and Sick Time\n"
            "- Visa Sponsorship\n- Medical, Dental, and Vision insurance",
        ):
            assert self.says(text) == "sponsors", text

    def test_no_outweighs_yes_and_citizens_only_outweighs_no(self) -> None:
        # Fab2's benefit beside Sigma's line; Awetomaton says both of the others.
        text = "- Visa Sponsorship\nVisa sponsorship is not available for our internship positions"
        assert self.says(text) == "no_sponsorship"
        text = "U.S. citizenship is required, as we are unable to provide visa sponsorship."
        assert self.says(text) == "citizens_only"

    def test_citizenship_or_a_us_clearance_required(self) -> None:
        for text in (
            # ASSYST, Meridian Partners, Kitware, CoVar.
            "Clearance Requirement: US Citizenship is required with eligibility to obtain a "
            "clearance.",
            "US Citizenship required and ability to obtain a US Security Clearance.",
            "Due to contractual requirements, only U.S. citizens will be considered for this "
            "position.",
            "Minimum qualifications\nWork authorization: US citizen",
            # Accenture; Palantir's list with no verb, under its heading.
            "Clearance:\nMust have a TS/SCI level clearance",
            "What We Require\nActive US Security clearance, or eligibility and willingness to "
            "obtain a US Security clearance prior to start of internship",
        ):
            assert self.says(text) == "citizens_only", text

    def test_an_optional_clearance_is_not_a_requirement(self) -> None:
        # Palantir lists it under "What We Value" on some roles; GRVTY as nice to have.
        for text in (
            "What We Value\nActive US Security clearance, or eligibility and willingness to "
            "obtain a US Security clearance.",
            "For all other roles: An active U.S. security clearance, or eligibility and "
            "willingness to obtain one, is a plus but not required",
            "What Would be Nice to Have\nActive or current Top-Secret clearance with SCI access "
            "and polygraph (TS/SCI with poly).",
        ):
            assert self.says(text) is None, text

    def test_a_us_person_is_not_only_a_citizen(self) -> None:
        # ITAR's "U.S. person" takes green card holders too, so it is no
        # sponsorship rather than citizens only. Astranis, Anduril, Varda.
        for text in (
            "(To comply with U.S. Government space technology export regulations, applicant "
            "must be a U.S. citizen, lawful permanent resident of the United States, or other "
            "protected individual as defined by 8 U.S.C. 1324b(a)(3))",
            "Must be a U.S. Person due to required access to U.S. export controlled information "
            "or facilities; U.S. clearance eligibility may be required depending on program.",
            "Because our employees are provided access to export-controlled items, our policy is "
            "to only hire “U.S. persons” who are permitted to have access to our technology",
        ):
            assert self.says(text) == "no_sponsorship", text

    def test_an_export_licence_instead_says_nothing(self) -> None:
        # Antares, Hermeus: a visa holder can still be hired under a licence.
        for text in (
            "To conform to U.S. Government export regulations, applicant must be a (i) U.S. "
            "citizen or national, (ii) U.S. lawful, permanent resident (aka green card holder), "
            "(iii) Refugee under 8 U.S.C. § 1157, or (iv) Asylee under 8 U.S.C. § 1158, or be "
            "eligible to obtain the required authorizations from the U.S. Department of State.",
            "The person hired will have access to information and items subject to U.S. export "
            "controls, and therefore, must either be a “U.S. person” as defined by 22 C.F.R. "
            "§ 120.62 or otherwise eligible for deemed export licensing.",
        ):
            assert self.says(text) is None, text

    def test_statements_that_say_nothing_about_this_role(self) -> None:
        for text in (
            # Akuna: OPT is the student's own authorization, not a sponsorship.
            "Legal authorization to work in the U.S. is required on the first day of "
            "employment including F-1 students using OPT or STEM",
            # Cloudflare: an export licence's sponsor; Freedom: company events.
            "Please note that any offer of employment may be conditioned on your authorization "
            "to receive software or technology controlled under these U.S. export laws without "
            "sponsorship for an export license.",
            "Company sponsored events (game nights, holiday party, summer party, happy hours)",
            # IMC sponsors, except for some nationalities.
            "IMC is unable to obtain immigration sponsorship for candidates who currently have "
            "citizenship from Russia, Belarus or Iran",
            # Rivet, Maven: some other role's.
            "Certain roles may require U.S. Person status, security clearance eligibility, or "
            "other requirements imposed by law or government contract.",
            "Visa sponsorship is available for selected roles, please see our FAQ page for details",
        ):
            assert self.says(text) is None, text

    def test_a_full_time_offer_is_not_an_internships(self) -> None:
        # Jump Trading posts it on both; an intern works on CPT or OPT.
        text = (
            "INTERNATIONAL STUDENTS are encouraged to apply. We accept students eligible for "
            "CPT/OPT and we sponsor work visas for full-time positions."
        )
        assert self.says(text, "Campus Software Engineer (Intern)") is None
        assert self.says(text, "Campus AI Research Engineer (Full-Time)") == "sponsors"

    def test_a_stored_page_from_before_it_has_none(self) -> None:
        assert Facts.from_row({"job_type": "full_time"}).sponsorship is None
