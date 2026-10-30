"""The editor's typed lines read into changes (KAN-391), pure: no database."""

from decimal import Decimal

import pytest

from app.services.resume_lines import LineError, parse


@pytest.mark.parametrize(("kind", "text", "target", "changes"), [
    ("bullet", "  Cut load time by 35%  ", "bullet", {"text": "Cut load time by 35%"}),
    ("title", "Software Intern", "entry", {"title": "Software Intern"}),
    ("location", "", "entry", {"location": None}),
    ("gpa", "GPA: 3.8/4.0", "entry", {"gpa": Decimal("3.8"), "gpa_scale": Decimal("4.0")}),
    ("gpa", "3.81", "entry", {"gpa": Decimal("3.81"), "gpa_scale": None}),
    ("gpa", "GPA:", "entry", {"gpa": None, "gpa_scale": None}),
    ("coursework", "Relevant Coursewok: Algorithms,  OS, ", "entry", {"coursework": ["Algorithms", "OS"]}),
    ("honors", "Honors: Summa Cum Laude", "entry", {"honors": "Summa Cum Laude"}),
    ("honors", "Honors:", "entry", {"honors": None}),
    ("full_name", "Sam Seeker", "header", {"full_name": "Sam Seeker"}),
    ("phone_number", "", "header", {"phone_number": None}),
    ("github_url", "github.com/sam", "header", {"github_url": "https://github.com/sam"}),
    ("other_url", "HTTP://sam.dev", "header", {"other_url": "HTTP://sam.dev"}),
])
def test_a_typed_line_becomes_its_change(kind, text, target, changes):
    line = parse(kind, text)
    assert (line.target, line.changes) == (target, changes)


@pytest.mark.parametrize(("kind", "text"), [
    ("bullet", " "),
    ("title", ""),
    ("full_name", ""),
    ("gpa", "3.8 out of 4"),
    ("dates", "June 2025"),
    ("degree", "BS"),
    ("email", "me@example.com"),
    ("skill", "Python"),
])
def test_a_line_that_cannot_be_saved_says_why(kind, text):
    with pytest.raises(LineError):
        parse(kind, text)
