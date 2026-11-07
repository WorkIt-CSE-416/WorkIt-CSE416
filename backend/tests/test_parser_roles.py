"""The role and the organization of Experience and Leadership entries (KAN-181).

Each fixture in fixtures/roles/ is made-up resume text in a layout a real
upload used, with none of that resume's words. Expectations are
(organization, title, location, bullet count) per entry; the dates are other
rules' (test_resume_parser.py). These fixtures live in their own folder, so
test_resume_parser.py's check that every fixture there has expectations
stays its own.
"""
import re
from pathlib import Path

import pytest

from app.services.bank_import import read
from app.utils.resume_parser import parse_resume

FIXTURES = Path(__file__).parent / "fixtures" / "roles"

EXPECTED = {
    # Jake's Resume from pdfTeX: "Organization  Dates", then "Role  City, ST"
    # after a PDF gap, then bullets. A club role with no job word in it
    # (Treasurer, Quartermaster, Archivist) made the organization the title
    # and the role line the first bullet.
    "jakes_club_roles.txt": {
        "experience": [
            ("Harborline Freight", "Software Engineer Intern", "Springfield, IL", 2),
            # a second role under the company, with no company line of its own
            ("Harborline Freight", "Data Analyst Intern", None, 1),
            # the title's own subtitle stays the student's wording
            ("Hilltop Vision Lab", "Research Intern; advised by Professor Ada Lin", "Hilltop, CA", 1),
        ],
        "leadership": [
            ("Example Chess Society", "Treasurer", "Springfield, IL", 2),
            ("Hillside Rowing Club", "Quartermaster", "Lakeview, OR", 1),
            # the organization's own dash stays in it
            ("Hilltop University – Student Life Office", "Peer Mentor", "Hilltop, CA", 1),
            # no location: the bullets right under it make it the role
            ("Maple Street Makers", "Archivist", None, 2),
            ("Lakeview Debate Union", "Co-Founder and Social Chair", "Lakeview, OR", 1),
        ],
    },
    # A Word export: "Organization – Role  Season Year – Present" on one line
    # read as one title with no organization. A company line above the date
    # line keeps the dash in the title ("Research Intern – Index Project").
    "word_org_dash_role.txt": {
        "experience": [
            ("Riverbend Systems Lab – Storage Group", "Research Intern – Index Project", "Hilltop, CA", 2),
            ("Hilltop University", "Teaching Assistant – Data Structures", "Hilltop, CA", 1),
            # "Role – Course" under an earlier role is that company's second role
            ("Hilltop University", "Lab Assistant – Algorithms", None, 1),
            ("Campus Bookstore", "Sales Associate (Part-Time)", None, 1),
        ],
        "leadership": [
            ("Moonball League", "Treasurer and Co-Captain", None, 3),
            ("Robotics Society", "Webmaster", None, 1),
            ("Garden Collective", "Co-Founder", None, 1),
        ],
    },
    # A two-column Chrome PDF lost the PDF gap before the location, so the
    # two-word city rule took the role's last word ("Intern Albany, NY") or
    # the whole one-word role ("Treasurer Albany, NY"), which then read as
    # both the title and the location.
    "single_space_role_city.txt": {
        "experience": [
            ("Harborline Freight", "Software Engineering Intern", "Albany, NY", 1),
            ("Hilltop Systems Lab", "Undergraduate Researcher", "Hilltop, CA", 1),
            # a two-word city with no role word in it stays whole
            ("Hilltop University", "Teaching Assistant", "Stony Point, NY", 1),
        ],
        "leadership": [
            ("Example Chess Society", "Treasurer", "Springfield, IL", 1),
        ],
    },
}


def _roles(entries) -> list[tuple]:
    return [
        (e.company_name, e.title, e.location, len(e.description.splitlines()) if e.description else 0)
        for e in entries
    ]


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.mark.parametrize("fixture", EXPECTED)
def test_reads_each_entrys_organization_and_role(fixture):
    parsed = parse_resume(_fixture(fixture))
    assert _roles(parsed.experience) == EXPECTED[fixture]["experience"]
    assert _roles(parsed.leadership) == EXPECTED[fixture]["leadership"]


def test_every_roles_fixture_has_expectations():
    assert {p.name for p in FIXTURES.glob("*.txt")} == set(EXPECTED)


def _one_space(value: str | None) -> str | None:
    return re.sub(r"\s+", " ", value) if value else value


def test_text_with_every_gap_two_spaces_reads_the_same():
    # A XeTeX PDF extracted before the extraction fix stored every gap as two
    # spaces, word gaps and the gap before the right column alike
    # (test-person-latex.pdf), and Import Again re-reads that stored text.
    parsed = parse_resume(re.sub(r" +", "  ", _fixture("jakes_club_roles.txt")))
    for section in ("experience", "leadership"):
        got = [(_one_space(o), _one_space(t), _one_space(loc), n)
               for o, t, loc, n in _roles(getattr(parsed, section))]
        assert got == EXPECTED["jakes_club_roles.txt"][section]


def test_the_bank_gets_the_organization_and_the_role():
    entries, _ = read(_fixture("word_org_dash_role.txt"))
    club = next(e for e in entries if e.section.value == "leadership")
    assert (club.organization, club.title) == ("Moonball League", "Treasurer and Co-Captain")


def test_role_first_dash_lines_split_when_every_entry_is_one():
    parsed = parse_resume(
        "Leadership\n"
        "Outreach Lead – Coding for Kids  Jan 2023 – Dec 2023\n"
        "• Taught Scratch to 20 students on Saturdays\n"
        "Webmaster - Hilltop Astronomy Club  Sep 2022 - May 2023\n"
        "• Moved the club's site to a static host\n"
    )
    assert [(e.company_name, e.title) for e in parsed.leadership] == [
        ("Coding for Kids", "Outreach Lead"),
        ("Hilltop Astronomy Club", "Webmaster"),
    ]


def test_a_dash_with_no_role_word_on_either_side_is_one_name():
    # role words decide: without one, the dash may be the organization's own
    parsed = parse_resume(
        "Experience\n"
        "Riverbend Systems Lab – Storage Group  Jan 2024 – Present\n"
        "• Ran nightly backups for 3 file servers\n"
    )
    assert [(e.company_name, e.title) for e in parsed.experience] == [
        ("Riverbend Systems Lab – Storage Group", "Riverbend Systems Lab – Storage Group"),
    ]
