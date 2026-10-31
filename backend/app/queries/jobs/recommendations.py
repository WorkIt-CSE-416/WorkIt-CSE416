"""
GET /jobs/recommended's scoring: the feed's jobs, narrowed by the same
filters, scored against one experience bank and sorted best first. The
scores themselves are services/matching's (its CLAUDE.md); this reads the
columns they need and embeds the bank on demand.
"""

import datetime
from collections.abc import Mapping

from sqlalchemy import and_, case, false, func, literal, or_, select, true, update
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer
from sqlalchemy.sql.elements import ColumnElement

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

# How many filtered jobs are scored per request. They are the nearest to the
# bank by embedding (or the newest, with no vector), picked in SQL, so the
# Python scoring below never runs over the whole feed.
# ponytail: a fixed cap; a job ranked past it by semantic alone can't surface
# on its skills or title. Raise it, or pre-score skills in SQL, if that bites.
CANDIDATES = 500

# The bank embed inside a request: short, so a missing or slow provider
# degrades to scoring without the semantic part instead of hanging the
# function (matching/CLAUDE.md).
REQUEST_EMBED_SECONDS = 10.0


async def _bank_embedding(db: AsyncSession, account: AuthenticatedAccount, bank: Bank) -> list[float] | None:
    """The bank's stored embedding, made and stored here when it is null.
    None when there is no bank row or embedding fails."""
    bank_row = await db.get(
        Experience_Bank, account.id, options=[undefer(Experience_Bank.embedding)]
    )
    if bank_row is None or bank_row.embedding is not None:
        return bank_row.embedding if bank_row else None
    text = bank_text(bank, identity=await load_identity(db, account))
    vectors = await embed([text], timeout=REQUEST_EMBED_SECONDS) if text else None
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
        # updated_at stays the bank's last change: storing its vector is no
        # change, and Home's kept result is keyed on it (queries/jobs/home.py).
        .values(embedding=vectors[0], embedded_at=func.now(), updated_at=bank_row.updated_at)
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
    return (await score_job_sets(db, account, bank, filters, {"all": None}))["all"]


async def score_job_sets(
    db: AsyncSession,
    account: AuthenticatedAccount,
    bank: Bank,
    filters: JobFilters,
    sets: Mapping[str, ColumnElement[bool] | None],
) -> dict[str, list[ScoredJob]]:
    '''
    the jobs these filters keep, scored against this bank, best first, once
    per named set: a set is the jobs its condition also keeps (None: all of
    them), each capped at CANDIDATES as score_jobs caps one. One scan of the
    vectors serves every set, and a job in two sets is scored once: Home
    asks for its three lists at once (fetch_home_matches).
    '''
    bank_embedding = await _bank_embedding(db, account, bank)

    # Deduplicate case-insensitively so repeated skills cannot change the score.
    skills = list({s.strip().casefold(): s.strip()
                   for s in bank_input.skills(bank) if s.strip()}.values())

    # Semantic similarity: 1 - cosine_distance
    if bank_embedding is not None:
        semantic = literal(1.0) - Job_Post.embedding.cosine_distance(bank_embedding)
    else:
        semantic = literal(None)

    # RANKED ON THE VECTOR ALONE, THEN READ IN FULL (KAN-425). The first
    # query reads the filtered jobs' id, vector and posting date and keeps
    # each set's CANDIDATES nearest; only those rows are read whole and
    # matched against the skills. Matching skills in the ranking query made
    # Postgres run every skill's text search on every listed job before the
    # cap: on 2026-10-28 that read each posting's text once per skill,
    # 438,713 buffers against 52,803 for the vector alone, and a pass took
    # 10 to 15 s instead of 4 to 6.
    near = (
        select(
            Job_Post.id,
            semantic.label("semantic"),
            Job_Post.posted_at,
            *(
                (true() if cond is None else func.coalesce(cond, false())).label(f"in_{name}")
                for name, cond in sets.items()
            ),
        )
        .where(LISTED, *matching(filters))
        .subquery("near")
    )
    # Each set's own rank, nearest first. NULLS LAST: Postgres sorts NULL
    # first under DESC, so a job the import couldn't embed would otherwise
    # crowd the real matches out of the cap. Newest next, so the jobs
    # without a vector that do make it are fresh; id breaks the last ties.
    newest = near.c.posted_at.desc().nulls_last()
    order = (
        (near.c.semantic.desc().nulls_last(), newest, near.c.id)
        if bank_embedding is not None
        else (newest, near.c.id)
    )
    ranked = select(
        near.c.id,
        near.c.semantic,
        *(
            and_(
                near.c[f"in_{name}"],
                func.row_number().over(partition_by=near.c[f"in_{name}"], order_by=order)
                <= CANDIDATES,
            ).label(f"in_{name}")
            for name in sets
        ),
    ).subquery("ranked")
    in_sets = [ranked.c[f"in_{name}"] for name in sets]

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

    query = (
        select(
            *LISTING_COLUMNS,
            ranked.c.semantic,
            skill_matches,
            # posted_at for freshness
            Job_Post.posted_at.label("_posted_at"),
            *in_sets,
        )
        .join(ranked, ranked.c.id == Job_Post.id)
        .where(or_(*in_sets))
    )
    rows = (await db.execute(query)).all()

    now = datetime.datetime.now(datetime.UTC)
    titles = bank_input.titles(bank)
    field_of_study = bank_input.field_of_study(bank)
    years_exp = bank_input.years_of_experience(bank, now.date())
    graduation = bank_input.expected_graduation(bank)

    scored: dict[str, list[ScoredJob]] = {name: [] for name in sets}
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
            has_titles=bool(titles or field_of_study),
        )

        listing = to_listing(row)
        job = ScoredJob(
            **listing.model_dump(exclude={"match", "highlights"}),
            match=breakdown.final_score,
            score_breakdown=breakdown,
            highlights=[Highlight(**h) for h in highlights],
        )
        for name in sets:
            if getattr(row, f"in_{name}"):
                scored[name].append(job)

    # Best first; ties broken by the unrounded score, then id, so pages are stable
    for jobs in scored.values():
        jobs.sort(key=lambda s: (-s.match, -s.score_breakdown.score_before_rounding, s.id))
    return scored
