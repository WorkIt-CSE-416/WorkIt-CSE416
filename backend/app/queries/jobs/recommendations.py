"""
GET /jobs/recommended's scoring: the feed's jobs, narrowed by the same
filters, scored against one experience bank and sorted best first. The
scores themselves are services/matching's (its CLAUDE.md); this reads the
columns they need and embeds the bank on demand.
"""

import datetime

from sqlalchemy import case, func, literal, select, update
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.bank import Experience_Bank
from app.models.jobs import Job_Post
from app.queries.jobs.filters import LISTED, JobFilters, matching
from app.queries.jobs.listings import LISTING_COLUMNS, to_listing
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import Highlight, ScoredJob
from app.services.bank import Bank
from app.services.identity import load_identity
from app.services.matching import bank_input
from app.services.matching.bank_input import bank_text
from app.services.matching.embeddings import embed
from app.services.matching.highlights import generate_highlights
from app.services.matching.scoring import (
    compute_breakdown,
    eligibility,
    freshness,
    title_fit,
)


async def _bank_embedding(db: AsyncSession, account: AuthenticatedAccount, bank: Bank) -> list[float] | None:
    """The bank's stored embedding, made and stored here when it is null.
    None when there is no bank row or embedding fails."""
    bank_row = await db.get(
        Experience_Bank, account.id, options=[undefer(Experience_Bank.embedding)]
    )
    if bank_row is None or bank_row.embedding is not None:
        return bank_row.embedding if bank_row else None
    text = bank_text(bank, identity=await load_identity(db, account))
    vectors = await embed([text]) if text else None
    if not vectors:
        return None
    # Only if the bank is unchanged since it was read: a change in
    # between cleared the embedding, and this vector is already stale.
    await db.execute(
        update(Experience_Bank)
        .where(
            Experience_Bank.applicant_id == account.id,
            Experience_Bank.updated_at == bank_row.updated_at,
        )
        .values(embedding=vectors[0], embedded_at=func.now())
        .execution_options(synchronize_session=False)
    )
    try:
        await db.commit()
    except Exception:
        await db.rollback()
    return vectors[0]


async def score_jobs(
    db: AsyncSession, account: AuthenticatedAccount, bank: Bank, filters: JobFilters
) -> list[ScoredJob]:
    '''
    every job these filters keep, scored against this bank, best first.
    Jobs without embeddings still appear, scored on the other components
    '''
    bank_embedding = await _bank_embedding(db, account, bank)

    # Deduplicate case-insensitively so repeated skills cannot change the score.
    skills = list({s.strip().casefold(): s.strip()
                   for s in bank_input.skills(bank) if s.strip()}.values())

    # Query with scoring columns
    score_columns = list(LISTING_COLUMNS)

    # Semantic similarity: 1 - cosine_distance
    if bank_embedding is not None:
        semantic_col = (
            literal(1.0) - Job_Post.embedding.cosine_distance(bank_embedding)
        ).label("semantic")
    else:
        semantic_col = literal(None).label("semantic")
    score_columns.append(semantic_col)

    # Match skills independently, so partial coverage earns credit. This is
    # independent of other results and remains stable when filters change.
    if skills:
        skill_matches = array([
            case((Job_Post.fts.bool_op("@@")(
                func.plainto_tsquery("english", skill)
            ), literal(skill)), else_=None)
            for skill in skills
        ]).label("matched_skills")
    else:
        skill_matches = literal(None).label("matched_skills")
    score_columns.append(skill_matches)

    # posted_at for freshness
    score_columns.append(Job_Post.posted_at.label("_posted_at"))

    query = select(*score_columns).where(LISTED, *matching(filters))
    rows = (await db.execute(query)).all()

    now = datetime.datetime.now(datetime.UTC)
    titles = bank_input.titles(bank)
    field_of_study = bank_input.field_of_study(bank)
    years_exp = bank_input.years_of_experience(bank, now.date())
    graduation = bank_input.expected_graduation(bank)

    scored: list[ScoredJob] = []
    for row in rows:
        semantic_val = row.semantic
        matched_skills = [skill for skill in (row.matched_skills or []) if skill is not None]
        skill_norm = len(matched_skills) / len(skills) if skills else 0.0
        t_fit = title_fit(row.title, titles, field_of_study)
        days_old = (now - row._posted_at).total_seconds() / 86400 if row._posted_at else 30.0
        fresh = freshness(days_old)
        elig = eligibility(
            graduation, row.start_term, row.min_years_experience, years_exp
        )
        breakdown = compute_breakdown(semantic_val, skill_norm, t_fit, elig, fresh)
        highlights = generate_highlights(
            row.title, row.min_years_experience, row.start_term,
            skills, field_of_study, semantic_val, skill_norm, t_fit, elig,
            matched_skills=matched_skills,
        )

        listing = to_listing(row)
        scored.append(ScoredJob(
            **listing.model_dump(),
            match=breakdown.final_score,
            score_breakdown=breakdown,
            highlights=[Highlight(**h) for h in highlights],
        ))

    # Best first; ties broken by the unrounded score, then id, so pages are stable
    scored.sort(key=lambda s: (-s.match, -s.score_breakdown.score_before_rounding, s.id))
    return scored
