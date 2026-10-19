"""Posting requirements are public facts, never profile comparisons."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.routers import jobs
from app.services.requirements import extract

WINDOW = "Must graduate between December 2026 and June 2027."


def test_advanced_degree_and_alternative_graduation_dates():
    text = """What We’re Looking For
Pursuing an advanced degree in Computer Science, Artificial Intelligence, Machine Learning, or a related field, Graduating in December 2027 or May/June 2028
Previous internship experience in AI, machine learning, or related fields, with a strong interest in building and deploying AI projects.
Have hands-on experience building and deploying generative AI and agentic AI applications into production.
Demonstrate practical experience with key components of agentic architectures, including orchestration, evaluation, retrieval-augmented generation (RAG), and safety guardrails.
Proficient in Python and modern backend frameworks (FastAPI, Django preferred).
Experience creating human and automated evals to ensure high AI model quality.
Able to thrive in a fast-moving, startup-like environment."""
    items = extract(text)
    degree, = [item for item in items if item.kind == "degree"]
    assert degree.summary == "Advanced degree in CS, AI, machine learning or related field (in progress)"
    graduation, = [item for item in items if item.kind == "graduation_window"]
    assert graduation.summary == "Graduate in December 2027 or May/June 2028"
    assert graduation.earliest_month is None
    assert graduation.latest_month is None
    assert {item.summary for item in items if item.kind == "skills"} == {
        "Generative AI", "Agentic AI", "RAG", "Python", "FastAPI", "Django",
        "Orchestration", "Safety guardrails", "AI model evaluation",
    }


@pytest.mark.parametrize("heading", ["What We're Looking For:", "What We’re Looking For", "Qualifications"])
def test_qualification_heading_variants_and_section_boundary(heading):
    items = extract(f"{heading}\nPython experience\nResponsibilities\nDeploy using Kubernetes")
    assert [item.summary for item in items] == ["Python"]


@pytest.mark.parametrize("text", [
    "Not graduating in December 2027 or May/June 2028.",
    "Graduating in December 2027 or equivalent experience.",
    "Our internship runs in December 2027 or May/June 2028.",
])
def test_alternative_dates_do_not_drop_negation_or_non_date_alternatives(text):
    assert not any(item.summary for item in extract(text) if item.kind == "graduation_window")


@pytest.fixture
def client(monkeypatch):
    listed = AsyncMock(return_value=SimpleNamespace(description=WINDOW))
    bank = AsyncMock(side_effect=AssertionError("Posting requirements must not load a profile"))
    monkeypatch.setattr(jobs.postings, "listed", listed)
    monkeypatch.setattr(jobs, "load_bank", bank)
    app.dependency_overrides[get_session] = lambda: None
    try:
        with TestClient(app) as http:
            yield http, listed, bank
    finally:
        app.dependency_overrides.pop(get_session, None)


@pytest.mark.parametrize("description", [
    "Graduating students must be available between June 2027 and August 2027.",
    "Our graduate internship runs between December 2026 and June 2027.",
])
def test_availability_and_program_dates_are_not_graduation_windows(description):
    assert extract(description) == []


@pytest.mark.parametrize("prefix", [
    "Must graduate", "Students graduating", "Graduation",
    "Expected graduation date", "Graduation date must be", "Graduation date is",
])
def test_explicit_graduation_date_grammar(prefix):
    description = f"{prefix} between December 2026 and June 2027."
    requirement, = extract(description)
    assert requirement.earliest_month == date(2026, 12, 1)
    assert requirement.latest_month == date(2027, 6, 1)
    assert requirement.evidence == description


def test_heading_context_and_full_degree_evidence_survive():
    text = "Preferred Qualifications\nPh.D. in physics.\nRequirements\nBachelor's degree."
    requirements = extract(text)
    assert [(r.evidence, r.importance) for r in requirements] == [
        ("Ph.D. in physics.", "preferred"),
        ("Bachelor's degree.", "required"),
    ]
    assert all(r.evidence in text for r in requirements)


def test_repeated_window_is_deduplicated():
    assert len(extract(WINDOW + "\n" + WINDOW)) == 1


def test_computing_degrees_and_seasonal_graduation_deadline():
    degree = (
        "Pursuing a BS or MS in Computer Science, Computer Engineering, "
        "Information Systems, or a related field"
    )
    graduation = "Expected to graduate by Summer 2028"
    items = extract(f"Requirements\n{degree}\n{graduation}")
    assert [(item.kind, item.evidence) for item in items] == [
        ("degree", degree), ("graduation_window", graduation)
    ]
    assert all(item.importance == "required" for item in items)
    assert items[1].earliest_month is None
    assert items[1].latest_month is None
    assert items[0].summary == "BS/MS in CS, computer engineering, information systems or related field (in progress)"
    assert items[1].summary == "Graduate by Summer 2028"


@pytest.mark.parametrize("statement", [
    "B.S. or M.S. in Computer Science required.",
    "BS/MS in Engineering.",
    "Pursuing a BSc in Mathematics.",
    "MSc degree preferred.",
])
def test_degree_abbreviations_with_academic_context(statement):
    assert any(item.kind == "degree" for item in extract(statement))


@pytest.mark.parametrize("statement", [
    "Experience using MS Office.",
    "Graduating students must be available by Summer 2028.",
    "Our graduate internship starts in Summer 2028.",
])
def test_abbreviations_and_program_dates_do_not_invent_academic_requirements(statement):
    assert extract(statement) == []


@pytest.mark.parametrize("statement", [
    "Expected to graduate by Summer 2028",
    "Must graduate before June 2028.",
    "Graduating in 2028.",
    "Expected graduation date is in May 2028.",
])
def test_graduation_deadlines_and_single_dates_preserve_the_statement(statement):
    item, = extract(statement)
    assert item.kind == "graduation_window"
    assert item.evidence == statement


def test_requirements_are_public_and_do_not_load_personal_data(client):
    http, listed, bank = client
    job_id = uuid4()
    response = http.get(f"/jobs/{job_id}/requirements")
    assert response.status_code == 200
    assert response.json()[0]["evidence"] == WINDOW
    assert "status" not in response.json()[0]
    listed.assert_awaited_once_with(None, job_id)
    bank.assert_not_awaited()


def test_requirements_do_not_expose_unlisted_postings(client):
    http, listed, bank = client
    listed.return_value = None
    assert http.get(f"/jobs/{uuid4()}/requirements").status_code == 404
    bank.assert_not_awaited()


def test_requirements_empty_description_returns_no_invented_facts(client):
    http, listed, bank = client
    listed.return_value = SimpleNamespace(description=None)
    response = http.get(f"/jobs/{uuid4()}/requirements")
    assert response.status_code == 200
    assert response.json() == []
    bank.assert_not_awaited()


@pytest.mark.parametrize("statement", [
    "Due to contract requirements, U.S. Citizenship is required",
    "Applicants must be United States citizens.",
    "US citizenship required.",
    "Due to contractual requirements, only U.S. citizens will be considered for this position.",
])
def test_explicit_us_citizenship_has_concise_summary(statement):
    items = extract("Minimum Qualifications\n" + statement)
    citizenship = next(item for item in items if item.kind == "citizenship")
    assert citizenship.summary == "U.S. Citizenship Required"
    assert citizenship.evidence == statement


@pytest.mark.parametrize("statement", [
    "U.S. citizenship is not required.",
    "Must be a U.S. citizen or permanent resident.",
    "U.S. citizenship is required only if assigned to a government project.",
    "U.S. citizenship is required for certain projects.",
    "U.S. citizenship is preferred.",
    "Canadian citizenship is required.",
])
def test_citizenship_alternatives_and_qualifiers_are_not_overstated(statement):
    item = next(item for item in extract(statement) if item.kind == "citizenship")
    assert item.summary is None
    assert item.evidence == statement


@pytest.mark.parametrize("statement,kind", [
    ("Must be authorised to work in the UK.", "sponsorship"),
    ("Legal authorization to work in the U.S. is required.", "sponsorship"),
    ("Must have the right to work in the UK.", "sponsorship"),
    ("Must be a lawful permanent resident or green card holder.", "sponsorship"),
    ("Must be a U.S. person.", "sponsorship"),
    ("Active US Security clearance is required.", "clearance"),
    ("Must have a TS/SCI level clearance.", "clearance"),
    ("Ability to obtain a Top-Secret clearance is required.", "clearance"),
])
def test_related_work_authorization_and_clearance_statements_are_kept(statement, kind):
    items = extract(statement)
    assert any(item.kind == kind and item.evidence == statement for item in items)
    assert all(item.summary != "U.S. Citizenship Required" for item in items)


def test_key_skills_are_short_highlights_not_copies_of_requirements():
    description = (
        "Requirements\n"
        "Hands-on experience using AI tools (e.g. LLM APIs, assistants, or coding agents) in real projects.\n"
        "Experience with RAG including production-minded prototyping, not only public tutorials.\n"
        "Python for prototyping and integration; comfortable consuming and creating APIs and working with JSON.\n"
        "Git workflow: branches, merge requests, meaningful commit messages."
    )
    items = [item for item in extract(description) if item.kind == "skills"]
    assert {item.summary for item in items} == {"AI tools", "APIs", "RAG", "Python", "Git"}
    assert all(item.evidence in description for item in items)
    assert all(len(item.summary) < len(item.evidence) for item in items)


def test_skills_do_not_invent_related_languages_or_read_company_pitch():
    items = extract("About the Company\nWe use Python.\nRequirements\nJavaScript experience required.")
    assert [item.summary for item in items if item.kind == "skills"] == ["JavaScript"]


def test_optional_skill_context_survives_summary():
    item, = extract("Preferred Qualifications\nExperience with Python.")
    assert item.summary == "Python"
    assert item.importance == "preferred"


def test_equal_opportunity_citizenship_is_not_a_requirement():
    assert extract("We consider applicants without regard to citizenship, race, or religion.") == []


@pytest.mark.parametrize("statement", [
    "Our values are Integrity, Citizenship, and Teamwork.",
    "Eligible to work out of our West Des Moines satellite office.",
    "We are an equal opportunity employer and do not discriminate based on U.S. citizenship.",
])
def test_values_locations_and_equal_opportunity_are_not_personal_requirements(statement):
    assert extract(statement) == []


def test_public_requirements_returns_citizenship_summary(client):
    http, listed, bank = client
    listed.return_value = SimpleNamespace(
        description="Minimum Qualifications\nDue to contract requirements, U.S. Citizenship is required"
    )
    response = http.get(f"/jobs/{uuid4()}/requirements")
    assert response.status_code == 200
    assert response.json()[0]["summary"] == "U.S. Citizenship Required"
    bank.assert_not_awaited()
