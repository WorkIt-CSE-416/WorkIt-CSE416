"""
DELETE /auth/me (KAN-326), with Supabase patched at
`app.routers.auth.get_supabase`: the files it lists and removes, and the
auth user it deletes, are in memory. The rows go by the auth user's
cascade, which the first test checks on real Postgres.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text
from supabase_auth.errors import AuthApiError

from app.deps import get_verified_identity
from app.main import app
from app.schemas.auth import AccountType, VerifiedIdentity

pytestmark = pytest.mark.anyio


class FakeBucket:
    def __init__(self, files: set[str]) -> None:
        self.files = files

    def list(self, folder, options):
        # Supabase lists a folder's own files, and each sub-folder as an
        # entry with no id, a page at a time.
        names = sorted({
            path.removeprefix(f"{folder}/").split("/")[0]
            for path in self.files
            if path.startswith(f"{folder}/")
        })
        entries = [
            {"name": name, "id": "file" if f"{folder}/{name}" in self.files else None}
            for name in names
        ]
        return entries[options["offset"] : options["offset"] + options["limit"]]

    def remove(self, paths):
        self.files -= set(paths)
        return []


class FakeSupabase:
    def __init__(self) -> None:
        self.buckets = {"Resume": FakeBucket(set()), "Avatar": FakeBucket(set())}
        self.deleted_users: list[str] = []
        self.delete_error: Exception | None = None
        self.storage = self
        self.auth = self
        self.admin = self

    def from_(self, bucket):
        return self.buckets[bucket]

    def delete_user(self, user_id):
        if self.delete_error:
            raise self.delete_error
        self.deleted_users.append(user_id)


@pytest.fixture
def supabase(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: fake)
    return fake


async def _seed(database, applicant_id: uuid.UUID) -> None:
    async with database() as s:
        await s.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
        await s.execute(
            text(
                "INSERT INTO applicant_profiles (id, email, full_name)"
                " VALUES (:id, 'sam@example.com', 'Sam Seeker')"
            ),
            {"id": applicant_id},
        )
        # Two sent resumes sharing one snapshot, whose foreign key is
        # RESTRICT: the cascade must still get through it.
        snapshot_id = uuid.uuid4()
        await s.execute(
            text(
                "INSERT INTO resume_snapshots (id, applicant_id, content_hash, source, data)"
                " VALUES (:id, :a, 'hash', 'built', '\\x00')"
            ),
            {"id": snapshot_id, "a": applicant_id},
        )
        for name in ("one", "two"):
            await s.execute(
                text(
                    "INSERT INTO sent_resumes (applicant_id, snapshot_id, name)"
                    " VALUES (:a, :snap, :name)"
                ),
                {"a": applicant_id, "snap": snapshot_id, "name": name},
            )
        await s.commit()


async def _delete(applicant_id: uuid.UUID, account_type=AccountType.APPLICANT) -> httpx.Response:
    app.dependency_overrides[get_verified_identity] = lambda: VerifiedIdentity(
        id=applicant_id, email="sam@example.com", account_type=account_type, full_name=None
    )
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.delete("/auth/me")
    finally:
        app.dependency_overrides.pop(get_verified_identity, None)


async def _count(database, table: str) -> int:
    async with database() as s:
        return await s.scalar(text(f"SELECT count(*) FROM {table}"))


async def test_delete_removes_the_files_and_the_auth_user(database, supabase):
    applicant_id = uuid.uuid4()
    other = uuid.uuid4()
    await _seed(database, applicant_id)
    supabase.buckets["Resume"].files |= {
        f"{applicant_id}/a.pdf",
        f"{applicant_id}/b.docx",
        f"{applicant_id}/sent/old.pdf",  # kept by a download before KAN-267
        f"{other}/c.pdf",
    }
    supabase.buckets["Avatar"].files |= {f"{applicant_id}/me.webp"}

    res = await _delete(applicant_id)

    assert res.status_code == 204
    assert supabase.buckets["Resume"].files == {f"{other}/c.pdf"}
    assert supabase.buckets["Avatar"].files == set()
    assert supabase.deleted_users == [str(applicant_id)]

    # What Supabase does with that call, which takes every row with it.
    async with database() as s:
        await s.execute(text("DELETE FROM auth.users WHERE id = :id"), {"id": applicant_id})
        await s.commit()
    for table in ("applicant_profiles", "sent_resumes", "resume_snapshots"):
        assert await _count(database, table) == 0, table


async def test_an_auth_user_already_gone_is_success(supabase):
    # A retry whose first try deleted the account but lost the answer.
    supabase.delete_error = AuthApiError("User not found", 404, "user_not_found")

    res = await _delete(uuid.uuid4())

    assert res.status_code == 204


async def test_an_auth_failure_is_a_502(supabase):
    supabase.delete_error = AuthApiError("boom", 500, "unexpected_failure")

    res = await _delete(uuid.uuid4())

    assert res.status_code == 502


async def test_a_storage_failure_keeps_the_account(supabase):
    def fail(*args):
        raise RuntimeError("storage down")

    supabase.buckets["Avatar"].list = fail

    res = await _delete(uuid.uuid4())

    assert res.status_code == 502
    assert supabase.deleted_users == []


async def test_a_company_account_is_refused(supabase):
    res = await _delete(uuid.uuid4(), account_type=AccountType.COMPANY)

    assert res.status_code == 403
    assert supabase.deleted_users == []


async def test_a_folder_longer_than_a_page_is_removed_whole(supabase, monkeypatch):
    monkeypatch.setattr("app.routers.auth._PAGE", 2)
    applicant_id = uuid.uuid4()
    supabase.buckets["Resume"].files |= {f"{applicant_id}/{n}.pdf" for n in range(5)}

    res = await _delete(applicant_id)

    assert res.status_code == 204
    assert supabase.buckets["Resume"].files == set()
