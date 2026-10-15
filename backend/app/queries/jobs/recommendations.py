"""
GET /jobs/recommended's scoring: the feed's jobs, narrowed by the same
filters, scored against one resume and sorted best first. The scores
themselves are services/matching's (its CLAUDE.md); this reads the columns
they need and embeds the resume on demand.
"""

import datetime

from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dto import ParsedResume
from app.models.jobs import Job_Post
from app.models.resume import Resume
from app.queries.jobs.filters import LISTED, JobFilters, matching
from app.queries.jobs.listings import LISTING_COLUMNS, to_listing
from app.schemas.jobs import Highlight, ScoredJob
from app.services.matching.highlights import generate_highlights
from app.services.matching.scoring import (
    compute_score,
    eligibility,
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

    # Build skills text for FTS
    skills_text = " ".join(s.skill_name for s in parsed.skills) if parsed.skills else ""

    # Query with scoring columns
    score_columns = list(LISTING_COLUMNS)

    # Semantic similarity: 1 - cosine_distance
    if resume_embedding is not None:
        vec_literal = str(resume_embedding)
        semantic_col = (
            literal(1.0) - Job_Post.embedding.cosine_distance(vec_literal)
        ).label("semantic")
    else:
        semantic_col = literal(None).label("semantic")
    score_columns.append(semantic_col)

    # FTS skill rank
    if skills_text:
        skill_rank_col = func.ts_rank(
            Job_Post.fts, func.plainto_tsquery("english", skills_text)
        ).label("skill_rank")
    else:
        skill_rank_col = literal(0.0).label("skill_rank")
    score_columns.append(skill_rank_col)

    # posted_at for freshness
    score_columns.append(Job_Post.posted_at.label("_posted_at"))

    query = select(*score_columns).where(LISTED, *matching(filters))
    rows = (await db.execute(query)).all()

    now = datetime.datetime.now(datetime.UTC)
    resume_titles = [e.title for e in parsed.experience]
    field_of_study = next(
        (e.field_of_study for e in parsed.education if e.field_of_study), None
    )
    # Rough years of experience from resume
    years_exp = 0.0
    for exp in parsed.experience:
        if exp.start_date and exp.end_date:
            years_exp += (exp.end_date - exp.start_date).days / 365.25

    scored: list[ScoredJob] = []
    # ponytail: normalize skill_rank by max across result set
    max_skill_rank = max((r.skill_rank or 0 for r in rows), default=1.0) or 1.0

    for row in rows:
        semantic_val = row.semantic
        skill_norm = min(1.0, (row.skill_rank or 0) / max_skill_rank) if max_skill_rank > 0 else 0.0
        t_fit = title_fit(row.title, resume_titles, field_of_study)
        days_old = (now - row._posted_at).total_seconds() / 86400 if row._posted_at else 30.0
        fresh = freshness(days_old)
        elig = eligibility(
            None, row.start_term, row.min_years_experience, years_exp
        )
        score = compute_score(semantic_val, skill_norm, t_fit, elig, fresh)
        highlights = generate_highlights(
            row.title, row.min_years_experience, row.start_term,
            parsed, semantic_val, skill_norm, t_fit, elig,
        )

        listing = to_listing(row)
        scored.append(ScoredJob(
            **listing.model_dump(),
            match=score,
            highlights=[Highlight(**h) for h in highlights],
        ))

    # Sort by score descending, then apply offset/limit
    scored.sort(key=lambda s: s.match, reverse=True)
    return scored
