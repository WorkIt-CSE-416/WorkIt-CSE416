"""Skill highlights preserve qualifications, preferences and alternatives."""

import pytest

from app.services.requirements import extract


def skills(text):
    return {
        item.summary: item.importance
        for item in extract(text)
        if item.kind == "skills"
    }


def test_parenthetical_framework_preferences_do_not_change_python_requirement():
    assert skills(
        "Requirements\nProficient in Python and modern backend frameworks (FastAPI, Django preferred)."
    ) == {"Python": "required", "FastAPI": "preferred", "Django": "preferred"}


@pytest.mark.parametrize("separator", ["or", "/", "and/or"])
def test_language_alternatives_are_one_highlight(separator):
    assert skills(f"Requirements\nProficient in Python {separator} Java.") == {
        "Python or Java": "required"
    }


def test_independent_languages_stay_independent():
    assert skills("Requirements\nPython and Java required.") == {
        "Python": "required", "Java": "required"
    }


def test_three_language_alternatives_keep_or():
    assert skills("Requirements\nExperience with Python, Java, or C++.") == {
        "Python or Java or C++": "required"
    }


def test_comma_separates_explicit_requirement_from_preference():
    assert skills("Requirements\nPython required, Java preferred.") == {
        "Python": "required", "Java": "preferred"
    }


def test_negation_only_suppresses_its_clause():
    assert skills("Requirements\nPython required; no prior experience with Java necessary.") == {
        "Python": "required"
    }


def test_ai_architecture_and_evaluation_have_concise_highlights():
    result = skills("""What You Bring
Experience with agentic architectures, including orchestration, retrieval-augmented generation (RAG), and safety guardrails.
Experience creating human and automated evals to ensure high AI model quality.""")
    assert set(result) == {
        "Agentic AI", "Orchestration", "RAG", "Safety guardrails", "AI model evaluation"
    }


@pytest.mark.parametrize("heading", ["What You'll Do", "About Us", "What We Offer"])
def test_company_and_responsibility_sections_end_skill_extraction(heading):
    assert skills(f"Basic Qualifications\nPython\n{heading}\nUse Java and SQL.") == {
        "Python": "required"
    }


def test_pitch_without_qualification_section_is_not_a_requirement():
    assert skills("Our platform runs on Python and Django.") == {}
