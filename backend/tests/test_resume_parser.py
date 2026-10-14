"""Regression tests for the heuristic resume parser.

Each fixture is the extracted text of a real resume in a layout that once broke
the parser, cut to start at the first section header so no contact details are
stored.

When a new layout breaks parsing: extract its text, add it as a fixture, write
down what it *should* parse to here, then fix the parser until every case passes.
"""
from pathlib import Path

import pytest

from app.utils.resume_parser import parse_resume

FIXTURES = Path(__file__).parent / "fixtures"

# education: (institution, degree, field_of_study, gpa, end_date)
# experience and leadership: (organization, title, location, start_date, end_date, bullet_count)
# awards: (title, issuer, date)
# A fixture without "leadership" or "awards" keys expects those sections empty.
EXPECTED = {
    # Google Docs export: pipes in the school line, a second role with no company line
    "google_docs_single_column.txt": {
        "education": [
            ("Stony Brook University", "B.S", "Computer Science", None, "2026-12-01"),
        ],
        "experience": [
            ("Pulp Internet Corporation (Seed-Stage AI Startup)", "Product Designer & Engineer",
             None, "2025-10-01", "2026-08-01", 3),
            ("Pulp Internet Corporation (Seed-Stage AI Startup)", "Product & Operations Lead Intern",
             None, "2025-01-01", "2025-08-01", 3),
        ],
        "projects": [
            "thinkwell (Pulp) |AI Communications Intelligence Platform",
            "pulp101.com (Pulp) | Editorial & Discussion Platform",
            "AI Pitch Room (Pulp) |Interactive Investor Experience",
        ],
        "skill_count": 25,
    },
    # Company+Dates / Title+Location; "Intern Brooklyn, NY" must not become the location
    "react_pdf_single_column.txt": {
        "education": [
            ("Stony Brook University", "B.S", "Computer Science Honors", 3.86, "2027-05-01"),
        ],
        "experience": [
            ("Washington University Summer Engineering Fellowship (WUSEF) – CyanoAgent",
             "AI Research Fellow", "St. Louis, MO", "2026-05-01", "2026-08-01", 4),
            ("Stony Brook University Computer Science Department – Operations & Data",
             "Software Engineer and IT Support", "Stony Brook, NY", "2025-01-01", "2026-05-01", 4),
            ("Pulp Corporation", "Software Engineer Intern", "Brooklyn, NY", "2025-01-01", "2025-08-01", 3),
            ("Stony Brook University Campus Residences", "Resident Assistant", "Stony Brook, NY",
             "2024-08-01", None, 3),
        ],
        "projects": ["Academic Advising Bot", "Playlister"],
        "skill_count": 27,
    },
    # Title / Company / Dates+Location, "current" end dates, bullets drawn as shapes
    "two_column_no_bullet_glyphs.txt": {
        "education": [
            ("The Harker School", "High School Diploma", None, None, "2018-01-01"),
        ],
        "experience": [
            ("Panda Express", "Cashier", "San Jose, CA", "2022-01-01", None, 4),
            ("Chick-fil-A", "Retail Sales Associate", "San Jose, CA", "2020-01-01", "2022-01-01", 4),
            ("The Table", "Dishwasher", "San Jose, CA", "2018-01-01", "2020-01-01", 4),
        ],
        "projects": [],
        "skill_count": 9,
    },
    # Title | Company / Location | Dates, and everything on one line
    "word_pipe_layout.txt": {
        "education": [
            ("Stony Brook University", "B.S", "Computer Science Honors", 3.86, "2027-05-01"),
        ],
        "experience": [
            ("Washington University Summer Engineering Fellowship", "AI Researcher", "St. Louis, MO",
             "2026-05-01", "2026-08-01", 3),
            ("Stony Brook University Operations & Data", "Software Engineer and IT Analyst",
             "Stony Brook, NY", "2025-01-01", "2026-05-01", 3),
            ("Pulp Corporation", "Software Engineer Intern", "Brooklyn, NY", "2025-01-01", "2025-08-01", 3),
            ("Stony Brook University Campus Residences", "Resident Assistant", "Stony Brook, NY",
             "2024-08-01", None, 3),
        ],
        "projects": ["WorkIt | Full Stack Recruiting Platform", "Stony Brook Academic Advising Bot"],
        "skill_count": 18,
    },
    # Leadership & Activities in the Company+Dates / Title+Location layout;
    # Awards one per line as "Award – Issuer  Date", one with a year only
    "leadership_and_awards_single_column.txt": {
        "education": [
            ("Riverside State University", "B.S", "Mechanical Engineering", 3.62, "2027-05-01"),
        ],
        "experience": [
            ("Harbor Robotics", "Mechanical Engineering Intern", "Portland, OR", "2026-06-01", "2026-08-01", 2),
        ],
        "leadership": [
            ("Society of Women Engineers", "Vice President", "Riverside, CA", "2025-09-01", None, 2),
            ("Formula SAE Racing Team", "Suspension Lead", "Riverside, CA", "2024-09-01", "2025-05-01", 1),
        ],
        "awards": [
            ("Dean's List", "Riverside State University", "2025-12-01"),
            ("First Place, Regional Design Competition", "ASME", "2025-04-01"),
            ("Merit Scholarship", None, "2024-01-01"),
        ],
        "projects": [],
        "skill_count": 6,
    },
    # "LEADERSHIP EXPERIENCE" is not Experience; "HONORS & AWARDS" as bullets
    # split by "|"
    "pipe_layout_leadership_honors.txt": {
        "education": [
            ("Northfield University", "Bachelor of Science", "Computer Science", None, "2027-12-01"),
        ],
        "experience": [],
        "leadership": [
            ("Coding Club", "President", "Chicago, IL", "2025-08-01", None, 2),
            ("Northfield University Learning Center", "Peer Tutor", "Chicago, IL", "2025-01-01", "2025-05-01", 1),
        ],
        "awards": [
            ("Hackathon Winner, Best Use of Data", "HackNorth", "2025-10-01"),
            ("President's Scholarship", "Northfield University", "2025-08-01"),
        ],
        "projects": ["Budget Buddy"],
        "skill_count": 3,
    },
    # Jake's Resume from LaTeX: "Expected Graduation:" beside the school, a
    # wrapped coursework bullet, undated "Name| tools" projects, a wrapped
    # skills line, and PDF gaps after bold phrases
    "jakes_undated_projects.txt": {
        "education": [
            ("Lakeview University", "Bachelor of Science", "Computer Science", 3.62, "2027-05-01"),
        ],
        "experience": [
            ("Harbor Transit", "Software Engineer Intern", None, "2025-06-01", "2025-08-01", 2),
            ("Riverside Robotics Lab", "Undergraduate Researcher", None, "2024-12-01", "2025-05-01", 1),
        ],
        "projects": ["Line Following Robot", "Plant Disease Classifier", "Arm Control Demo"],
        "skill_count": 11,
    },
}


def _iso(d):
    return d.isoformat() if d else None


def _bullet_count(description):
    return len(description.splitlines()) if description else 0


@pytest.mark.parametrize("fixture", EXPECTED)
def test_parses_fixture(fixture):
    expected = EXPECTED[fixture]
    parsed = parse_resume((FIXTURES / fixture).read_text(encoding="utf-8"))

    assert [
        (e.institution, e.degree, e.field_of_study, e.gpa, _iso(e.end_date))
        for e in parsed.education
    ] == expected["education"]
    assert [
        (e.company_name, e.title, e.location, _iso(e.start_date), _iso(e.end_date),
         _bullet_count(e.description))
        for e in parsed.experience
    ] == expected["experience"]
    assert [
        (e.company_name, e.title, e.location, _iso(e.start_date), _iso(e.end_date),
         _bullet_count(e.description))
        for e in parsed.leadership
    ] == expected.get("leadership", [])
    assert [(a.title, a.issuer, _iso(a.date)) for a in parsed.awards] == expected.get("awards", [])
    assert [p.project_name for p in parsed.projects] == expected["projects"]
    assert len(parsed.skills) == expected["skill_count"]


def test_every_fixture_has_expectations():
    # A fixture dropped in without expectations would silently test nothing
    assert {p.name for p in FIXTURES.glob("*.txt")} == set(EXPECTED)


def test_jakes_layout_details():
    parsed = parse_resume((FIXTURES / "jakes_undated_projects.txt").read_text(encoding="utf-8"))
    school = parsed.education[0]
    assert school.gpa_scale == 4.0
    # the wrapped second line of coursework stays with the first
    assert school.description == (
        "Relevant Coursework: Data Structures & Algorithms, Discrete Mathematics, Graph Theory, "
        "Linear Algebra, Operating Systems, Compilers, Probability & Statistics"
    )
    assert [p.technologies for p in parsed.projects] == [
        ["C++", "CMake", "Raspberry Pi"], ["Python", "PyTorch"], ["C++", "CUDA"],
    ]
    # a PDF gap after a bold phrase is one space; a missing-glyph tilde is "~"
    assert parsed.projects[0].description.splitlines()[0].startswith("Programmed a Raspberry Pi to")
    assert "from~90ms" in parsed.projects[2].description
    # the wrapped "Concepts" line keeps its group
    assert [(s.skill_name, s.category) for s in parsed.skills[-2:]] == [
        ("Machine Learning", "Concepts"), ("Agile", "Concepts"),
    ]


def test_project_subtitle_after_bar_stays_in_the_name():
    parsed = parse_resume("Projects\nWorkIt | Recruiting Platform\n• Built it.\n")
    assert [(p.project_name, p.technologies) for p in parsed.projects] == [
        ("WorkIt | Recruiting Platform", []),
    ]


def test_leading_minus_sign_is_not_a_bullet_marker():
    # KAN-224: the four lines once parsed to one, "20% churn ..."
    parsed = parse_resume(
        "EXPERIENCE\n"
        "Software Engineering Intern\n"
        "Acme Corp, New York, NY\n"
        "June 2025 - August 2025\n"
        "Built a REST API in FastAPI that served 10,000 daily requests.\n"
        "Cut page load time by 40% by caching job search results in Redis.\n"
        "Wrote 120 unit tests and raised coverage from 55% to 85%.\n"
        "-20% churn after redesigning the onboarding flow.\n"
    )
    assert parsed.experience[0].description.splitlines() == [
        "Built a REST API in FastAPI that served 10,000 daily requests.",
        "Cut page load time by 40% by caching job search results in Redis.",
        "Wrote 120 unit tests and raised coverage from 55% to 85%.",
        "-20% churn after redesigning the onboarding flow.",
    ]


def test_hyphen_glued_to_a_word_is_still_a_bullet_marker():
    parsed = parse_resume(
        "EXPERIENCE\n"
        "Software Engineering Intern\n"
        "Acme Corp, New York, NY\n"
        "June 2025 - August 2025\n"
        "-Built a REST API in FastAPI\n"
        "-Wrote 120 unit tests\n"
    )
    assert parsed.experience[0].description.splitlines() == [
        "Built a REST API in FastAPI",
        "Wrote 120 unit tests",
    ]


def test_lines_before_the_first_marker_are_kept():
    parsed = parse_resume(
        "EXPERIENCE\n"
        "Software Engineering Intern\n"
        "Acme Corp, New York, NY\n"
        "June 2025 - August 2025\n"
        "Built a REST API in FastAPI.\n"
        "- Wrote 120 unit tests.\n"
    )
    assert parsed.experience[0].description.splitlines() == [
        "Built a REST API in FastAPI.",
        "Wrote 120 unit tests.",
    ]
