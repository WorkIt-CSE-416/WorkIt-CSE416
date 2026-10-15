"""Exercise the recommendation query through pgvector's real bind processor."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from pgvector.sqlalchemy import VECTOR
from sqlalchemy.dialects.postgresql.asyncpg import dialect

from app.deps import AccountType
from app.routers import jobs
from app.services.matching import embeddings
from tests.test_jobs import ROW


@pytest.mark.parametrize("skills", [["Python", "SQL", "python", "  "], []])
def test_skill_coverage_is_partial_and_independent_of_other_results(skills):
    applicant_id = uuid4()
    resume = SimpleNamespace(parsed_json={"skills": [{"skill_name": s} for s in skills]},
                             embedding=[.125] * 768)
    from datetime import UTC, datetime
    posted = datetime.now(UTC)
    target = SimpleNamespace(**vars(ROW), semantic=.8,
                             matched_skills=["python", None] if skills else None, _posted_at=posted)
    other = SimpleNamespace(**{**vars(target), "id": uuid4(), "matched_skills": ["python", "SQL"] if skills else None})
    queries = []

    async def run(rows):
        calls = 0

        async def execute(query):
            nonlocal calls
            calls += 1
            if calls == 1:
                return Mock(scalar_one_or_none=Mock(return_value=resume))
            queries.append(query.compile(dialect=dialect()))
            return Mock(all=Mock(return_value=rows))

        db = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(default_resume_id=uuid4())), execute=execute)
        return await jobs.recommended_jobs(applicant_id, limit=20, offset=0, filters=jobs.JobFilters(),
            account=SimpleNamespace(id=applicant_id, account_type=AccountType.APPLICANT), db=db)

    alone = asyncio.run(run([target]))[0]
    together = asyncio.run(run([target, other]))
    same = next(job for job in together if job.id == str(ROW.id))
    assert alone.score_breakdown.skill_overlap == same.score_breakdown.skill_overlap
    assert alone.score_breakdown.skill_overlap.value == (.5 if skills else 0)
    assert alone.match == same.match
    if skills:
        sql = str(queries[0])
        assert sql.count("plainto_tsquery") == 2
        assert sql.count("@@") == 2
        assert "ts_rank" not in sql
        assert together[0].id == str(other.id)


@pytest.mark.parametrize("stored", [True, False])
def test_recommendation_vector_can_be_bound(monkeypatch, stored):
    applicant_id = uuid4()
    vector = [0.125] * 768
    resume = SimpleNamespace(
        parsed_json={"skills": [{"skill_name": "Python"}]},
        embedding=vector if stored else None,
    )
    embed = AsyncMock(return_value=[vector])
    monkeypatch.setattr(embeddings, "embed", embed)
    bound_vectors = []

    async def execute(query):
        if not bound_vectors and " AS semantic" not in str(query):
            return Mock(scalar_one_or_none=Mock(return_value=resume))
        compiled = query.compile(dialect=dialect())
        for name, value in compiled.params.items():
            bind = compiled.binds[name]
            if isinstance(bind.type, VECTOR):
                processor = bind.type.bind_processor(dialect())
                bound_vectors.append(processor(value))
        row = SimpleNamespace(**vars(ROW), semantic=0.8, matched_skills=["Python"], _posted_at=ROW.posted_at)
        return Mock(all=Mock(return_value=[row]))

    db = SimpleNamespace(
        get=AsyncMock(return_value=SimpleNamespace(default_resume_id=uuid4())),
        execute=execute,
        commit=AsyncMock(),
    )
    result = asyncio.run(jobs.recommended_jobs(
        applicant_id, limit=20, offset=0, filters=jobs.JobFilters(),
        account=SimpleNamespace(id=applicant_id, account_type=AccountType.APPLICANT),
        db=db,
    ))
    assert len(result) == 1
    payload = result[0].model_dump(mode="json")
    breakdown = payload["score_breakdown"]
    assert payload["match"] == breakdown["final_score"]
    assert breakdown["semantic"]["value"] == 0.8
    assert breakdown["semantic"]["points"] == pytest.approx(36)
    assert len(bound_vectors) == 1
    assert len(bound_vectors[0].strip("[]").split(",")) == 768
    if stored:
        embed.assert_not_awaited()
        db.commit.assert_not_awaited()
    else:
        embed.assert_awaited_once()
        db.commit.assert_awaited_once()
