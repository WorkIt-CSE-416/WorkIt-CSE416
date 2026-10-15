"""
GET /jobs/recommended's scoring: the feed's jobs, narrowed by the same
filters, scored against one resume and sorted best first. The scores
themselves are services/matching's (its CLAUDE.md); this reads the columns
they need and embeds the resume on demand.
"""

import datetime

from sqlalchemy import case, func, literal, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dto import ParsedResume
from app.models.jobs import Job_Post
from app.models.resume import Resume
from app.queries.jobs.filters import LISTED, JobFilters, matching
from app.queries.jobs.listings import LISTING_COLUMNS, to_listing
from app.schemas.jobs import Highlight, ScoredJob
from app.services.matching.highlights import generate_highlights
from app.services.matching.scoring import (
    compute_breakdown,
    eligibility,
    experience_years,
    freshness,
    title_fit,
)


async def score_jobs(
    db: AsyncSession, resume_row: Resume, parsed: ParsedResume, filters: JobFilters
) -> list[ScoredJob]:
    '''
    every job these filters keep, scored against this resume, best first.
    Jobs without embeddings still appear, scored on the other components
    '''
    # Embed resume on demand if missing
    resume_embedding = resume_row.embedding
    if resume_embedding is None:
        from app.services.matching.embeddings import embed, resume_text
        text = resume_text(parsed)
        if text:
            vectors = await embed([text])
            if vectors:
                resume_row.embedding = vectors[0]
                resume_embedding = vectors[0]
                try:
                    await db.commit()
                except Exception:
                    await db.rollback()

    # Deduplicate case-insensitively so repeated skills cannot change the score.
    skills = list({s.skill_name.strip().casefold(): s.skill_name.strip()
                   for s in parsed.skills if s.skill_name.strip()}.values())

    # Query with scoring columns
    score_columns = list(LISTING_COLUMNS)

    # Semantic similarity: 1 - cosine_distance
    if resume_embedding is not None:
        semantic_col = (
            literal(1.0) - Job_Post.embedding.cosine_distance(resume_embedding)
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
    resume_titles = [e.title for e in parsed.experience]
    field_of_study = next(
        (e.field_of_study for e in parsed.education if e.field_of_study), None
    )
    years_exp = experience_years(parsed.experience, today=now.date())

    scored: list[ScoredJob] = []
    for row in rows:
        semantic_val = row.semantic
        matched_skills = [skill for skill in (row.matched_skills or []) if skill is not None]
        skill_norm = len(matched_skills) / len(skills) if skills else 0.0
        t_fit = title_fit(row.title, resume_titles, field_of_study)
        days_old = (now - row._posted_at).total_seconds() / 86400 if row._posted_at else 30.0
        fresh = freshness(days_old)
        elig = eligibility(
            None, row.start_term, row.min_years_experience, years_exp
        )
        breakdown = compute_breakdown(semantic_val, skill_norm, t_fit, elig, fresh)
        highlights = generate_highlights(
            row.title, row.min_years_experience, row.start_term,
            parsed, semantic_val, skill_norm, t_fit, elig,
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
