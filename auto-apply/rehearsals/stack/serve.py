"""
The local WorkIt API for KAN-324's live rehearsals: the backend on this
computer, on a throwaway Docker Postgres, signed in as one test student.

    cd backend
    uv run python ../auto-apply/rehearsals/stack/serve.py migrate
    uv run python ../auto-apply/rehearsals/stack/serve.py seed <resume.pdf>
    uv run python ../auto-apply/rehearsals/stack/serve.py serve [port]

Nothing here reaches Supabase. DATABASE_URL must name localhost (refused
otherwise), SUPABASE_URL points at a closed local port, and LOCAL_FILES_DIR
holds the resume (services/local_files.py), so no Storage call is made.
Token checks are replaced by one rule: the token TOKEN is the test student,
anything else is refused. The student is the extension tests' fixture
(autofiller_extension/test/extension.ts STUDENT: "Test Person", dummy data).
"""

import asyncio
import datetime
import os
import sys
import uuid
from pathlib import Path

from sqlalchemy.engine import make_url

BACKEND = Path(__file__).resolve().parents[3] / "backend"
HERE = Path(__file__).resolve().parent

DB = os.environ.setdefault("DATABASE_URL", "postgresql://postgres:kan324@localhost:54342/workit_kan324")
if make_url(DB).host not in {"localhost", "127.0.0.1"}:
    sys.exit(f"Refusing a database that is not on this computer: {make_url(DB).host}")
os.environ["DIRECT_URL"] = DB
os.environ["SCRAPER_DATABASE_URL"] = DB
os.environ["SUPABASE_URL"] = "http://127.0.0.1:9"  # closed: any Storage or Auth call fails here, never reaches the project
os.environ["SUPABASE_SERVICE_KEY"] = "local-only"
os.environ.setdefault("LOCAL_FILES_DIR", str(HERE / ".files"))
os.environ["CONNECTOR_LOOPBACK_REDIRECTS"] = "false"

# The extension tests' student (autofiller_extension/test/extension.ts STUDENT).
STUDENT_ID = uuid.UUID(os.environ.get("KAN324_STUDENT", "00000000-0000-4000-8000-000000000324"))
EMAIL = "test.person@example.com"
TOKEN = "kan324-local-token"
os.environ["WORKIT_ADMINS"] = str(STUDENT_ID)  # reads its own fill reports through the admin routes

sys.path.insert(0, str(BACKEND))


def claims_for(token: str) -> dict:
    import jwt

    if token != TOKEN:
        raise jwt.InvalidTokenError("not the local test token")
    return {"sub": str(STUDENT_ID), "email": EMAIL, "app_metadata": {"account_type": "applicant"}}


def patch_auth() -> None:
    from app import deps

    async def decode(token: str) -> dict:
        return claims_for(token)

    deps.decode_access_token = decode


def migrate() -> None:
    from alembic.config import Config

    from alembic import command

    command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")


async def seed(resume: Path) -> None:
    import shutil

    from sqlalchemy import text

    from app.db import get_sessionmaker
    from app.services import local_files

    path = local_files.local_path(STUDENT_ID, "Test_Person_Resume.pdf")
    target = local_files.file_for(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(resume, target)
    async with get_sessionmaker()() as s:
        await s.execute(text("INSERT INTO auth.users (id) VALUES (:id) ON CONFLICT DO NOTHING"), {"id": STUDENT_ID})
        await s.execute(
            text(
                "INSERT INTO applicant_profiles (id, email, full_name, first_name, last_name, contact_email,"
                " phone_number, linkedin_url, github_url, location, onboarding_completed_at)"
                " VALUES (:id, :email, 'Test Person', 'Test', 'Person', :email, '+1 555 010 0199',"
                " 'https://www.linkedin.com/in/test-person', 'https://github.com/test-person', 'Stony Brook, NY', :now)"
                " ON CONFLICT (id) DO NOTHING"
            ),
            {"id": STUDENT_ID, "email": EMAIL, "now": datetime.datetime.now(datetime.UTC)},
        )
        rid = uuid.uuid5(STUDENT_ID, "resume")
        await s.execute(
            text(
                "INSERT INTO resumes (id, applicant_id, original_filename, storage_path)"
                " VALUES (:rid, :id, 'Test_Person_Resume.pdf', :path) ON CONFLICT (id) DO NOTHING"
            ),
            {"rid": rid, "id": STUDENT_ID, "path": path},
        )
        await s.execute(text("UPDATE applicant_profiles SET default_resume_id = :rid WHERE id = :id"), {"rid": rid, "id": STUDENT_ID})
        await s.commit()
    print(f"seeded {STUDENT_ID} with {target}")


def serve(port: int) -> None:
    import uvicorn

    patch_auth()
    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if what == "migrate":
        migrate()
    elif what == "seed":
        asyncio.run(seed(Path(sys.argv[2])))
    else:
        serve(int(sys.argv[2]) if len(sys.argv) > 2 else 8124)
