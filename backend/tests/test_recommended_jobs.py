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
        row = SimpleNamespace(**vars(ROW), semantic=0.8, skill_rank=0.5, _posted_at=ROW.posted_at)
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
