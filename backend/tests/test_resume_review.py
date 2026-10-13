"""Review-before-save: /parse writes nothing, and upload stores the reviewed copy."""

import json
import uuid
from io import BytesIO

import pytest
from docx import Document
from fastapi.testclient import TestClient

from app.db import get_session
from app.deps import get_current_account
from app.main import app
from app.models.dto import ResumeStatus
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.routers import resumes
from app.schemas.auth import AccountType, AuthenticatedAccount

APPLICANT = uuid.uuid4()
URL = f"/applicants/{APPLICANT}/resumes"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class FakeStorage:
    def __init__(self):
        self.uploads = []
        self.signed = []  # (path, options) for each signed URL

    @property
    def storage(self):
        return self

    def from_(self, _bucket):
        return self

    def upload(self, path, *_):
        self.uploads.append(path)

    def create_signed_url(self, path, _ttl, options=None):
        self.signed.append((path, options))
        return {"signedUrl": f"https://storage.example/{path}"}


class FakeSession:
    def __init__(self):
        self.added = []
        self.row = None  # what a select of one row returns
        self.rows = []  # what a select of many returns
        self.default_id = None  # the profile's default_resume_id
        self.profile = None  # what session.get() returns
        self.commits = 0

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, _stmt):
        return self

    def scalar_one_or_none(self):
        return self.row

    def scalars(self):
        return self

    def all(self):
        return self.rows

    async def scalar(self, _stmt):
        return self.default_id

    async def get(self, _model, _id):
        return self.profile

    async def commit(self):
        self.commits += 1


@pytest.fixture
def fakes(monkeypatch):
    storage, session = FakeStorage(), FakeSession()
    # The router calls get_supabase() directly rather than through Depends, so
    # a dependency override would miss it and these tests would hit real Storage.
    monkeypatch.setattr(resumes, "get_supabase", lambda: storage)
    monkeypatch.setattr(
        app,
        "dependency_overrides",
        {
            get_current_account: lambda: AuthenticatedAccount(
                id=APPLICANT,
                email="a@example.com",
                full_name="A",
                account_type=AccountType.APPLICANT,
                onboarding_completed=True,
            ),
            get_session: lambda: session,
        },
    )
    return TestClient(app), storage, session


def _resume_file():
    doc = Document()
    for line in ["EXPERIENCE", "Acme Corp  Jan 2023 - Present", "Backend Engineer"]:
        doc.add_paragraph(line)
    buf = BytesIO()
    doc.save(buf)
    return {"file": ("resume.docx", buf.getvalue(), DOCX)}


def test_parse_returns_parsed_json_without_saving(fakes):
    client, storage, session = fakes
    res = client.post(f"{URL}/parse", files=_resume_file())
    assert res.status_code == 200
    assert "experience" in res.json()["parsed_json"]
    assert storage.uploads == [] and session.added == []


def test_upload_stores_the_reviewed_copy_instead_of_reparsing(fakes):
    client, storage, session = fakes
    reviewed = {"skills": [{"skill_name": "Python", "category": None}]}
    res = client.post(
        URL, files=_resume_file(), data={"parsed_json": json.dumps(reviewed)}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["parsed_json"]["skills"] == reviewed["skills"]
    assert body["parsed_json"]["experience"] == []
    assert body["raw_text"].startswith("EXPERIENCE")
    assert len(storage.uploads) == 1 and len(session.added) == 1


def test_upload_rejects_invalid_reviewed_json_before_storing(fakes):
    client, storage, session = fakes
    res = client.post(
        URL,
        files=_resume_file(),
        data={"parsed_json": '{"experience": [{"title": "x"}]}'},
    )
    assert res.status_code == 422
    assert storage.uploads == [] and session.added == []


def test_patch_replaces_parsed_json_of_an_owned_resume(fakes):
    client, _, session = fakes
    resume_id = uuid.uuid4()
    session.row = Resume(
        id=resume_id,
        applicant_id=APPLICANT,
        parsed_json={"skills": [{"skill_name": "Old", "category": None}]},
        status=ResumeStatus.parse_failed,
    )
    edited = {"skills": [{"skill_name": "Python", "category": "Languages"}]}
    res = client.put(f"{URL}/{resume_id}", json=edited)
    assert res.status_code == 200
    assert session.row.parsed_json["skills"] == edited["skills"]
    assert session.row.status == ResumeStatus.parsed
    assert session.commits == 1


def test_patch_404s_when_the_resume_is_not_the_applicants(fakes):
    client, _, session = fakes
    res = client.put(f"{URL}/{uuid.uuid4()}", json={})
    assert res.status_code == 404
    assert session.commits == 0


def test_list_marks_only_the_default_resume(fakes):
    client, _, session = fakes
    session.rows = [
        Resume(id=uuid.uuid4(), applicant_id=APPLICANT, status=ResumeStatus.parsed)
        for _ in range(2)
    ]
    session.default_id = session.rows[1].id
    res = client.get(URL)
    assert res.status_code == 200
    assert [r["is_default"] for r in res.json()] == [False, True]


def test_set_default_points_the_profile_at_the_resume(fakes):
    client, _, session = fakes
    resume_id = uuid.uuid4()
    session.row = Resume(id=resume_id, applicant_id=APPLICANT)
    session.profile = Applicant_Profile(id=APPLICANT)
    res = client.put(f"{URL}/{resume_id}/default")
    assert res.status_code == 200
    assert session.profile.default_resume_id == resume_id
    assert session.commits == 1


@pytest.mark.parametrize(
    ("path", "name", "options"),
    [
        ("a/1.pdf", "cv.pdf", {}),
        ("a/2.docx", "cv.docx", {"download": "cv.docx"}),
    ],
)
def test_file_url_shows_a_pdf_and_downloads_a_docx_by_name(fakes, path, name, options):
    client, storage, session = fakes
    session.row = Resume(
        id=uuid.uuid4(),
        applicant_id=APPLICANT,
        storage_path=path,
        original_filename=name,
    )
    res = client.get(f"{URL}/{session.row.id}/file")
    assert res.status_code == 200
    assert res.json()["url"] == f"https://storage.example/{path}"
    assert storage.signed == [(path, options)]


def test_patch_rejects_oversized_content_without_saving(fakes):
    client, _, session = fakes
    resume_id = uuid.uuid4()
    session.row = Resume(id=resume_id, applicant_id=APPLICANT)
    huge = {"skills": [{"skill_name": "x" * 1000}] * 300}  # ~300 KB of JSON
    res = client.put(f"{URL}/{resume_id}", json=huge)
    assert res.status_code == 413
    assert session.commits == 0
