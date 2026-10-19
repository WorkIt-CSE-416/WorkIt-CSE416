"""The uploaded resumes list and file links. The parse preview, the
reviewed-copy upload and the parsed-JSON edit were retired in KAN-211:
an upload is now imported into the experience bank."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.deps import get_current_account
from app.main import app
from app.models.dto import ResumeStatus
from app.models.resume import Resume
from app.routers import resumes
from app.schemas.auth import AccountType, AuthenticatedAccount

APPLICANT = uuid.uuid4()
URL = f"/applicants/{APPLICANT}/resumes"


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


def test_file_url_downloads_a_pdf_when_asked(fakes):
    """The row's Download button (KAN-268): a PDF that would show inline."""
    client, storage, session = fakes
    session.row = Resume(
        id=uuid.uuid4(), applicant_id=APPLICANT, storage_path="a/1.pdf", original_filename="cv.pdf")
    assert client.get(f"{URL}/{session.row.id}/file?download=true").status_code == 200
    assert storage.signed == [("a/1.pdf", {"download": "cv.pdf"})]
