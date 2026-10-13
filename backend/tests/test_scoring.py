"""Tests for scoring, highlights and what they read from a bank — pure functions, no DB."""

import datetime

from app.models.bank import Bank_Entry
from app.models.dto import bank_section, entry_end_kind
from app.services.bank import Bank, Entry
from app.services.matching.bank_input import expected_graduation, years_of_experience
from app.services.matching.highlights import generate_highlights
from app.services.matching.scoring import (
    compute_score,
    eligibility,
    freshness,
    title_fit,
)

# --- compute_score ---

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
