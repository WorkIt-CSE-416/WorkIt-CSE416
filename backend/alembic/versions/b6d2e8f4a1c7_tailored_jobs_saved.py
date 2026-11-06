"""Save every job a student tailored a resume for, once (KAN-217)

Data only, no schema change. From KAN-217 a Tailor run saves its job to the
student's Tracker in the run's own commit (`queries/applications.keep_saved`),
so the job leaves the Jobs page (`JobFilters.tracked_by`). Jobs tailored
before that have a tailored resume and no application, so they stayed on the
Jobs page with a Tailored chip and were missing from the Tracker. This gives
each of them the `saved` application a run makes today.

It follows `keep_saved` exactly, for the postings a run reaches today:

- one `saved` row per tailored resume (`built_resumes.job_posting_id`; a
  student has at most one per posting, `built_resumes_applicant_posting_key`),
  with `applied_at` NULL, as `keep_saved` writes it;
- only a posting the Jobs page lists (`services/postings.py` LISTED: scraped,
  published, not added by a student), the only kind a run accepts
  (`postings.listed`); a tailored job that has closed since stays off the
  Tracker, as a run on it would be refused;
- `ON CONFLICT DO NOTHING`, so a job already saved, queued, applied or past
  applied keeps its row and its stage.

`created_at` is the tailored resume's own, so the Tracker dates the save from
when the student tailored, not from this migration.

Apply it right after the deploy of KAN-217 (or just before: until then the
Jobs page shows these jobs anyway, and only the Tracker gains them early). It
reads and writes only `built_resumes`, `job_postings` and `job_applications`,
whose columns it names all exist on the shared database.

Revision ID: b6d2e8f4a1c7
Revises: a1b2c3d4e5f6
Create Date: 2026-11-05 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b6d2e8f4a1c7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Kept as a constant so tests/test_tailored_jobs_saved.py runs the same SQL on
# real Postgres. Enum literals are the members' names, which equal their
# values for both enums (app/models/CLAUDE.md, "Enums store .name").
BACKFILL = """
INSERT INTO job_applications (applicant_id, job_id, stage, applied_at, created_at)
SELECT r.applicant_id, r.job_posting_id, 'saved', NULL, r.created_at
FROM built_resumes AS r
JOIN job_postings AS p ON p.id = r.job_posting_id
WHERE p.company_id IS NULL
  AND p.status = 'published'
  AND p.added_by_student IS FALSE
ON CONFLICT (applicant_id, job_id) DO NOTHING
"""


def upgrade() -> None:
    """Give each listed job with a tailored resume a saved application."""
    op.execute(BACKFILL)


def downgrade() -> None:
    """Nothing to undo exactly.

    A row this wrote cannot be told apart from a save the student made
    afterwards (the Save button, or a second Tailor run, writes the same
    row), and deleting saved rows by tailored resume would take those too.
    The rows are harmless to the code before KAN-217: the Jobs page then
    lists saved jobs anyway. Unsave a job on the Tracker to remove one.
    """
