"""
Seam-1 tests for sent resumes (KAN-208): the API on real Postgres, with
Storage patched at each router's `get_supabase` so nothing reaches the real
bucket. The PDF render is patched too (it counts the renders, which is how
the repeat-hash merge shows); the one real-Tectonic test skips without it.
"""

import uuid

import pytest

from app.services.resume_render import Rendered
from tests import test_built_resumes
from tests.test_built_resumes import _fill_bank, _generate, _no_text, _upload

# The signed-in applicant and API client that the Generate tests use
student = test_built_resumes.student

pytestmark = pytest.mark.anyio


class FakeStorage:
    """The bucket, in memory: what the routers uploaded and removed."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.removed: list[str] = []

    def from_(self, bucket):
        assert bucket == "Resume"
        return self

    def upload(self, path, contents, options):
        self.files[path] = contents
        return {"path": path}

    def remove(self, paths):
        self.removed.extend(paths)
        for path in paths:
            self.files.pop(path, None)
        return []

    def create_signed_url(self, path, ttl, options=None):
        return {"signedUrl": f"https://storage.test/{path}?download={(options or {}).get('download')}"}


@pytest.fixture
def storage(monkeypatch):
    fake = FakeStorage()

    class Client:
        storage = fake

    for router in ("resumes", "sent_resumes"):
        monkeypatch.setattr(f"app.routers.{router}.get_supabase", lambda: Client())
    monkeypatch.setattr("app.routers.resumes._extract", _no_text)
    return fake


@pytest.fixture
def renders(monkeypatch):
    """Replaces Tectonic: each render's PDF names the view's first bullet, so
    a changed bank gives a changed file. The list counts the calls."""
    calls = []

    def fake_render(view, identity, template):
        calls.append(view)
        bullets = [b.text for s in view.sections for e in s.entries for b in e.bullets]
        return Rendered(pdf=f"%PDF {identity.name} {bullets[:1]}".encode(), page_count=1,
                        missing_characters=("П",) if any("П" in b for b in bullets) else ())

    monkeypatch.setattr("app.services.sent_resumes.render", fake_render)
    return calls


async def test_a_download_keeps_a_sent_resume_the_sent_list_shows(student, storage, renders):
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me, "General SWE")

    res = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})

    assert res.status_code == 201
    sent = res.json()
    assert sent["name"] == "General SWE"
    assert sent["built_resume_id"] == built
    assert sent["uploaded_resume_id"] is None
    assert sent["job_posting_id"] is None
    assert sent["missing_characters"] == []
    assert sent["url"].startswith("https://storage.test/")
    assert "download=General SWE.pdf" in sent["url"]
    # The file in the bucket is the one rendered.
    [(path, pdf)] = storage.files.items()
    assert pdf.startswith(b"%PDF Sam Seeker")
    assert sent["url"].split("?")[0] == f"https://storage.test/{path}"

    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert [(s["id"], s["name"]) for s in listed] == [(sent["id"], "General SWE")]


async def test_a_word_download_keeps_a_sent_resume_too(student, storage, renders):
    from tests.test_built_resumes import _docx_lines

    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me, "General SWE")

    res = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built, "format": "docx"})

    assert res.status_code == 201
    sent = res.json()
    assert "download=General SWE.docx" in sent["url"]
    [(path, content)] = storage.files.items()
    assert path.endswith(".docx")
    assert sent["format"] == "docx"
    assert "Sam Seeker" in _docx_lines(content)
    assert renders == []  # no PDF made
    # A repeat is the same sent resume; the PDF of the same content is its own.
    again = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built, "format": "docx"})
    assert (again.status_code, again.json()["id"]) == (200, sent["id"])
    assert (await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})).status_code == 201
    assert len((await client.get(f"{me}/sent-resumes")).json()) == 2


async def test_an_uploaded_resume_has_no_word_download(student, storage):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    body = {"uploaded_resume_id": uploaded["id"], "format": "docx"}
    assert (await client.post(f"{me}/sent-resumes", json=body)).status_code == 422


async def test_a_repeat_download_of_the_same_content_returns_the_last_sent_resume(student, storage, renders):
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me)
    first = (await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})).json()

    again = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})

    assert again.status_code == 200
    assert again.json()["id"] == first["id"]
    assert len(renders) == 1  # hashed before rendering: no second render
    assert len(storage.files) == 1
    assert len((await client.get(f"{me}/sent-resumes")).json()) == 1


async def test_changed_content_or_another_built_resume_makes_a_new_sent_resume(student, storage, renders):
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me, "First")
    first = (await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})).json()

    # The same content from another built resume is its own sent resume.
    other = await _generate(client, me, "Second")
    assert (await client.post(f"{me}/sent-resumes", json={"built_resume_id": other})).status_code == 201

    # A fix in the bank changes the view, so the next download is new...
    bank = (await client.get(f"{me}/bank")).json()
    bullet = next(e for e in bank["entries"] if e["bullets"])["bullets"][0]
    await client.patch(f"{me}/bank/bullets/{bullet['id']}", json={"text": "Rewrote the bullet"})
    changed = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})
    assert changed.status_code == 201
    assert changed.json()["id"] != first["id"]

    # ...and the first file is untouched.
    assert storage.files[f"{me.split('/')[2]}/sent/{first['id']}.pdf"] != storage.files[
        f"{me.split('/')[2]}/sent/{changed.json()['id']}.pdf"]
    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert [s["name"] for s in listed] == ["First", "Second", "First"]


async def test_a_sent_resume_stays_when_its_built_resume_is_deleted(student, storage, renders):
    client, me = student
    built = await _generate(client, me, "Old Resume")
    sent = (await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})).json()

    assert (await client.delete(f"{me}/built-resumes/{built}")).status_code == 204

    [kept] = (await client.get(f"{me}/sent-resumes")).json()
    assert (kept["id"], kept["name"], kept["built_resume_id"]) == (sent["id"], "Old Resume", None)
    assert len(storage.files) == 1
    url = (await client.get(f"{me}/sent-resumes/{sent['id']}/file")).json()["url"]
    assert "download=Old Resume.pdf" in url


async def _send_uploaded(database, me, resume_id):
    from app.services import sent_resumes

    async with database() as session:
        sent = await sent_resumes.send_uploaded(session, uuid.UUID(me.split("/")[2]), uuid.UUID(resume_id))
        await session.commit()
        return sent


async def test_an_uploaded_resumes_file_stays_while_a_sent_resume_uses_it(student, storage, database):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    sent = await _send_uploaded(database, me, uploaded["id"])
    assert sent.row.storage_path == uploaded["storage_path"]
    assert (await _send_uploaded(database, me, uploaded["id"])).row.id == sent.row.id  # a repeat

    assert (await client.delete(f"{me}/resumes/{uploaded['id']}")).status_code == 200

    assert storage.removed == []
    assert uploaded["storage_path"] in storage.files
    [kept] = (await client.get(f"{me}/sent-resumes")).json()
    assert (kept["name"], kept["uploaded_resume_id"]) == ("resume.pdf", None)
    url = (await client.get(f"{me}/sent-resumes/{kept['id']}/file")).json()["url"]
    assert url == f"https://storage.test/{uploaded['storage_path']}?download=resume.pdf"

    # Its last sent resume deleted, nothing uses the file: it goes.
    assert (await client.delete(f"{me}/sent-resumes/{kept['id']}")).status_code == 204
    assert storage.removed == [uploaded["storage_path"]]


async def test_an_uploaded_resume_no_sent_resume_uses_is_removed_with_its_file(student, storage):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    await client.delete(f"{me}/resumes/{uploaded['id']}")
    assert storage.removed == [uploaded["storage_path"]]


async def test_deleting_a_sent_resume_keeps_a_file_its_uploaded_resume_still_has(student, storage, database):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    sent = await _send_uploaded(database, me, uploaded["id"])

    assert (await client.delete(f"{me}/sent-resumes/{sent.row.id}")).status_code == 204

    assert storage.removed == []
    assert (await client.get(f"{me}/sent-resumes")).json() == []


async def test_apply_to_a_posting_the_jobs_page_does_not_list_is_404(student, storage, database):
    from sqlalchemy import text

    client, me = student
    uploaded = (await _upload(client, me)).json()
    for status in ("draft", "closed"):
        posting = await _seed_posting(database)
        async with database() as session:
            await session.execute(
                text("UPDATE job_postings SET status = CAST(:s AS job_post_status), apply_url = apply_url || :s WHERE id = :id"),
                {"s": status, "id": posting})
            await session.commit()
        res = await client.post(f"{me}/sent-resumes", json={"uploaded_resume_id": uploaded["id"], "job_posting_id": posting})
        assert res.status_code == 404
    assert (await client.get(f"{me}/sent-resumes")).json() == []


async def test_deleting_a_built_sent_resume_removes_its_file(student, storage, renders):
    client, me = student
    sent = (await client.post(f"{me}/sent-resumes", json={"built_resume_id": await _generate(client, me)})).json()

    assert (await client.delete(f"{me}/sent-resumes/{sent['id']}")).status_code == 204

    assert storage.files == {}
    assert (await client.get(f"{me}/sent-resumes")).json() == []


async def test_a_fresh_render_reports_the_characters_the_font_lacks(student, storage, renders):
    client, me = student
    await client.post(f"{me}/bank/entries", json={"section": "leadership", "title": "Chess Society",
                                                  "bullets": ["Президент of the club"]})
    built = await _generate(client, me)
    res = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})
    assert res.json()["missing_characters"] == ["П"]
    # The student took that file once; a repeat does not warn again.
    assert (await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})).json()["missing_characters"] == []


async def test_nothing_is_kept_when_the_pdf_cannot_be_made_or_saved(student, storage, monkeypatch):
    from app.services.resume_render import TectonicUnavailable

    def missing(view, identity, template):
        raise TectonicUnavailable("no tectonic binary")

    monkeypatch.setattr("app.services.sent_resumes.render", missing)
    client, me = student
    built = await _generate(client, me)
    res = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})
    assert res.status_code == 503

    monkeypatch.setattr("app.services.sent_resumes.render", lambda v, i, t: Rendered(b"%PDF", 1, ()))

    def refuse(path, contents, options):
        raise RuntimeError("bucket said no")

    monkeypatch.setattr(storage, "upload", refuse)
    res = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})
    assert res.status_code == 502
    assert (await client.get(f"{me}/sent-resumes")).json() == []


async def test_another_students_sent_resumes_are_out_of_reach(student, storage, renders, database):
    from tests.test_built_resumes import _seed_applicant, _sign_in

    client, me = student
    async with database() as session:
        other = await _seed_applicant(session)
    _sign_in(other)
    theirs_built = await _generate(client, f"/applicants/{other}")
    theirs = (await client.post(f"/applicants/{other}/sent-resumes", json={"built_resume_id": theirs_built})).json()
    _sign_in(uuid.UUID(me.split("/")[2]))

    assert (await client.get(f"/applicants/{other}/sent-resumes")).status_code == 403
    assert (await client.post(f"{me}/sent-resumes", json={"built_resume_id": theirs_built})).status_code == 404
    assert (await client.get(f"{me}/sent-resumes/{theirs['id']}/file")).status_code == 404
    assert (await client.delete(f"{me}/sent-resumes/{theirs['id']}")).status_code == 404


async def test_a_real_download_keeps_the_rendered_pdf(student, storage):
    from tests.test_built_resumes import _tectonic_or_skip

    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    res = await client.post(f"{me}/sent-resumes", json={"built_resume_id": await _generate(client, me)})
    assert res.status_code == 201

    import io

    from pdfminer.high_level import extract_text

    [pdf] = storage.files.values()
    text = " ".join(extract_text(io.BytesIO(pdf)).split())
    assert "Sam Seeker" in text and "Cut page load time by 30%" in text


async def _seed_posting(database) -> str:
    from sqlalchemy import text

    async with database() as session:
        posting = await session.scalar(text(
            "INSERT INTO job_postings (id, title, status, company_name, apply_url) VALUES"
            " (gen_random_uuid(), 'Intern', 'published', 'Acme', 'https://example.com/apply') RETURNING id"
        ))
        await session.commit()
    return str(posting)


async def test_apply_with_a_built_resume_keeps_a_sent_resume_linked_to_the_posting(
    student, storage, renders, database
):
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me, "General SWE")
    posting = await _seed_posting(database)

    res = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built, "job_posting_id": posting})

    assert res.status_code == 201
    sent = res.json()
    assert (sent["built_resume_id"], sent["job_posting_id"]) == (built, posting)
    # The same file downloaded with no posting is its own sent resume.
    assert (await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})).status_code == 201
    # A second Apply to the same posting with unchanged content is a repeat.
    again = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built, "job_posting_id": posting})
    assert (again.status_code, again.json()["id"]) == (200, sent["id"])
    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert sorted(str(s["job_posting_id"]) for s in listed) == sorted([posting, "None"])


async def test_apply_with_an_uploaded_resume_points_at_its_stored_file(student, storage, database):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    posting = await _seed_posting(database)

    res = await client.post(f"{me}/sent-resumes", json={"uploaded_resume_id": uploaded["id"], "job_posting_id": posting})

    assert res.status_code == 201
    sent = res.json()
    assert (sent["uploaded_resume_id"], sent["built_resume_id"], sent["job_posting_id"]) == (
        uploaded["id"], None, posting)
    assert sent["missing_characters"] == []
    # No new file: the link opens the uploaded resume's own file.
    assert list(storage.files) == [uploaded["storage_path"]]
    assert sent["url"] == f"https://storage.test/{uploaded['storage_path']}?download=resume.pdf"
    again = await client.post(f"{me}/sent-resumes", json={"uploaded_resume_id": uploaded["id"], "job_posting_id": posting})
    assert (again.status_code, again.json()["id"]) == (200, sent["id"])


async def test_apply_needs_exactly_one_resume_and_a_real_posting(student, storage, renders, database):
    client, me = student
    built = await _generate(client, me)
    uploaded = (await _upload(client, me)).json()

    assert (await client.post(f"{me}/sent-resumes", json={})).status_code == 422
    both = {"built_resume_id": built, "uploaded_resume_id": uploaded["id"]}
    assert (await client.post(f"{me}/sent-resumes", json=both)).status_code == 422
    missing = {"uploaded_resume_id": uploaded["id"], "job_posting_id": str(uuid.uuid4())}
    assert (await client.post(f"{me}/sent-resumes", json=missing)).status_code == 404
    assert (await client.post(f"{me}/sent-resumes", json={"uploaded_resume_id": str(uuid.uuid4())})).status_code == 404
    assert (await client.get(f"{me}/sent-resumes")).json() == []
