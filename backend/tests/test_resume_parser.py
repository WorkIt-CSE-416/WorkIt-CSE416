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
# experience: (company, title, location, start_date, end_date, bullet_count)
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
    assert [p.project_name for p in parsed.projects] == expected["projects"]
    assert len(parsed.skills) == expected["skill_count"]


def test_every_fixture_has_expectations():
    # A fixture dropped in without expectations would silently test nothing
    assert {p.name for p in FIXTURES.glob("*.txt")} == set(EXPECTED)
