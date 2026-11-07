"""Education entries and dates (KAN-181): made-up resumes in the layouts of
real uploads the parser read wrong. Each fixture in fixtures/education_dates/
keeps a real layout with invented words.

The expectations live here, not in test_resume_parser.py's EXPECTED, which
other parser branches edit at the same time; the subfolder keeps these
fixtures out of that module's every-fixture check.
"""
from datetime import date
from pathlib import Path

import pytest

from app.services.bank_import import draft_entries
from app.utils import resume_parser
from app.utils.resume_parser import parse_resume

FIXTURES = Path(__file__).parent / "fixtures"
OURS = FIXTURES / "education_dates"
TODAY = date(2026, 11, 5)


def _iso(d):
    return d.isoformat() if d else None


def _text(name: str) -> str:
    return (OURS / name).read_text(encoding="utf-8")


def _schools(text: str):
    return [
        (e.institution, e.location, e.degree, e.field_of_study, e.gpa, e.gpa_scale,
         _iso(e.start_date), _iso(e.end_date))
        for e in parse_resume(text).education
    ]


# (institution, location, degree, field_of_study, gpa, gpa_scale, start_date, end_date)
SCHOOLS = {
    # Overleaf (pdfTeX): "School  City, ST", then one dated line per degree.
    # The school kept its city, and the second degree line became a school.
    "latex_two_degrees.txt": [
        ("Hillcrest State University", "Hillcrest, NY", "M.S", "Applied Mathematics Honors (Accelerated BS/MS)",
         None, None, None, "2029-05-01"),
        ("Hillcrest State University", "Hillcrest, NY", "B.S", "Applied Mathematics Honors",
         3.92, 4.0, None, "2028-05-01"),
    ],
    # Word: the first school's coursework wraps onto an honors line right
    # above a dated school line with no school word ("University") in it.
    # The honors line became the second school's name.
    "word_two_schools.txt": [
        ("Lakeview University", None, "Bachelor of Science", "Information Systems", 3.55, 4.0, None, "2028-05-01"),
        ("SUNY Harbor", None, "Bachelor of Science", "Information Systems", 3.55, 4.0, "2027-02-01", "2027-06-01"),
    ],
    # Google Docs: "School | City, ST  Dates", two schools. The second school
    # took the first one's coursework line for its header.
    "google_docs_two_schools.txt": [
        ("Riverside State University", "Riverside, CA", "B.S", "Statistics", None, None, None, "2027-12-01"),
        ("Bayview Community College", "Bayview, CA", "A.S", "Mathematics", None, None, None, "2025-05-01"),
    ],
}

# Each school's description, in the order above
DESCRIPTIONS = {
    "latex_two_degrees.txt": [
        # the lines under the last degree are that degree's, as in any entry
        None,
        ("GPA:3.92/4.00|Dean's List (5 Semesters)\n"
         "Coursework:Numerical Methods, Real Analysis, Optimization, Probability, Statistical Computing"),
    ],
    "word_two_schools.txt": [
        # Known ceiling: the honors line is back with its school but dropped,
        # and "Distributed" stays cut from "Distributed Computing"
        ("Relevant Coursework: Database Design, Operating Systems Fundamentals, Introduction to Web Programming, "
         "Distributed"),
        "Relevant Coursework: Data Mining, Computer Networks",
    ],
    "google_docs_two_schools.txt": [
        "Relevant Courses: Regression Analysis, Bayesian Methods, Sampling Theory, Data Visualization",
        "Relevant Courses: Calculus III, Linear Algebra, Differential Equations",
    ],
}


@pytest.mark.parametrize("fixture", SCHOOLS)
def test_reads_each_school(fixture):
    assert _schools(_text(fixture)) == SCHOOLS[fixture]
    assert [e.description for e in parse_resume(_text(fixture)).education] == DESCRIPTIONS[fixture]


def test_every_fixture_here_has_expectations():
    assert {p.name for p in OURS.glob("*.txt")} == set(SCHOOLS) == set(DESCRIPTIONS)


def test_a_season_range_reads_its_months_and_leaves_the_title():
    # "Spring 2024 – Present" started in January because "Spring" was no
    # month, and "Spring" stayed at the end of the role's line
    parsed = parse_resume(_text("word_two_schools.txt"))
    assert [(_iso(r.start_date), _iso(r.end_date)) for r in parsed.leadership] == [("2025-01-01", None)]
    role = parsed.leadership[0]
    assert "Spring" not in role.title and "Spring" not in role.company_name


# --- Where a school's city goes ------------------------------------------------

@pytest.mark.parametrize(("fixture", "location"), [
    # "School | City, ST  Expected December 2026"
    ("google_docs_single_column.txt", "Stony Brook, NY"),
    # "Diploma / School / 2014 - 2018 / City, ST"
    ("two_column_no_bullet_glyphs.txt", "San Jose, CA"),
])
def test_a_school_keeps_its_city_from_the_older_fixtures(fixture, location):
    school = parse_resume((FIXTURES / fixture).read_text(encoding="utf-8")).education[0]
    assert school.location == location
    assert location not in school.institution


def test_a_city_after_one_space_before_the_dates_is_the_location():
    assert _schools("Education\nRiverside State University | Riverside, CA Expected December 2027\n"
                    "B.S. in Statistics\n") == [
        ("Riverside State University", "Riverside, CA", "B.S", "Statistics", None, None, None, "2027-12-01"),
    ]


def test_a_city_on_the_degree_line_under_dated_school_is_the_schools():
    # XeTeX (every word gap two spaces): "School  Dates" over "Degree, GPA  City, ST"
    text = ("Education\nExample  State  University  Aug  2024  –  May  2028\n"
            "Bachelor  of  Science  in  Computer  Science,  GPA:  3.7/4.0  Springfield,  IL\n")
    school = draft_entries(parse_resume(text), today=TODAY)[0]
    assert (school.title, school.location, _iso(school.start_month), _iso(school.end_month), school.end_kind.value) == (
        "Example State University", "Springfield, IL", "2024-08-01", "2028-05-01", "expected",
    )
    assert (school.degree, school.gpa, school.gpa_scale) == ("Bachelor of Science", 3.7, 4.0)


def test_the_import_saves_the_schools_city_as_its_location():
    schools = [d for d in draft_entries(parse_resume(_text("latex_two_degrees.txt")), today=TODAY)]
    assert [(d.title, d.location, d.degree, _iso(d.end_month), d.end_kind.value) for d in schools] == [
        ("Hillcrest State University", "Hillcrest, NY", "M.S", "2029-05-01", "expected"),
        ("Hillcrest State University", "Hillcrest, NY", "B.S", "2028-05-01", "expected"),
    ]
    assert schools[1].coursework == [
        "Numerical Methods", "Real Analysis", "Optimization", "Probability", "Statistical Computing",
    ]


def test_a_state_code_that_spells_a_degree_is_only_the_location():
    # ", MA" read as a Master of Arts: it was the degree, and it kept the line
    # from naming the school
    assert _schools("Education\nBayside University  Boston, MA\nB.S. in Computer Science  Expected May 2027\n") == [
        ("Bayside University", "Boston, MA", "B.S", "Computer Science", None, None, None, "2027-05-01"),
    ]


# --- Which line names the school -------------------------------------------------

def test_a_dated_line_with_its_own_text_is_the_school_whatever_its_words():
    # No school word in "Ridgeview Tech": the plain line above it is the end
    # of the school before, not this school's name
    parsed = parse_resume(
        "Education\nLakeview University  Aug 2020 – May 2024\nB.S. in Physics\nGPA: 3.61\n"
        "Ridgeview Tech  Aug 2024 – May 2026\nM.S. in Robotics\n"
    )
    assert [(e.institution, e.degree, e.gpa, _iso(e.start_date)) for e in parsed.education] == [
        ("Lakeview University", "B.S", 3.61, "2020-08-01"),
        ("Ridgeview Tech", "M.S", None, "2024-08-01"),
    ]


def test_a_school_line_with_no_school_word_above_a_dated_degree_stays_the_school():
    assert _schools(
        "Education\nLakeview University  Aug 2020 – May 2024\nB.S. in Physics\n"
        "Ridgeview Tech  Atlanta, GA\nM.S. in Robotics  May 2026\n"
    ) == [
        ("Lakeview University", None, "B.S", "Physics", None, None, "2020-08-01", "2024-05-01"),
        ("Ridgeview Tech", "Atlanta, GA", "M.S", "Robotics", None, None, None, "2026-05-01"),
    ]


def test_a_degree_line_above_its_dated_school_stays_with_that_school():
    # "Degree / School  Dates": the degree line names a degree, so it is the
    # next school's, never the end of the one before
    assert [(e.institution, e.degree) for e in parse_resume(
        "Education\nBachelor of Arts in History\nLakeview University  Aug 2018 – May 2022\n"
        "Master of Science in Data Science\nHillcrest State University  Aug 2022 – May 2024\n"
    ).education] == [
        ("Lakeview University", "Bachelor of Arts"),
        ("Hillcrest State University", "Master of Science"),
    ]


@pytest.mark.parametrize(("line", "field"), [
    # no "in" or comma between the degree and the field
    ("B.S. Computer Science  GPA: 3.86/4.00", "Computer Science"),
    ("BA Economics", "Economics"),
    ("Master's in Data Science", "Data Science"),
    ("Bachelor's in Biology", "Biology"),
    # a date after one space is no part of the field
    ("B.S. in Statistics Expected May 2027", "Statistics"),
])
def test_the_field_of_study_follows_the_degree(line, field):
    school = parse_resume(f"Education\nLakeview University\n{line}\n").education[0]
    assert (school.institution, school.field_of_study) == ("Lakeview University", field)


# --- Dates -------------------------------------------------------------------------

@pytest.mark.parametrize(("text", "span"), [
    # a season starts in its first month and ends in its last
    ("Spring 2024 – Present", ("2024-01-01", None)),
    ("Fall 2023 – Spring 2024", ("2023-09-01", "2024-05-01")),
    ("Summer 2025 - Fall 2025", ("2025-06-01", "2025-12-01")),
    ("autumn 2024 – winter 2025", ("2024-09-01", "2025-03-01")),
    ("Winter 2025 – Present", ("2025-01-01", None)),
    # a season alone spans its months; a month alone is an end
    ("Summer 2025", ("2025-06-01", "2025-08-01")),
    ("May 2025", (None, "2025-05-01")),
    ("Expected Spring 2027", (None, "2027-05-01")),
    ("Expected Fall 2026", (None, "2026-12-01")),
    # months as numbers, and abbreviations with a full stop
    ("06/2025 – 08/2025", ("2025-06-01", "2025-08-01")),
    ("6/2025 - Present", ("2025-06-01", None)),
    ("Sept. 2023 – May 2024", ("2023-09-01", "2024-05-01")),
    ("Sept 2023 – Present", ("2023-09-01", None)),
    ("Aug. 2024 – Dec. 2024", ("2024-08-01", "2024-12-01")),
    # years alone read as January, as before
    ("2023 – 2024", ("2023-01-01", "2024-01-01")),
    # a page range is no pair of years
    ("pp. 1201–1210", (None, None)),
])
def test_date_text_reads_as_months(text, span):
    start, end = resume_parser._parse_date_range(text)
    assert (_iso(start), _iso(end)) == span


def test_an_awards_season_is_its_date_and_leaves_its_title():
    # "Fall" was no month: the year alone gave January, and "Fall" stayed in the title
    parsed = parse_resume("Awards\nDean's List  Fall 2024\nMerit Scholarship  2023\n")
    assert [(a.title, _iso(a.date)) for a in parsed.awards] == [
        ("Dean's List", "2024-12-01"), ("Merit Scholarship", "2023-01-01"),
    ]


def test_a_schools_lone_season_is_its_graduation():
    # "Spring 2027" on a school line ends the school in May; it does not
    # start it in January
    assert _schools("Education\nHillcrest State University  Spring 2027\nB.S. in Biology\n") == [
        ("Hillcrest State University", None, "B.S", "Biology", None, None, None, "2027-05-01"),
    ]


def test_season_and_numeric_ranges_split_entries_and_leave_the_names():
    parsed = parse_resume(
        "Projects\nBudget Buddy  Fall 2025 – Spring 2026\n• Built a shared expense tracker.\n"
        "Line Robot  06/2025 – 08/2025\n• Tuned the motor controller.\n"
        "Weather Bot  Summer 2024\n• Posted daily forecasts.\n"
    )
    assert [(p.project_name, _iso(p.start_date), _iso(p.end_date)) for p in parsed.projects] == [
        ("Budget Buddy", "2025-09-01", "2026-05-01"),
        ("Line Robot", "2025-06-01", "2025-08-01"),
        ("Weather Bot", "2024-06-01", "2024-08-01"),
    ]


def test_a_month_in_a_wrapped_sentence_starts_no_entry():
    # The date patterns anchor entries in every section: "May 2025." ending
    # a wrapped bullet line stays part of that bullet
    parsed = parse_resume(
        "Projects\nLine Robot  Jan 2025 – May 2025\n"
        "• Built the motor controller and tuned it with the team, which we\n"
        "shipped by May 2025.\n"
        "• Q3 milestone: demo for the club, which\n"
        "Finished by May 2025.\n"
    )
    assert [(p.project_name, len(p.description.splitlines())) for p in parsed.projects] == [("Line Robot", 2)]


# --- A bullet with no marker above a date line -----------------------------------
# Chrome and Google Docs PDFs draw bullets as shapes, so no "•" reaches the
# text. The last bullet of an entry, right above the next entry's date line,
# was taken for that entry's header: it left its entry, and became the next
# one's organization or project name.

def _roles(parsed, section="experience"):
    return [(r.company_name, r.title, r.location, _iso(r.start_date), _iso(r.end_date), r.description)
            for r in getattr(parsed, section)]


def test_a_sentence_above_a_dated_company_line_stays_a_bullet_of_the_job_before():
    # "Company  Dates / Title  City / bullets", as Chrome prints Jake's Resume
    parsed = parse_resume(
        "Experience\nHarbor Freight Lines  June 2025 – Aug 2025\nData Engineering Intern  Portland, OR\n"
        "Moved the nightly load to a streaming job that cut delays by 40%.\n"
        "Wrote the runbook the on-call team now uses for every outage.\n"
        "Riverside Signals Lab  Jan 2025 – Present\nUndergraduate Researcher  Portland, OR\n"
        "Measured how three schedulers behave under bursty traffic.\n"
    )
    assert _roles(parsed) == [
        ("Harbor Freight Lines", "Data Engineering Intern", "Portland, OR", "2025-06-01", "2025-08-01",
         ("Moved the nightly load to a streaming job that cut delays by 40%.\n"
          "Wrote the runbook the on-call team now uses for every outage.")),
        ("Riverside Signals Lab", "Undergraduate Researcher", "Portland, OR", "2025-01-01", None,
         "Measured how three schedulers behave under bursty traffic."),
    ]


def test_a_bullet_with_no_full_stop_above_a_date_line_stays_with_its_entry():
    parsed = parse_resume(
        "Experience\nHarbor Freight Lines  June 2025 – Aug 2025\nData Engineering Intern  Portland, OR\n"
        "Moved the nightly load to a streaming job that cut delays by 40%\n"
        "Riverside Signals Lab  Jan 2025 – Present\nUndergraduate Researcher  Portland, OR\n"
    )
    assert [r.description for r in parsed.experience] == [
        "Moved the nightly load to a streaming job that cut delays by 40%", None,
    ]


def test_a_clubs_last_bullet_never_names_the_next_club():
    # "Org – Role  Spring 2024 – Present" under a club's only bullet: the
    # bullet became the organization
    parsed = parse_resume(
        "Leadership\nLakeside Debate Society  Sep 2023 – Present\nFinance Director  Portland, OR\n"
        "Managed a $3,500 budget for travel and tournament fees.\n"
        "Go Club – Event Coordinator  Spring 2024 – Present\nRan weekly study nights for 18 members.\n"
    )
    first, second = parsed.leadership
    assert (first.company_name, first.title, first.description) == (
        "Lakeside Debate Society", "Finance Director", "Managed a $3,500 budget for travel and tournament fees.",
    )
    assert "Managed" not in second.company_name and "Managed" not in second.title
    assert (_iso(second.start_date), second.end_date, second.description) == (
        "2024-01-01", None, "Ran weekly study nights for 18 members.",
    )


def test_a_projects_last_bullet_never_names_the_next_project():
    parsed = parse_resume(
        "Projects\nTide Tracker | Python, Flask  Jan 2026 – Apr 2026\n"
        "Built a dashboard that shows tide tables for 40 harbors.\n"
        "Cached the forecasts so each page loads in under a second.\n"
        "Rain Gauge Bot | Go, SQLite  Sep 2025 – Dec 2025\nPosted daily rainfall totals to the club's chat.\n"
    )
    assert [(p.project_name, len(p.description.splitlines())) for p in parsed.projects] == [
        ("Tide Tracker", 2), ("Rain Gauge Bot", 1),
    ]


def test_a_company_line_above_a_dated_title_stays_its_header():
    # "Company / Title  Dates": a name, not a sentence, so it heads the entry below
    parsed = parse_resume(
        "Experience\nHarbor Freight Lines\nData Engineering Intern  June 2025 – Aug 2025\n"
        "Moved the nightly load to a streaming job.\n"
        "Riverside Signals Lab\nResearch Assistant  Jan 2025 – Present\n"
        "Measured how three schedulers behave under bursty traffic.\n"
    )
    assert [(r.company_name, r.title, r.description) for r in parsed.experience] == [
        ("Harbor Freight Lines", "Data Engineering Intern", "Moved the nightly load to a streaming job."),
        ("Riverside Signals Lab", "Research Assistant", "Measured how three schedulers behave under bursty traffic."),
    ]


@pytest.mark.parametrize(("line", "sentence"), [
    ("Cut the weekly report from 4 minutes to 20 seconds with PostgreSQL indexes", True),
    ("Managed a $4,000 budget for parts and travel", True),
    ("Led a team of 5", True),
    # names: few lowercase words, and none outside short joining words
    ("Lakeview Systems Lab", False),
    ("Society of Women Engineers", False),
    ("Center for the Study of Language and Information", False),
    ("Pulp Internet Corporation (seed-stage startup)", False),
    ("Undergraduate Researcher", False),
    ("Relevant Coursework: Data Structures, Algorithms", False),
])
def test_what_reads_as_a_sentence(line, sentence):
    assert resume_parser._reads_as_sentence(line) is sentence


# --- Publications ----------------------------------------------------------------

@pytest.mark.parametrize("citation", [
    "R. Lee and M. Ortiz. Cheaper Index Builds with Sampled Keys. Example Systems Workshop, May 2025.",
    # XeTeX: every word gap two spaces
    "R.  Lee  and  M.  Ortiz.  Cheaper  Index  Builds  with  Sampled  Keys.  Example  Systems  Workshop,  May  2025.",
])
def test_a_citations_month_before_its_full_stop_is_its_date(citation):
    # The full stop hid "May 2025" from the date patterns, so it read as January
    project = draft_entries(parse_resume(f"Publications\n{citation}\n"), today=TODAY)[0]
    assert (project.title, _iso(project.end_month)) == (
        "R. Lee and M. Ortiz. Cheaper Index Builds with Sampled Keys. Example Systems Workshop", "2025-05-01",
    )


def test_a_citations_page_range_is_no_date():
    parsed = parse_resume("Publications\nM. Ortiz. A Faster Tokenizer. Journal of Examples, pp. 1201–1210, 2024.\n")
    assert [(p.project_name, _iso(p.end_date)) for p in parsed.projects] == [
        ("M. Ortiz. A Faster Tokenizer. Journal of Examples, pp. 1201–1210, 2024.", "2024-01-01"),
    ]
