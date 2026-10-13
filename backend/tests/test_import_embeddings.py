"""Embedding batches use bounded reads and atomic bulk writes, without a database."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest
from sqlalchemy.dialects.postgresql import dialect

from app.scripts import import_jobs


def row(number):
    return SimpleNamespace(id=UUID(int=number), title=f"Job {number}", description="Build things")


class Connection:
    def __init__(self, batches, *, fail_write=False):
        self.batches = iter(batches)
        self.reads = []
        self.writes = []
        self.committed = []
        self.rolled_back = 0
        self.active = False
        self.pending = []
        self.fail_write = fail_write

    @asynccontextmanager
    async def begin(self):
        assert not self.active
        self.active = True
        self.pending = []
        try:
            yield
        except BaseException:
            self.rolled_back += 1
            raise
        else:
            self.committed.extend(self.pending)
        finally:
            self.active = False

    async def execute(self, statement):
        assert self.active
        compiled = statement.compile(dialect=dialect())
        if statement.is_select:
            self.reads.append(compiled)
            self.batch = next(self.batches)
            return Mock(all=Mock(return_value=self.batch))
        self.writes.append(compiled)
        if self.fail_write:
            raise RuntimeError("database write failed")
        self.pending = [r.id for r in self.batch]
        return Mock(all=Mock(return_value=[(r.id,) for r in self.batch]))


def test_embeds_all_batches_with_bounded_reads_and_bulk_updates(monkeypatch):
    monkeypatch.setattr(import_jobs, "BATCH_SIZE", 2)
    vectors = [[[0.1] * 768, [0.2] * 768], [[0.3] * 768]]
    embed = AsyncMock(side_effect=vectors)
    monkeypatch.setattr(import_jobs, "embed", embed)
    conn = Connection([[row(1), row(2)], [row(3)], []])

    assert asyncio.run(import_jobs._embed_jobs(conn)) == 3
    assert conn.committed == [UUID(int=n) for n in (1, 2, 3)]
    assert len(conn.reads) == 3
    assert len(conn.writes) == 2
    for query in conn.reads:
        sql = str(query)
        assert "LIMIT" in sql and "OFFSET" not in sql
        assert 2 in query.params.values()
        assert "company_id IS NULL" in sql
        assert "embedding IS NULL" in sql
    for query, expected_vectors in zip(conn.writes, vectors, strict=True):
        sql = str(query)
        assert "FROM (VALUES" in sql and "RETURNING job_postings.id" in sql
        assert "embedded.embedding::extensions.vector" in sql
        assert [v for v in query.params.values() if isinstance(v, list)] == expected_vectors
    assert embed.await_args_list[0].args == (["Job 1\n\nBuild things", "Job 2\n\nBuild things"],)
    assert not conn.active


@pytest.mark.parametrize("first_success", [False, True])
def test_provider_failure_preserves_committed_batches(monkeypatch, first_success):
    batches = [[row(1)], [row(2)]] if first_success else [[row(1)]]
    responses = [[[0.1] * 768], None] if first_success else [None]
    monkeypatch.setattr(import_jobs, "embed", AsyncMock(side_effect=responses))
    conn = Connection(batches)

    assert asyncio.run(import_jobs._embed_jobs(conn)) == int(first_success)
    assert conn.committed == ([UUID(int=1)] if first_success else [])
    assert len(conn.writes) == int(first_success)
    assert not conn.active


@pytest.mark.parametrize("vectors", [[], [[0.1] * 768] * 2])
def test_mismatched_vector_count_writes_nothing(monkeypatch, vectors, caplog):
    monkeypatch.setattr(import_jobs, "embed", AsyncMock(return_value=vectors))
    conn = Connection([[row(1)]])

    assert asyncio.run(import_jobs._embed_jobs(conn)) == 0
    assert not conn.writes
    assert "vectors for 1 texts" in caplog.text
    assert not conn.active


def test_empty_table_never_calls_provider(monkeypatch):
    embed = AsyncMock()
    monkeypatch.setattr(import_jobs, "embed", embed)
    conn = Connection([[]])
    assert asyncio.run(import_jobs._embed_jobs(conn)) == 0
    embed.assert_not_awaited()
    assert not conn.writes
    assert not conn.active


def test_write_failure_rolls_back_batch(monkeypatch):
    monkeypatch.setattr(import_jobs, "embed", AsyncMock(return_value=[[0.1] * 768]))
    conn = Connection([[row(1)]], fail_write=True)
    with pytest.raises(RuntimeError, match="database write failed"):
        asyncio.run(import_jobs._embed_jobs(conn))
    assert conn.rolled_back == 1
    assert not conn.committed
    assert not conn.active


@pytest.mark.parametrize(("limit", "sizes"), [(1, [1]), (2, [2]), (3, [2, 1])])
def test_embedding_limit_caps_provider_calls_and_queries(monkeypatch, limit, sizes):
    monkeypatch.setattr(import_jobs, "BATCH_SIZE", 2)
    embed = AsyncMock(side_effect=[[[0.1] * 768] * size for size in sizes])
    monkeypatch.setattr(import_jobs, "embed", embed)
    conn = Connection([[row(n + 1) for n in range(size)] for size in sizes])

    assert asyncio.run(import_jobs._embed_jobs(conn, limit=limit)) == limit
    assert [len(call.args[0]) for call in embed.await_args_list] == sizes
    assert [list(query.params.values())[-1] for query in conn.reads] == sizes
    assert len(conn.writes) == len(sizes)


@pytest.mark.parametrize("limit", ["0", "-1", "invalid"])
def test_cli_rejects_invalid_embedding_limit(limit):
    with pytest.raises(SystemExit) as exc:
        import_jobs.main(["--embed-limit", limit])
    assert exc.value.code == 2


def test_cli_passes_embedding_limit(monkeypatch, tmp_path):
    run = AsyncMock(return_value=import_jobs.Report())
    monkeypatch.setattr(import_jobs, "_run", run)
    feed = tmp_path / "feed.json"
    assert import_jobs.main([str(feed), "--embed-limit", "100"]) == 0
    run.assert_awaited_once_with(feed, dry_run=False, allow_mass_close=False, embed_limit=100)
