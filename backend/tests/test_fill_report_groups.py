"""
Fix report groups (KAN-478): reports with the same signature (job system,
the kind of the field that went wrong, its error) are one group with a
count, so twenty students hitting one broken field make one line on the
admin page. The admins' list and groups filter by engine version too.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio

READBACK = {
    "job_system": "greenhouse",
    "posting_url": "https://job-boards.greenhouse.io/acme/jobs/123",
    "engine_version": "0.3.2",
    "fields": [
        {"kind": "select", "label_shape": "country", "status": "filled"},
        {"kind": "text", "label_shape": "first name", "error": "Readback"},
    ],
}


def _as(account_id: uuid.UUID, email: str) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=account_id, email=email, full_name="Someone", account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


@pytest.fixture
async def people(database, monkeypatch):
    ids = {name: uuid.uuid4() for name in ("sam", "pat", "admin")}
    async with database() as session:
        for account_id in ids.values():
            await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account_id})
        await session.commit()
    monkeypatch.setattr(get_settings(), "workit_admins", "dev@example.com")
    yield ids
    app.dependency_overrides.pop(get_current_account, None)


def _api() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000")


async def test_two_reports_with_the_same_signature_are_one_group_of_two(people):
    async with _api() as api:
        _as(people["sam"], "sam@example.com")
        first = (await api.post("/fill-reports", json=READBACK)).json()["id"]
        # Another student, another posting and engine, the same broken field: the same group.
        _as(people["pat"], "pat@example.com")
        second = (await api.post("/fill-reports", json={
            **READBACK, "posting_url": "https://job-boards.greenhouse.io/other/jobs/9", "engine_version": "0.3.3",
            "fields": [{"kind": "text", "label_shape": "last name", "error": "Readback"}],
        })).json()["id"]
        # A field marked wrong with no error groups by its kind and "Marked"; a report with no field by its system alone.
        marked = (await api.post("/fill-reports", json={**READBACK, "fields": [{"kind": "select", "label_shape": "country", "marked": True}]})).json()["id"]
        (await api.post("/fill-reports", json={**READBACK, "job_system": "lever", "posting_url": "https://jobs.lever.co/acme/abc", "fields": []}))

        assert (await api.get("/admin/fill-report-groups")).status_code == 403
        _as(people["admin"], "dev@example.com")
        groups = (await api.get("/admin/fill-report-groups")).json()["groups"]
        assert [(g["job_system"], g["field_kind"], g["error"], g["count"]) for g in groups] == [
            ("lever", None, None, 1),
            ("greenhouse", "select", "Marked", 1),
            ("greenhouse", "text", "Readback", 2),
        ]
        readback = groups[2]
        assert readback["latest_id"] == second and readback["engine_versions"] == ["0.3.2", "0.3.3"]

        # A group's reports, by its signature; the list and the groups by engine version.
        listed = (await api.get("/admin/fill-reports", params={"signature": readback["signature"]})).json()
        assert [r["id"] for r in listed["reports"]] == [second, first]
        assert listed["reports"][0]["signature"] == readback["signature"]
        newer = (await api.get("/admin/fill-reports", params={"engine_version": "0.3.3"})).json()
        assert [r["id"] for r in newer["reports"]] == [second]
        older = (await api.get("/admin/fill-report-groups", params={"engine_version": "0.3.2"})).json()["groups"]
        assert [(g["field_kind"], g["count"]) for g in older] == [(None, 1), ("select", 1), ("text", 1)]
        assert marked in [r["id"] for r in (await api.get("/admin/fill-reports", params={"signature": groups[1]["signature"]})).json()["reports"]]


async def test_a_report_stored_by_code_older_than_signatures_groups_by_its_system(people, database):
    # Code from before KAN-478 inserts no signature; the column's default is ''.
    async with database() as session:
        await session.execute(text(
            "INSERT INTO fill_reports (job_system, posting_url, engine_version, fields)"
            " VALUES ('greenhouse', 'https://job-boards.greenhouse.io/acme/jobs/1', '0.3.1', '[]')"
        ))
        await session.commit()

    async with _api() as api:
        _as(people["admin"], "dev@example.com")
        groups = (await api.get("/admin/fill-report-groups")).json()["groups"]

    assert [(g["signature"], g["job_system"], g["field_kind"], g["error"], g["count"]) for g in groups] == [
        ("", "greenhouse", None, None, 1),
    ]
