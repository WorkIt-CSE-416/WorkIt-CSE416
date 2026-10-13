"""Tests for scoring and highlights — pure functions, no DB."""

from app.models.dto import Education, ParsedResume, Skill
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

def _resume(**kw) -> ParsedResume:
    return ParsedResume(
        skills=kw.get("skills", []),
        experience=kw.get("experience", []),
        education=kw.get("education", []),
    )


def test_highlights_max_three():
    resume = _resume(
        skills=[Skill(skill_name="Python"), Skill(skill_name="SQL"), Skill(skill_name="Go")],
        education=[Education(institution="MIT", field_of_study="CS")],
    )
    hl = generate_highlights(
        "Software Engineer", None, None, resume,
        semantic=0.9, skill_overlap=0.5, title_fit=0.5, eligibility=1.0,
    )
    assert len(hl) <= 3


def test_highlights_positive_before_negative():
    resume = _resume(
        skills=[Skill(skill_name="Python")],
    )
    hl = generate_highlights(
        "Senior Engineer", 5, "Summer 2027", resume,
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


def test_highlights_empty_resume():
    resume = _resume()
    hl = generate_highlights(
        "Analyst", None, None, resume,
        semantic=None, skill_overlap=0.0, title_fit=0.0, eligibility=1.0,
    )
    assert isinstance(hl, list)
    assert len(hl) <= 3
