"""Practical constraints stay short and grounded in explicit qualification text."""

import pytest

from app.services.requirements import extract


@pytest.mark.parametrize("statement,kind,summary", [
    ("At least 3 years of professional experience.", "experience", "3+ years of experience"),
    ("2-4 years of experience required.", "experience", "2-4 years of experience"),
    ("Previous internship experience in AI.", "experience", "Previous internship experience"),
    ("Experience deploying AI applications into production.", "experience", "AI production experience"),
    ("Must return to school after the internship.", "enrollment", "Returning to school after the internship"),
    ("Currently enrolled at an accredited university.", "enrollment", "Currently enrolled student"),
    ("Must work on-site 3 days per week.", "work_arrangement", "On-site work 3 days per week"),
    ("Available for 40 hours per week.", "availability", "40 hours per week"),
    ("Available for 20-40 hours per week.", "availability", "20-40 hours per week"),
    ("Available for at least 20 hours per week.", "availability", "at least 20 hours per week"),
    ("Up to 3 years of experience.", "experience", "Up to 3 years of experience"),
    ("Must commit to at least 12 weeks.", "availability", "At least 12 weeks available"),
    ("Minimum GPA of 3.0.", "gpa", "Minimum GPA 3.0"),
])
def test_explicit_practical_constraints(statement, kind, summary):
    items = extract("Requirements\n" + statement)
    assert any(item.kind == kind and item.summary == summary for item in items)


@pytest.mark.parametrize("statement", [
    "No previous internship experience required.",
    "3 years of experience or equivalent education.",
    "Work on-site or remotely.",
    "Must work on-site if assigned to a client.",
])
def test_do_not_turn_alternatives_or_conditions_into_blanket_constraints(statement):
    assert not any(item.kind in {"experience", "work_arrangement"} for item in extract("Requirements\n" + statement))


def test_company_pitch_and_benefits_are_not_constraints():
    assert extract("About the Company\nWe have 20 years of experience.\nBenefits\nWork 30 hours per week.") == []
    assert extract("Responsibilities\nYou must build AI systems into production.") == []


def test_distinct_availability_constraints_survive_and_duplicates_do_not():
    items = extract("Requirements\nAvailable for 40 hours per week.\nMust commit to 12 weeks.\nAvailable for 40 hours per week.")
    assert [item.summary for item in items] == ["40 hours per week", "12 weeks available"]
