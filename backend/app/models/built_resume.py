'''
Built resumes (KAN-207): a name, a template and an optional job posting,
plus one choice row for each bank entry, bullet and skill on the resume. The
text always comes from the bank (ADR 0001); these rows say only what shows
and in what order. A bank item with no choice row is not on the resume.
'''
import uuid as _uuid

from sqlalchemy import ForeignKey, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Built_Resume(BaseModel):
    '''
    A base resume when `job_posting_id` is null, else the tailored resume for
    that posting (at most one per applicant and posting). `template` is a
    stable template id the renderer knows ("jakes"). `page_settings` is how
    its page is set (KAN-435): the fields of resume_render's PageSettings, a
    field left out at its default, so `{}` is Jake's own page.
    '''
    __tablename__ = "built_resumes"
    __table_args__ = (
        UniqueConstraint("applicant_id", "job_posting_id", name="built_resumes_applicant_posting_key"),
    )

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    name: Mapped[str]
    template: Mapped[str]
    page_settings: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    # RESTRICT: postings close, never go; a hard delete must not take the
    # student's tailored resume with it.
    job_posting_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("job_postings.id", ondelete="RESTRICT"))


class Built_Resume_Entry(BaseModel):
    '''Whether an entry shows, its place in its section, and its Education toggles.'''
    __tablename__ = "built_resume_entries"

    built_resume_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("built_resumes.id", ondelete="CASCADE"), primary_key=True)
    entry_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("bank_entries.id", ondelete="CASCADE"), primary_key=True, index=True)
    shown: Mapped[bool] = mapped_column(server_default=text("true"))
    position: Mapped[int]
    show_gpa: Mapped[bool] = mapped_column(server_default=text("true"))
    show_coursework: Mapped[bool] = mapped_column(server_default=text("true"))


class Built_Resume_Bullet(BaseModel):
    '''
    Whether a bullet shows, its place in its entry, and the variant that
    shows (null: the original). Deleting the variant brings the original
    back.
    '''
    __tablename__ = "built_resume_bullets"

    built_resume_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("built_resumes.id", ondelete="CASCADE"), primary_key=True)
    bullet_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("bank_bullets.id", ondelete="CASCADE"), primary_key=True, index=True)
    shown: Mapped[bool] = mapped_column(server_default=text("true"))
    position: Mapped[int]
    variant_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("bank_bullet_variants.id", ondelete="SET NULL"))


class Built_Resume_Skill(BaseModel):
    '''Whether a skill shows and its place in the skills list.'''
    __tablename__ = "built_resume_skills"

    built_resume_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("built_resumes.id", ondelete="CASCADE"), primary_key=True)
    skill_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("bank_skills.id", ondelete="CASCADE"), primary_key=True, index=True)
    shown: Mapped[bool] = mapped_column(server_default=text("true"))
    position: Mapped[int]
