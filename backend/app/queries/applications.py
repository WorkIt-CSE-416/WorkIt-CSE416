"""
job_applications' queries, behind routers/applications.py: when an applicant
marked a job as applied and with which sent resume (KAN-267), and marking
it; saving a job and taking it back out (KAN-261). Auto apply's queue reads
and writes the same rows (auto_apply/queries.py).
"""

import datetime
import re
import uuid
from typing import Any, NamedTuple
from urllib.parse import parse_qs, urlsplit

from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applications import Job_Application
from app.models.dto import (
    BEFORE_APPLIED,
    application_stage,
    experience_level,
    job_post_status,
)
from app.models.jobs import Job_Post
from app.models.sent_resume import Sent_Resume
from app.queries.jobs.filters import LISTED
from app.services.postings import tracked_by

# mark_applied's default: leave the application's sent resume as it is.
KEEP: Any = object()


class AppliedMark(NamedTuple):
    applied_at: datetime.datetime | None
    sent_resume_id: uuid.UUID | None


async def fetch_applied_at(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> datetime.datetime | None:
    '''when this applicant marked this job as applied, or None. A job only
    queued for auto apply has no applied_at, so it reads None too'''
    return await db.scalar(
        select(Job_Application.applied_at).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


async def fetch_applied(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> AppliedMark:
    '''when this applicant marked this job as applied and the sent resume it
    names; both None with no application'''
    row = (await db.execute(
        select(Job_Application.applied_at, Job_Application.sent_resume_id).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )).first()
    return AppliedMark(*row) if row else AppliedMark(None, None)


async def sent_to_job(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, sent_resume_id: uuid.UUID
) -> bool:
    '''whether the sent resume is this applicant's and was sent to this job
    posting: the only one its application may name. The foreign key backs
    the first half; the posting is checked here'''
    return await db.scalar(select(Sent_Resume.id).where(
        Sent_Resume.id == sent_resume_id,
        Sent_Resume.applicant_id == applicant_id,
        Sent_Resume.job_posting_id == job_id,
    )) is not None


async def mark_applied(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, sent_resume_id: Any = KEEP
) -> datetime.datetime | None:
    '''
    marks this job as applied and answers when, or None for a job that isn't
    in the feed: the same jobs GET /jobs/{job_id} shows, since a seeker can't
    apply to the rest, and the scraped postings this applicant already has
    an application on: unlisted (KAN-542), or closed by the feed since
    (KAN-544, `postings.tracked_by`). With `sent_resume_id` (checked by
    `sent_to_job` first), the application names that sent resume, or none for
    None; the default leaves what it names as it is
    '''
    listed = await db.scalar(
        select(Job_Post.id).where(Job_Post.id == job_id, or_(LISTED, tracked_by(applicant_id)))
    )
    if listed is None:
        return None
    # A job queued, skipped or left to the applicant by auto apply becomes
    # applied, dated now: a date it holds from before is no submit's (an
    # insert that took the column's now() default). One already applied
    # keeps its first date (coalesce), so a second click, or two tabs at
    # once, never moves the day; only the resume it names can change. One
    # past applied (interviewing, offer, rejected; KAN-413) keeps its stage
    # and date: "Did You Apply?" on its page names the resume, and must not
    # move the application back.
    link = {} if sent_resume_id is KEEP else {"sent_resume_id": sent_resume_id}
    await db.execute(
        insert(Job_Application)
        .values(applicant_id=applicant_id, job_id=job_id, stage=application_stage.applied,
                applied_at=func.now(), **link)
        .on_conflict_do_update(
            index_elements=["applicant_id", "job_id"],
            set_={
                # Named as the stages before applied, which every database
                # has (dto.BEFORE_APPLIED says why)
                "stage": case(
                    (Job_Application.stage.in_(BEFORE_APPLIED), application_stage.applied),
                    else_=Job_Application.stage,
                ),
                "applied_at": case(
                    (Job_Application.stage.in_(BEFORE_APPLIED), func.now()),
                    else_=func.coalesce(Job_Application.applied_at, func.now()),
                ),
                **link,
            },
        )
    )
    await db.commit()
    return await fetch_applied_at(db, applicant_id, job_id)


async def application_stage_of(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage | None:
    '''this applicant's stage for this job, or None when they have no application for it'''
    return await db.scalar(select(Job_Application.stage).where(
        Job_Application.applicant_id == applicant_id,
        Job_Application.job_id == job_id,
    ))


async def save_job(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage | None:
    '''
    keeps this job as saved and answers its stage, or None for a job that
    isn't in the feed. A job that already has an application (queued,
    applied...) keeps it and answers that stage: saving never moves one back
    '''
    listed = await db.scalar(select(Job_Post.id).where(Job_Post.id == job_id, LISTED))
    if listed is None:
        return None
    # applied_at NULL in place of the column's now() default, as a queued
    # insert writes it: nobody applied to a saved job
    await db.execute(
        insert(Job_Application)
        .values(
            applicant_id=applicant_id,
            job_id=job_id,
            stage=application_stage.saved,
            applied_at=None,
        )
        .on_conflict_do_nothing(index_elements=["applicant_id", "job_id"])
    )
    await db.commit()
    return await db.scalar(
        select(Job_Application.stage).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


async def unsave_job(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage | None:
    '''
    takes this job out of saved and answers None, or answers the stage it
    has instead when it is past saved: a queued or applied job is a record,
    not a bookmark, so this never deletes it. A job never saved is None too
    '''
    removed = await db.scalar(
        delete(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
            Job_Application.stage == application_stage.saved,
        )
        .returning(Job_Application.job_id)
    )
    if removed is not None:
        await db.commit()
        return None
    return await db.scalar(
        select(Job_Application.stage).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


def _bare_link(link):
    """a link without its scheme, www., query, fragment or trailing slash, in lower case: the part that
    names the posting (KAN-542). bare_link is the same rule in Python, for the feed import"""
    no_scheme = func.regexp_replace(link, r"^[a-z][a-z0-9+.-]*://(www\.)?", "", "i")
    return func.lower(func.rtrim(func.split_part(func.split_part(no_scheme, "#", 1), "?", 1), "/"))


def bare_link(url: str) -> str:
    """_bare_link's rule in Python: the feed import compares a few unlisted postings with the whole feed"""
    no_scheme = re.sub(r"^[a-z][a-z0-9+.-]*://(www\.)?", "", url, flags=re.IGNORECASE)
    return no_scheme.split("#", 1)[0].split("?", 1)[0].rstrip("/").lower()


def greenhouse_job(url: str | None) -> str | None:
    '''
    the Greenhouse job id a link names, whatever its form, or None: the hosted
    form on either host (boards. or job-boards.greenhouse.io/<board>/jobs/<id>),
    the embedded one (embed/job_app?for=<board>&token=<id>), or a company page
    that shows the posting (?gh_jid=<id>). Greenhouse's job ids are unique
    across boards, so the id alone names the job (the Fill engine's jobOf)
    '''
    if not url:
        return None
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    query = parse_qs(parts.query)
    if host == "greenhouse.io" or host.endswith(".greenhouse.io"):
        if m := re.match(r"/[\w-]+/jobs/(\d+)(?:/|$)", parts.path):
            return m[1]
        if parts.path.startswith("/embed/job_app"):
            token = query.get("token", [""])[0]
            return token if token.isdigit() else None
    gh_jid = query.get("gh_jid", [""])[0]
    return gh_jid if gh_jid.isdigit() else None


async def _greenhouse_job_where(db: AsyncSession, url: str, where) -> uuid.UUID | None:
    '''the posting in `where` whose apply link names the same Greenhouse job as `url` (greenhouse_job), or None'''
    job = greenhouse_job(url)
    if job is None:
        return None
    # The id appears in every form of the link; the LIKE narrows to a few rows, greenhouse_job decides.
    rows = (await db.execute(
        select(Job_Post.id, Job_Post.apply_url).where(Job_Post.apply_url.contains(job, autoescape=True), where)
        .order_by(Job_Post.id)
    )).all()
    return next((row.id for row in rows if greenhouse_job(row.apply_url) == job), None)


async def _job_by_link(db: AsyncSession, url: str, where) -> uuid.UUID | None:
    '''the posting in `where` whose apply link is the page at `url`, by listed_job_by_link's three rules'''
    exact = await db.scalar(select(Job_Post.id).where(Job_Post.apply_url == url, where))
    if exact is not None:
        return exact
    greenhouse = await _greenhouse_job_where(db, url, where)
    if greenhouse is not None:
        return greenhouse
    # Many postings carry their id only in the query (36 Waymo jobs share careers.withwaymo.com/jobs): the bare
    # link names one of them only when it is the only one, else the wrong job would be saved, or marked applied.
    bare = (await db.scalars(
        select(Job_Post.id).where(_bare_link(Job_Post.apply_url) == _bare_link(url), where).limit(2)
    )).all()
    return bare[0] if len(bare) == 1 else None


async def listed_job_by_link(db: AsyncSession, url: str) -> uuid.UUID | None:
    '''
    the feed's job whose apply link is the page at `url` (the toolbar popup's
    Save to WorkIt, KAN-401; the panel's Track on WorkIt, KAN-424), the same
    link first, else the same Greenhouse job in any link form (KAN-526), else
    the same page without its scheme, www., query, fragment or trailing slash, in any
    case (KAN-542), but only when exactly one listed job has it; None otherwise
    '''
    return await _job_by_link(db, url, LISTED)


# A scraped posting that is not listed now: unlisted, or closed or paused by the feed
_UNPUBLISHED = and_(Job_Post.company_id.is_(None), Job_Post.status != job_post_status.published)


class AddedByLink(NamedTuple):
    job_id: uuid.UUID
    status: job_post_status
    stage: application_stage


async def add_by_link(
    db: AsyncSession, applicant_id: uuid.UUID, url: str, company: str, title: str, level: str
) -> AddedByLink | None:
    '''
    puts the job at `url` on this applicant's Applications Tracker (KAN-542,
    ADR 0008) and answers the posting and their stage. The listed job with
    that link first (listed_job_by_link), else a scraped posting the feed no
    longer lists (an unlisted one, or a closed one: its link is unique), else
    a new unlisted posting with the company, title and level given. A job
    with no application yet is saved; one that has one keeps its stage, as
    save_job does. None when the link is a company's own posting
    '''
    job_id = await listed_job_by_link(db, url) or await _job_by_link(db, url, _UNPUBLISHED)
    if job_id is None:
        # Two adds of one link at once: the second insert does nothing and the select finds the first.
        job_id = await db.scalar(
            insert(Job_Post)
            .values(apply_url=url, company_name=company, title=title, status=job_post_status.unlisted,
                    experience_level=experience_level(level))
            .on_conflict_do_nothing(index_elements=["apply_url"])
            .returning(Job_Post.id)
        ) or await db.scalar(select(Job_Post.id).where(Job_Post.apply_url == url, Job_Post.company_id.is_(None)))
        if job_id is None:
            return None
    await db.execute(
        insert(Job_Application)
        .values(applicant_id=applicant_id, job_id=job_id, stage=application_stage.saved, applied_at=None)
        .on_conflict_do_nothing(index_elements=["applicant_id", "job_id"])
    )
    await db.commit()
    row = (await db.execute(
        select(Job_Post.status, Job_Application.stage)
        .join(Job_Application, Job_Application.job_id == Job_Post.id)
        .where(Job_Post.id == job_id, Job_Application.applicant_id == applicant_id)
    )).one()
    return AddedByLink(job_id, row.status, row.stage)
