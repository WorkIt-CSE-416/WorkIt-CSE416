"""Tests for scoring, highlights and what they read from a bank — pure functions, no DB."""

import datetime
from datetime import date

import pytest

from app.models.bank import Bank_Entry
from app.models.dto import Experience, bank_section, entry_end_kind
from app.services.bank import Bank, Entry
from app.services.matching.bank_input import expected_graduation, years_of_experience
from app.services.matching.highlights import generate_highlights
from app.services.matching.scoring import (
    compute_breakdown,
    compute_score,
    eligibility,
    experience_years,
    freshness,
    title_fit,
)

# --- compute_score ---


@pytest.mark.parametrize("semantic", [0.8, None, -0.2])
@pytest.mark.parametrize("fresh", [0.7, 1.0, 2.0])
def test_breakdown_reconciles_with_score(semantic, fresh):
    result = compute_breakdown(semantic, 0.6, 0.4, 1.0, fresh)
    parts = [result.semantic, result.skill_overlap, result.title_fit, result.eligibility]
    assert sum(p.weight for p in parts) == pytest.approx(1)
    assert sum(p.points for p in parts) == pytest.approx(result.weighted_score)
    assert result.score_before_rounding == pytest.approx(result.weighted_score * fresh)
    expected = (0.45 * semantic + 0.25 * 0.6 + 0.15 * 0.4 + 0.15) if semantic is not None else (
        (0.25 * 0.6 + 0.15 * 0.4 + 0.15) / 0.55
    )
    assert result.final_score == max(0, min(100, round(expected * fresh * 100)))
    assert result.final_score == compute_score(semantic, 0.6, 0.4, 1.0, fresh)
    if semantic is None:
        assert result.semantic.value is None
        assert result.semantic.weight == result.semantic.points == 0

def test_perfect_score():
    score = compute_score(
        semantic=1.0, skill_overlap=1.0, title_fit=1.0,
        eligibility=1.0, freshness=1.0,
    )
    assert score == 100


def test_zero_score():
    score = compute_score(
        semantic=0.0, skill_overlap=0.0, title_fit=0.0,
        eligibility=0.0, freshness=1.0,
    )
    assert score == 0


def test_no_embedding_redistributes():
    """When semantic is None the other weights fill in."""
    with_emb = compute_score(0.5, 0.5, 0.5, 0.5, 1.0)
    without_emb = compute_score(None, 0.5, 0.5, 0.5, 1.0)
    # Both should be reasonable mid-range scores
    assert 30 <= with_emb <= 70
    assert 30 <= without_emb <= 70


def test_freshness_boost():
    old = compute_score(0.5, 0.5, 0.5, 1.0, freshness(200))
    new = compute_score(0.5, 0.5, 0.5, 1.0, freshness(0))
    assert new > old


def test_score_clamped():
    assert compute_score(1.0, 1.0, 1.0, 1.0, 2.0) == 100
    assert compute_score(0.0, 0.0, 0.0, 0.0, 0.0) == 0


# --- freshness ---

def test_freshness_today():
    assert freshness(0) == 1.0


def test_freshness_floor():
    assert freshness(1000) == 0.7


def test_freshness_midpoint():
    f = freshness(60)
    assert 0.7 < f < 1.0


@pytest.mark.parametrize(("age", "expected"), [(-30, 1), (90, .91), (150, .85), (300, .7)])
def test_freshness_decay(age, expected):
    assert freshness(age) == pytest.approx(expected)


def test_experience_merges_overlaps_and_counts_ongoing_roles():
    today = date(2026, 1, 1)
    roles = [
        Experience(company_name="A", title="Engineer", start_date=date(2023, 1, 1), end_date=date(2025, 1, 1)),
        Experience(company_name="B", title="Engineer", start_date=date(2024, 1, 1)),
        Experience(company_name="C", title="Engineer", start_date=date(2024, 2, 1), end_date=date(2024, 3, 1)),
    ]
    assert experience_years(roles, today=today) == pytest.approx((today - date(2023, 1, 1)).days / 365.25)


def test_experience_ignores_invalid_dates_caps_future_and_preserves_gaps():
    today = date(2026, 1, 1)
    periods = [(None, None), (date(2027, 1, 1), None),
               (date(2025, 1, 1), date(2024, 1, 1)),
               (date(2025, 7, 1), date(2028, 1, 1)),
               (date(2023, 1, 1), date(2024, 1, 1))]
    roles = [Experience(company_name="A", title="Engineer", start_date=start, end_date=end)
             for start, end in periods]
    expected_days = (today - date(2025, 7, 1)).days + 365
    assert experience_years(roles, today=today) == pytest.approx(expected_days / 365.25)


def test_relevant_older_role_outranks_fresh_unrelated_role():
    relevant = compute_score(.8, .75, .8, 1, freshness(150))
    unrelated = compute_score(.3, 0, 0, 1, freshness(0))
    assert relevant > unrelated


def test_experience_mismatch_stays_visible_and_skills_are_evidenced():
    highlights = generate_highlights("Engineer", 5, None, ["Java", "Python"], None,
                                     .9, .5, .8, 0, matched_skills=["Python"])
    assert len(highlights) == 3
    assert any("Python" in h["text"] for h in highlights)
    assert not any("Java" in h["text"] for h in highlights)
    assert any(not h["met"] and "5+ years" in h["text"] for h in highlights)


# --- title_fit ---

def test_title_overlap():
    fit = title_fit(
        "Software Engineer",
        ["Software Developer", "Backend Engineer"],
        "Computer Science",
    )
    assert fit > 0  # "software" and "engineer" overlap


def test_title_no_overlap():
    fit = title_fit("Chef de Cuisine", ["Software Engineer"], None)
    assert fit == 0.0


def test_title_empty():
    assert title_fit("", [], None) == 0.0


# --- eligibility ---

def test_eligible_unknown():
    assert eligibility(None, None, None, 0) == 1.0


def test_hard_mismatch_years():
    assert eligibility(None, None, 5, 1.0) == 0.0


def test_soft_mismatch_years():
    e = eligibility(None, None, 4, 3.0)
    assert e == 0.5


def test_meets_years():
    assert eligibility(None, None, 2, 3.0) == 1.0


# --- highlights ---

def test_highlights_max_three():
    hl = generate_highlights(
        "Software Engineer", None, None, ["Python", "SQL", "Go"], "CS",
        semantic=0.9, skill_overlap=0.5, title_fit=0.5, eligibility=1.0,
    )
    assert len(hl) <= 3


def test_highlights_positive_before_negative():
    hl = generate_highlights(
        "Senior Engineer", 5, "Summer 2027", ["Python"], None,
        semantic=0.7, skill_overlap=0.5, title_fit=0.1, eligibility=0.5,
    )
    # First highlight should be positive (met=True)
    if hl:
        positives = [h for h in hl if h["met"]]
        negatives = [h for h in hl if not h["met"]]
        # all positives before negatives
        pos_indices = [hl.index(h) for h in positives]
        neg_indices = [hl.index(h) for h in negatives]
        if pos_indices and neg_indices:
            assert max(pos_indices) < min(neg_indices)


def test_highlights_empty_bank():
    hl = generate_highlights(
        "Analyst", None, None, [], None,
        semantic=None, skill_overlap=0.0, title_fit=0.0, eligibility=1.0,
    )
    assert isinstance(hl, list)
    assert len(hl) <= 3


# --- what the recommender reads from a bank ---

TODAY = datetime.date(2026, 10, 13)


def _bank(*rows: dict) -> Bank:
    return Bank(entries=[Entry(Bank_Entry(title="x", **row), []) for row in rows], skills=[])


def _month(text: str) -> datetime.date:
    return datetime.date.fromisoformat(text + "-01")


def test_the_expected_graduation_is_the_latest_education_end():
    bank = _bank(
        {"section": bank_section.education, "end_month": _month("2022-05"), "end_kind": entry_end_kind.month},
        {"section": bank_section.education, "end_month": _month("2027-05"), "end_kind": entry_end_kind.expected},
        # A later end outside Education does not count.
        {"section": bank_section.experience, "end_month": _month("2028-01"), "end_kind": entry_end_kind.expected},
    )
    assert expected_graduation(bank) == _month("2027-05")


def test_no_education_end_means_no_graduation_date():
    assert expected_graduation(_bank({"section": bank_section.education})) is None


def test_an_ongoing_experience_counts_up_to_this_month():
    bank = _bank(
        {"section": bank_section.experience, "start_month": _month("2025-11"), "end_kind": entry_end_kind.present},
    )
    assert years_of_experience(bank, TODAY) == 1.0


def test_years_count_experience_entries_only_and_both_end_months():
    bank = _bank(
        {"section": bank_section.experience, "start_month": _month("2025-06"),
         "end_month": _month("2025-08"), "end_kind": entry_end_kind.month},
        {"section": bank_section.leadership, "start_month": _month("2020-01"),
         "end_month": _month("2024-12"), "end_kind": entry_end_kind.month},
        # No start month: nothing to count from.
        {"section": bank_section.experience, "end_month": _month("2024-12"), "end_kind": entry_end_kind.month},
    )
    assert years_of_experience(bank, TODAY) == 0.25
