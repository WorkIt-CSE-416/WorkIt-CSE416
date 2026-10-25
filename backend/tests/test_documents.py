"""
Seam-1 tests for student documents (KAN-369): a student's unofficial
transcript, kept like an uploaded resume, for forms that ask for one. The
API on real Postgres, with Storage patched at the router's `get_supabase`.
"""

import pytest
from sqlalchemy import text

from app.config import get_settings
from tests import test_built_resumes
from tests.test_sent_resumes import FakeStorage

student = test_built_resumes.student

pytestmark = pytest.mark.anyio

PDF = b"%PDF-1.4 a made-up transcript"


class Bucket(FakeStorage):
    def download(self, path):
        return self.files[path]


@pytest.fixture
def storage(monkeypatch):
    fake = Bucket()

    class Client:
        storage = fake

    monkeypatch.setattr("app.routers.documents.get_supabase", lambda: Client())
    return fake


async def test_a_transcript_is_uploaded_replaced_and_deleted(student, storage):
    client, me = student
    assert (await client.get(f"{me}/documents")).json() == []

    res = await client.put(f"{me}/documents/transcript", files={"file": ("Transcript.pdf", PDF, "application/pdf")})
    assert res.status_code == 200
    assert res.json()["kind"] == "transcript"
    assert res.json()["original_filename"] == "Transcript.pdf"
    [first] = storage.files
    assert first.startswith(me.removeprefix("/applicants/") + "/documents/")
    assert [d["original_filename"] for d in (await client.get(f"{me}/documents")).json()] == ["Transcript.pdf"]
    got = await client.get(f"{me}/documents/transcript/bytes")
    assert got.content == PDF
    assert got.headers["content-type"] == "application/pdf"

    # A newer file replaces the old one, which goes from Storage.
    await client.put(f"{me}/documents/transcript", files={"file": ("Fall.pdf", PDF + b" v2", "application/pdf")})
    assert storage.removed == [first]
    assert (await client.get(f"{me}/documents/transcript/bytes")).content == PDF + b" v2"

    # Only a PDF or DOCX is taken.
    bad = await client.put(f"{me}/documents/transcript", files={"file": ("t.txt", b"hello", "text/plain")})
    assert bad.status_code == 400

    assert (await client.delete(f"{me}/documents/transcript")).status_code == 204
    assert storage.files == {}
    assert (await client.get(f"{me}/documents")).json() == []
    assert (await client.get(f"{me}/documents/transcript/bytes")).status_code == 404


async def test_a_local_transcript_comes_from_the_local_folder(student, storage, database, tmp_path, monkeypatch):
    """Development: a row naming `local:<file>` is served from LOCAL_FILES_DIR, never Storage."""
    client, me = student
    monkeypatch.setattr(get_settings(), "local_files_dir", tmp_path)
    (tmp_path / "transcript.pdf").write_bytes(PDF)
    async with database() as session:
        await session.execute(
            text("INSERT INTO student_documents (applicant_id, kind, original_filename, storage_path)"
                 " VALUES (:id, 'transcript', 'transcript.pdf', 'local:transcript.pdf')"),
            {"id": me.removeprefix("/applicants/")},
        )
        await session.commit()

    assert (await client.get(f"{me}/documents/transcript/bytes")).content == PDF
    assert (await client.delete(f"{me}/documents/transcript")).status_code == 204
    assert storage.removed == []
    assert (tmp_path / "transcript.pdf").exists()
