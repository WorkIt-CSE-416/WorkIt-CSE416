"""
Fix reports (KAN-369): a report a coding agent can act on. A student's report
carries the form's structure, the fill's timeline and the form's HTML with
values taken out; it names its sender, who alone (and the admins) may read
it. Admins (WORKIT_ADMINS) list, triage and export it as a Markdown fix
brief. backend/CLAUDE.md's "Fix reports" has the rules.
"""

import uuid
from pathlib import Path

import httpx
import pytest
from sqlalchemy import text

from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services.fill_brief import fix_brief

pytestmark = pytest.mark.anyio

FIXTURES = Path(__file__).parent / "fixtures"

FULL = {
    "job_system": "greenhouse",
    "posting_url": "https://job-boards.greenhouse.io/acme/jobs/123",
    "engine_version": "0.3.2+fcaaf20",
    "trigger": "readback",
    "note": "It typed my name but the box shows something else. Mail me at sam@example.com or 631-555-0199.",
    "fields": [
        {
            "kind": "text", "label_shape": "first name", "error": "Readback", "name": "first_name", "label": "First Name",
            "required": True, "options": [], "selector": "#first_name", "visible": True, "source": "profile",
            "planned": "text:3", "status": "failed", "reason": "meant «planned», page shows «shown»", "readback": "differs",
            "shows": "text:3", "marked": True,
        },
        {
            "kind": "select", "label_shape": "are you authorized to work in the us", "name": "question_7", "label": "Are you authorized to work in the US?",
            "required": True, "options": ["Yes", "No"], "selector": "#question_7", "visible": True, "source": "profile",
            "planned": "option", "status": "filled", "readback": "matches", "shows": "option",
        },
    ],
    "context": {
        "extension_version": "0.1.0", "browser": "Chrome 141", "captured_at": "2026-10-28T14:03:00Z",
        "recognition": {"site": "greenhouse", "on_form": True, "ids": {"board": "acme", "job": "123"}},
        "page_url": "https://job-boards.greenhouse.io/acme/jobs/123", "frame": "top",
    },
    "timeline": [
        {"t": 0, "kind": "plan", "message": "2 questions, 2 planned"},
        {"t": 40, "kind": "field", "field": "first_name", "status": "start"},
        {"t": 310, "kind": "field", "field": "first_name", "status": "failed", "message": "meant «planned», page shows «shown»"},
        {"t": 900, "kind": "error", "message": "TypeError: x is undefined", "stack": "TypeError: x is undefined\n    at fill (engine.js:10:5)"},
    ],
    "html": '<form id="application"><label for="first_name">First Name</label><input id="first_name" name="first_name" type="text"><p>Contact sam@example.com</p></form>',
}


def _as(account_id: uuid.UUID, email: str):
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=account_id, email=email, full_name="Someone", account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


@pytest.fixture
async def people(database, monkeypatch):
    """Two students and an admin, each with an auth.users row; the admin is on WORKIT_ADMINS."""
    ids = {name: uuid.uuid4() for name in ("sam", "pat", "admin")}
    async with database() as session:
        for account_id in ids.values():
            await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account_id})
        await session.commit()
    monkeypatch.setattr(get_settings(), "workit_admins", "dev@example.com, someone-else@example.com")
    yield ids
    app.dependency_overrides.pop(get_current_account, None)


def _api() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000")


async def test_a_full_report_is_stored_with_its_sender_and_what_looks_personal_scrubbed(people):
    _as(people["sam"], "sam@example.com")
    async with _api() as api:
        sent = await api.post("/fill-reports", json=FULL)
        assert sent.status_code == 201
        report = (await api.get(f"/fill-reports/{sent.json()['id']}")).json()
    assert report["note"] == "It typed my name but the box shows something else. Mail me at «email» or «phone»."
    assert "sam@example.com" not in report["html"] and "«email»" in report["html"]
    assert report["fields"][0]["selector"] == "#first_name"
    assert report["status"] == "new"
    assert report["marked"] == ["first_name"]
    assert report["timeline"][3]["stack"].startswith("TypeError")


async def test_a_student_sees_only_their_own_reports(people):
    _as(people["sam"], "sam@example.com")
    async with _api() as api:
        mine = (await api.post("/fill-reports", json=FULL)).json()["id"]
        _as(people["pat"], "pat@example.com")
        theirs = (await api.post("/fill-reports", json={**FULL, "job_system": "lever"})).json()["id"]
        assert [r["id"] for r in (await api.get("/fill-reports/mine")).json()["reports"]] == [theirs]
        assert (await api.get(f"/fill-reports/{mine}")).status_code == 404
        for path in ("/admin/fill-reports", f"/admin/fill-reports/{mine}", f"/admin/fill-reports/{mine}/brief", f"/admin/fill-reports/{mine}/fixture"):
            assert (await api.get(path)).status_code == 403, path
        assert (await api.patch(f"/admin/fill-reports/{mine}", json={"status": "fixed"})).status_code == 403


async def test_every_route_needs_a_sign_in():
    async with _api() as api:
        for path in ("/fill-reports/mine", f"/fill-reports/{uuid.uuid4()}", "/admin/fill-reports", f"/admin/fill-reports/{uuid.uuid4()}/brief"):
            assert (await api.get(path)).status_code == 401, path


async def test_an_oversized_report_is_refused(people):
    _as(people["sam"], "sam@example.com")
    async with _api() as api:
        assert (await api.post("/fill-reports", json={**FULL, "html": "x" * 1_100_000})).status_code == 413
        assert (await api.post("/fill-reports", json={**FULL, "html": "x" * 520_000})).status_code == 422
        too_many = {**FULL, "timeline": [{"t": 0, "kind": "plan"}] * 401}
        assert (await api.post("/fill-reports", json=too_many)).status_code == 422
        with_value = {**FULL, "fields": [{**FULL["fields"][0], "value": "Sam"}]}
        assert (await api.post("/fill-reports", json=with_value)).status_code == 422


async def test_an_admin_lists_filters_triages_and_exports_a_report(people):
    _as(people["sam"], "sam@example.com")
    async with _api() as api:
        first = (await api.post("/fill-reports", json=FULL)).json()["id"]
        second = (await api.post("/fill-reports", json={**FULL, "job_system": "lever", "posting_url": "https://jobs.lever.co/acme/abc"})).json()["id"]
        _as(people["admin"], "Dev@Example.com")

        listed = (await api.get("/admin/fill-reports")).json()
        assert [r["id"] for r in listed["reports"]] == [second, first] and listed["total"] == 2
        assert [r["id"] for r in (await api.get("/admin/fill-reports?job_system=greenhouse")).json()["reports"]] == [first]

        triaged = await api.patch(f"/admin/fill-reports/{first}", json={"status": "triaged", "admin_note": "Greenhouse retypes the name."})
        assert triaged.status_code == 200 and triaged.json()["status"] == "triaged"
        assert [r["id"] for r in (await api.get("/admin/fill-reports?status=triaged")).json()["reports"]] == [first]
        assert (await api.get("/admin/fill-reports?status=new")).json()["total"] == 1
        assert (await api.patch(f"/admin/fill-reports/{first}", json={"status": "done"})).status_code == 422

        brief = await api.get(f"/admin/fill-reports/{first}/brief")
        assert brief.status_code == 200 and brief.headers["content-type"].startswith("text/markdown")
        assert "autofiller_extension/fill-engine/src/greenhouse.ts" in brief.text
        assert "Greenhouse retypes the name." in brief.text

        fixture = await api.get(f"/admin/fill-reports/{first}/fixture")
        assert fixture.status_code == 200 and fixture.headers["content-type"].startswith("text/plain")
        assert "attachment" in fixture.headers["content-disposition"]
        assert '<input id="first_name"' in fixture.text

        assert (await api.get(f"/admin/fill-reports/{uuid.uuid4()}/brief")).status_code == 404


def test_the_fix_brief_reads_as_the_golden_file():
    # tests/fixtures/fill_brief.md is the brief's format as docs/fill-reports.md describes it, read by hand.
    report = {
        **FULL,
        "note": "It typed my name but the box shows something else.",
        "id": "7f3c2a10-0000-4000-8000-000000000001",
        "created_at": "2026-10-28T14:03:05Z",
        "status": "triaged",
        "admin_note": "Greenhouse retypes the name.",
        "updated_at": None,
    }
    golden = (FIXTURES / "fill_brief.md").read_text()
    assert fix_brief(report, engine_commit="fcaaf20d") == golden



def test_the_script_writes_the_brief_the_fixture_and_the_question_set(tmp_path):
    from app.scripts.fill_report import write_brief

    report = {**FULL, "id": "7f3c2a10-0000-4000-8000-000000000001", "created_at": "2026-10-28T14:03:05Z", "status": "new"}
    folder = write_brief(report, tmp_path, commit=None)
    assert sorted(p.name for p in folder.iterdir()) == ["brief.md", "fill-report-7f3c2a10.html", "question-set.json", "report.json"]
    assert (folder / "fill-report-7f3c2a10.html").read_text() == FULL["html"]
    import json
    assert json.loads((folder / "question-set.json").read_text())[0] == {
        "name": "first_name", "label": "First Name", "kind": "text", "required": True, "options": [],
    }
    assert "`fill-report-7f3c2a10.html`" in (folder / "brief.md").read_text()
    assert json.loads((folder / "report.json").read_text())["id"] == report["id"]


def test_the_script_finds_the_engine_commit_a_version_names():
    import subprocess

    from app.scripts.fill_report import ENGINE_CHECKOUT, engine_commit

    if not (ENGINE_CHECKOUT / "build.mjs").exists():
        pytest.skip("no engine checkout (git submodule update --init)")
    version = subprocess.run(["node", "build.mjs", "--version"], cwd=ENGINE_CHECKOUT, capture_output=True, text=True, check=True).stdout.strip()
    commit = engine_commit(version)
    assert commit is not None
    # The commit found builds the same engine as the checkout: no change to src/ or the version since.
    same = subprocess.run(["git", "-C", str(ENGINE_CHECKOUT), "diff", "--quiet", commit, "HEAD", "--", "src", "package.json"], check=False)
    assert same.returncode == 0
    assert engine_commit("0.0.0+0000000") is None
