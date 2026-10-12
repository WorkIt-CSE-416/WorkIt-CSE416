'''
the short list of job roles, and which roles each job is tagged with
ex: Software Engineer; job 3 is tagged software_engineer
docs/search.md has the design
'''
import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, SmallInteger, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Job_Role(Base):
    '''
    one role from the short list, seeded by migrations and changed only by them
    the slug is the key and never changes once shipped; the name is what
    people read and can be renamed
    '''
    __tablename__ = "job_roles"
    slug: Mapped[str] = mapped_column(Text, primary_key=True)        # 'software_engineer'
    name: Mapped[str] = mapped_column(Text, unique=True)             # 'Software Engineer'
    # the oder this role shows in onboarding form 
    sort_order: Mapped[int] = mapped_column(SmallInteger)

    __table_args__ = (
        # lowercase words joined by underscores, so it reads cleanly in url 
        CheckConstraint("slug ~ '^[a-z][a-z0-9_]*$'", name="job_roles_slug_shape"),
    )


class Job_Role_Tag(Base):
    '''
    the role a job is tagged with. A job can have none, one or several:
    "Software Engineer (Machine Learning)" is software_engineer and ml_engineer
    '''
    __tablename__ = "job_role_tags"
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("job_postings.id", ondelete="CASCADE"),
        primary_key=True
    )
    # RESTRICT: a role can't be deleted while any job is tagged with it, 
    # avoid accidental deletes 
    role_slug: Mapped[str] = mapped_column(
        ForeignKey("job_roles.slug", ondelete="RESTRICT"),
        primary_key=True
    )

    __table_args__ = (
        Index("job_role_tags_role_idx", "role_slug", "job_id"),
    )
