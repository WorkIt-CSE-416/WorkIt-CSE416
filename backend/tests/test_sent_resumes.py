"""
Seam-1 tests for sent resumes (KAN-208): the API on real Postgres, with
Storage patched at each router's `get_supabase` so nothing reaches the real
bucket. The PDF render is patched too (it counts the renders, which is how
the repeat-hash merge shows); the one real-Tectonic test skips without it.
"""

import base64
import dataclasses
import gzip
import json
import uuid

import pytest
from sqlalchemy import text

from app.services.resume_render import Rendered
from tests import test_built_resumes
from tests.test_bank_import import RESUME_TEXT
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
async def posting(database):
    """A listed job posting to send to: only a send keeps a sent resume
    (KAN-267), and every send names its posting."""
    return await _seed_posting(database, f"https://example.com/{uuid.uuid4()}")


def _to(posting, **source):
    return {**source, "job_posting_id": posting}


def _pdf(body: dict) -> bytes:
    """The PDF a send or GET .../file answers for a snapshot (`data`)."""
    assert body["url"] is None
    return base64.b64decode(body["data"])


async def _snapshots(database) -> list[tuple[str, dict]]:
    """Every snapshot: its source and its JSON."""
    async with database() as session:
        rows = (await session.execute(text("SELECT source, data FROM resume_snapshots ORDER BY created_at"))).all()
    return [(source, json.loads(gzip.decompress(data))) for source, data in rows]


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


async def test_a_send_keeps_a_snapshot_not_a_file(student, storage, renders, posting, database):
    """KAN-267: every send rendered a 33 KB PDF into Storage; it keeps what
    the PDF is made from, about 2 KB, and renders it again on open."""
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me, "General SWE")

    res = await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))

    assert res.status_code == 201
    sent = res.json()
    assert sent["name"] == "General SWE"
    assert sent["built_resume_id"] == built
    assert sent["uploaded_resume_id"] is None
    assert sent["job_posting_id"] == posting
    assert sent["missing_characters"] == []
    assert (sent["file_name"], sent["format"], sent["rebuilt"]) == ("General SWE.pdf", "pdf", False)
    assert _pdf(sent).startswith(b"%PDF Sam Seeker")
    assert storage.files == {}
    [(source, snapshot)] = await _snapshots(database)
    assert (source, snapshot["template"], snapshot["identity"]["name"]) == ("built", "jakes", "Sam Seeker")
    assert "Cut page load time by 30%" in json.dumps(snapshot["view"])

    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert [(s["id"], s["name"]) for s in listed] == [(sent["id"], "General SWE")]

    # Opened later, it renders again from the snapshot.
    opened = (await client.get(f"{me}/sent-resumes/{sent['id']}/file")).json()
    assert (opened["file_name"], _pdf(opened)) == ("General SWE.pdf", _pdf(sent))
    assert len(renders) == 2


async def test_a_download_is_not_a_send(student, storage, renders):
    """KAN-267: every download was kept as a sent resume, PDF or Word, and
    filled Storage with files no employer saw. The editor's Download takes
    .../render or .../docx, which keep nothing; a send names its posting."""
    client, me = student
    built = await _generate(client, me)

    assert (await client.post(f"{me}/sent-resumes", json={"built_resume_id": built})).status_code == 422
    assert (await client.get(f"{me}/built-resumes/{built}/docx")).status_code == 200
    assert storage.files == {} and renders == []
    assert (await client.get(f"{me}/sent-resumes")).json() == []


async def test_a_repeat_send_of_the_same_content_returns_the_last_sent_resume(
    student, storage, renders, posting, database
):
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me)
    first = (await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))).json()

    again = await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))

    assert again.status_code == 200
    assert again.json()["id"] == first["id"]
    assert _pdf(again.json()) == _pdf(first)  # rendered again from the snapshot
    assert storage.files == {}
    assert len(await _snapshots(database)) == 1
    assert len((await client.get(f"{me}/sent-resumes")).json()) == 1


async def test_one_content_sent_to_many_postings_keeps_one_snapshot(student, storage, renders, posting, database):
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me)
    another = await _seed_posting(database, "https://example.com/another")

    for job in (posting, another):
        assert (await client.post(f"{me}/sent-resumes", json=_to(job, built_resume_id=built))).status_code == 201

    assert len((await client.get(f"{me}/sent-resumes")).json()) == 2
    assert len(await _snapshots(database)) == 1


async def test_changed_content_or_another_built_resume_makes_a_new_sent_resume(
    student, storage, renders, posting, database
):
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me, "First")
    first = (await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))).json()

    # The same content from another built resume is its own sent resume.
    # Generate refuses a copy (KAN-267), so the second gets there by an edit:
    # a skill the first lacks, hidden again.
    skill = (await client.post(f"{me}/bank/skills", json={"name": "Rust"})).json()["id"]
    other = await _generate(client, me, "Second")
    hide = {"skills": [{"skill_id": skill, "shown": False}]}
    assert (await client.patch(f"{me}/built-resumes/{other}/choices", json=hide)).status_code == 200
    assert (await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=other))).status_code == 201
    assert len(await _snapshots(database)) == 1  # the same content: one snapshot

    # A fix in the bank changes the view, so the next send is new...
    bank = (await client.get(f"{me}/bank")).json()
    bullet = next(e for e in bank["entries"] if e["bullets"])["bullets"][0]
    await client.patch(f"{me}/bank/bullets/{bullet['id']}", json={"text": "Rewrote the bullet"})
    changed = await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))
    assert changed.status_code == 201
    assert changed.json()["id"] != first["id"]

    # ...and the first is untouched: it still opens as it was sent.
    assert len(await _snapshots(database)) == 2
    opened = (await client.get(f"{me}/sent-resumes/{first['id']}/file")).json()
    assert _pdf(opened) == _pdf(first) != _pdf(changed.json())
    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert [s["name"] for s in listed] == ["First", "Second", "First"]


async def test_a_sent_resume_stays_when_its_built_resume_is_deleted(student, storage, renders, posting):
    client, me = student
    built = await _generate(client, me, "Old Resume")
    sent = (await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))).json()

    assert (await client.delete(f"{me}/built-resumes/{built}")).status_code == 204

    [kept] = (await client.get(f"{me}/sent-resumes")).json()
    assert (kept["id"], kept["name"], kept["built_resume_id"]) == (sent["id"], "Old Resume", None)
    opened = (await client.get(f"{me}/sent-resumes/{sent['id']}/file")).json()
    assert (opened["file_name"], _pdf(opened)) == ("Old Resume.pdf", _pdf(sent))


async def _send_uploaded(database, me, resume_id, posting):
    from app.services import sent_resumes

    async with database() as session:
        sent = await sent_resumes.send_uploaded(
            session, uuid.UUID(me.split("/")[2]), uuid.UUID(resume_id), job_posting_id=uuid.UUID(posting))
        await session.commit()
        return sent


async def test_an_upload_with_no_text_keeps_its_file_while_a_sent_resume_uses_it(student, storage, database, posting):
    # Nothing to rebuild it from (an image-only scan): deleting the upload
    # cannot freeze its sent resume, so the file stays as before KAN-267.
    client, me = student
    uploaded = (await _upload(client, me)).json()
    sent = await _send_uploaded(database, me, uploaded["id"], posting)
    assert sent.row.storage_path == uploaded["storage_path"]
    assert (await _send_uploaded(database, me, uploaded["id"], posting)).row.id == sent.row.id  # a repeat

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


@pytest.fixture
def readable(monkeypatch):
    """Uploads read as RESUME_TEXT, so a freeze has something to parse."""
    async def extract(contents, ext):
        return RESUME_TEXT

    monkeypatch.setattr("app.routers.resumes._extract", extract)


async def test_deleting_an_upload_freezes_its_sent_resumes_and_removes_the_file(
    student, storage, renders, database, posting, readable
):
    """KAN-267: the upload's file stayed in Storage for as long as any sent
    resume pointed at it. Its text is parsed into one snapshot instead."""
    client, me = student
    uploaded = (await _upload(client, me)).json()
    another = await _seed_posting(database, "https://example.com/another")
    sent = [(await client.post(f"{me}/sent-resumes", json=_to(job, uploaded_resume_id=uploaded["id"]))).json()
            for job in (posting, another)]

    assert (await client.delete(f"{me}/resumes/{uploaded['id']}")).status_code == 200

    assert storage.removed == [uploaded["storage_path"]]
    [(source, snapshot)] = await _snapshots(database)
    assert (source, snapshot["raw_text"], snapshot["identity"]["name"]) == ("upload", RESUME_TEXT, "Sam Seeker")
    titles = [e["title"] for section in snapshot["view"]["sections"] for e in section["entries"]]
    assert "Mechanical Engineering Intern" in titles
    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert sorted(s["id"] for s in listed) == sorted(s["id"] for s in sent)
    assert all(s["rebuilt"] and s["format"] == "pdf" and s["uploaded_resume_id"] is None for s in listed)

    opened = (await client.get(f"{me}/sent-resumes/{sent[0]['id']}/file")).json()
    assert (opened["file_name"], opened["rebuilt"], opened["original_text"]) == ("resume.pdf", True, RESUME_TEXT)
    assert _pdf(opened).startswith(b"%PDF Sam Seeker")


async def test_replacing_an_upload_freezes_the_old_files_sent_resumes(
    student, storage, renders, database, posting, readable, monkeypatch
):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    sent = (await client.post(f"{me}/sent-resumes", json=_to(posting, uploaded_resume_id=uploaded["id"]))).json()

    async def newer(contents, ext):
        return RESUME_TEXT + "Awards\nEmployee of the Month  Jan 2027\n"

    monkeypatch.setattr("app.routers.resumes._extract", newer)
    files = {"file": ("resume-v2.pdf", b"%PDF-1.4 newer", "application/pdf")}
    assert (await client.put(f"{me}/resumes/{uploaded['id']}", files=files)).status_code == 200

    assert storage.removed == [uploaded["storage_path"]]
    [(_, snapshot)] = await _snapshots(database)
    assert snapshot["raw_text"] == RESUME_TEXT  # the old file's text, not the new
    [kept] = (await client.get(f"{me}/sent-resumes")).json()
    assert (kept["id"], kept["rebuilt"], kept["uploaded_resume_id"]) == (sent["id"], True, uploaded["id"])


async def test_a_failed_delete_leaves_the_sent_resumes_on_the_file(student, storage, database, posting, readable,
                                                                   monkeypatch):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    await client.post(f"{me}/sent-resumes", json=_to(posting, uploaded_resume_id=uploaded["id"]))

    async def broken(*args, **kwargs):
        raise RuntimeError("the database went away")

    monkeypatch.setattr("app.services.built_resumes.default_if_only", broken)
    assert (await client.delete(f"{me}/resumes/{uploaded['id']}")).status_code == 500

    assert storage.removed == [] and await _snapshots(database) == []
    [kept] = (await client.get(f"{me}/sent-resumes")).json()
    assert kept["rebuilt"] is False
    url = (await client.get(f"{me}/sent-resumes/{kept['id']}/file")).json()["url"]
    assert url.startswith(f"https://storage.test/{uploaded['storage_path']}")


async def test_a_sent_resume_with_neither_a_file_nor_a_snapshot_is_refused(student, database):
    from sqlalchemy.exc import IntegrityError

    _, me = student
    with pytest.raises(IntegrityError, match="sent_resumes_one_file"):
        async with database() as session:
            await session.execute(text("INSERT INTO sent_resumes (applicant_id, name) VALUES (:a, 'x')"),
                                  {"a": uuid.UUID(me.split("/")[2])})
            await session.commit()


def test_a_snapshot_reads_back_as_the_view_it_was():
    from app.services.resume_render.sample import VIEW
    from app.services.resume_view import view_from_json

    assert view_from_json(json.loads(json.dumps(dataclasses.asdict(VIEW), default=str))) == VIEW


async def test_an_uploaded_resume_no_sent_resume_uses_is_removed_with_its_file(student, storage):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    await client.delete(f"{me}/resumes/{uploaded['id']}")
    assert storage.removed == [uploaded["storage_path"]]


async def test_deleting_a_sent_resume_keeps_a_file_its_uploaded_resume_still_has(student, storage, database, posting):
    client, me = student
    uploaded = (await _upload(client, me)).json()
    sent = await _send_uploaded(database, me, uploaded["id"], posting)

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


async def test_a_snapshot_goes_with_the_last_sent_resume_that_uses_it(student, storage, renders, posting, database):
    client, me = student
    built = await _generate(client, me)
    another = await _seed_posting(database, "https://example.com/another")
    first, second = [(await client.post(f"{me}/sent-resumes", json=_to(job, built_resume_id=built))).json()
                     for job in (posting, another)]

    assert (await client.delete(f"{me}/sent-resumes/{first['id']}")).status_code == 204
    assert len(await _snapshots(database)) == 1  # the other still uses it
    assert (await client.delete(f"{me}/sent-resumes/{second['id']}")).status_code == 204
    assert await _snapshots(database) == []
    assert (await client.get(f"{me}/sent-resumes")).json() == []


async def test_a_fresh_render_reports_the_characters_the_font_lacks(student, storage, renders, posting):
    client, me = student
    await client.post(f"{me}/bank/entries", json={"section": "leadership", "title": "Chess Society",
                                                  "bullets": ["Президент of the club"]})
    built = await _generate(client, me)
    res = await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))
    assert res.json()["missing_characters"] == ["П"]
    # The student took that file once; a repeat does not warn again.
    assert (await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))).json()["missing_characters"] == []


async def test_nothing_is_kept_when_the_pdf_cannot_be_made(student, storage, monkeypatch, posting, database):
    from app.services.resume_render import TectonicUnavailable

    def missing(view, identity, template):
        raise TectonicUnavailable("no tectonic binary")

    monkeypatch.setattr("app.services.sent_resumes.render", missing)
    client, me = student
    built = await _generate(client, me)
    res = await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=built))
    assert res.status_code == 503
    assert (await client.get(f"{me}/sent-resumes")).json() == []
    assert await _snapshots(database) == []


async def test_a_snapshot_that_cannot_be_rendered_again_is_503_and_stays(student, storage, renders, posting,
                                                                       monkeypatch):
    from app.services.resume_render import TectonicUnavailable

    client, me = student
    sent = (await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=await _generate(client, me)))).json()

    def missing(view, identity, template):
        raise TectonicUnavailable("no tectonic binary")

    monkeypatch.setattr("app.services.sent_resumes.render", missing)
    assert (await client.get(f"{me}/sent-resumes/{sent['id']}/file")).status_code == 503
    assert [s["id"] for s in (await client.get(f"{me}/sent-resumes")).json()] == [sent["id"]]


async def test_another_students_sent_resumes_are_out_of_reach(student, storage, renders, database, posting):
    from tests.test_built_resumes import _seed_applicant, _sign_in

    client, me = student
    async with database() as session:
        other = await _seed_applicant(session)
    _sign_in(other)
    theirs_built = await _generate(client, f"/applicants/{other}")
    theirs = (await client.post(f"/applicants/{other}/sent-resumes", json=_to(posting, built_resume_id=theirs_built))).json()
    _sign_in(uuid.UUID(me.split("/")[2]))

    assert (await client.get(f"/applicants/{other}/sent-resumes")).status_code == 403
    assert (await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=theirs_built))).status_code == 404
    assert (await client.get(f"{me}/sent-resumes/{theirs['id']}/file")).status_code == 404
    assert (await client.delete(f"{me}/sent-resumes/{theirs['id']}")).status_code == 404


async def test_a_real_send_renders_the_same_pdf_when_opened(student, storage, posting):
    from tests.test_built_resumes import _tectonic_or_skip

    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    res = await client.post(f"{me}/sent-resumes", json=_to(posting, built_resume_id=await _generate(client, me)))
    assert res.status_code == 201

    import io

    from pdfminer.high_level import extract_text

    for body in (res.json(), (await client.get(f"{me}/sent-resumes/{res.json()['id']}/file")).json()):
        words = " ".join(extract_text(io.BytesIO(_pdf(body))).split())
        assert "Sam Seeker" in words and "Cut page load time by 30%" in words


async def _seed_posting(database, apply_url: str = "https://example.com/apply") -> str:
    """A published scraped posting. Auto apply takes only a Greenhouse
    `apply_url` (app/auto_apply/hosts.py); its tests pass one."""
    from sqlalchemy import text

    async with database() as session:
        posting = await session.scalar(text(
            "INSERT INTO job_postings (id, title, status, company_name, apply_url) VALUES"
            " (gen_random_uuid(), 'Intern', 'published', 'Acme', :url) RETURNING id"
        ), {"url": apply_url})
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
    # The same file sent to another posting is its own sent resume.
    another = await _seed_posting(database, "https://example.com/another")
    assert (await client.post(f"{me}/sent-resumes", json=_to(another, built_resume_id=built))).status_code == 201
    # A second Apply to the same posting with unchanged content is a repeat.
    again = await client.post(f"{me}/sent-resumes", json={"built_resume_id": built, "job_posting_id": posting})
    assert (again.status_code, again.json()["id"]) == (200, sent["id"])
    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert sorted(s["job_posting_id"] for s in listed) == sorted([posting, another])


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


async def test_apply_needs_exactly_one_resume_and_a_real_posting(student, storage, renders, database, posting):
    client, me = student
    built = await _generate(client, me)
    uploaded = (await _upload(client, me)).json()

    assert (await client.post(f"{me}/sent-resumes", json={})).status_code == 422
    both = {"built_resume_id": built, "uploaded_resume_id": uploaded["id"]}
    assert (await client.post(f"{me}/sent-resumes", json=both)).status_code == 422
    missing = {"uploaded_resume_id": uploaded["id"], "job_posting_id": str(uuid.uuid4())}
    assert (await client.post(f"{me}/sent-resumes", json=missing)).status_code == 404
    assert (await client.post(f"{me}/sent-resumes", json=_to(posting, uploaded_resume_id=str(uuid.uuid4())))).status_code == 404
    assert (await client.get(f"{me}/sent-resumes")).json() == []
