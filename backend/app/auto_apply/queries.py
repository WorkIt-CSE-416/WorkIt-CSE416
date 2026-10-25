"""
Layer 1, database: auto apply's reads and writes of job_applications
(auto-apply/architecture.md, "The function layers"). Each does one thing,
checks no ownership and never commits: the layer-2 step that calls it owns
the transaction.

The queue is the applicant's job_applications rows: `stage` says where each
stands (dto.application_stage), `created_at` orders them. pick_resume reads
the resume rows, never writes them.
"""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from sqlalchemy import (
    DateTime,
    Select,
    Uuid,
    and_,
    cast,
    delete,
    func,
    literal,
    null,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applications import Job_Application
from app.models.built_resume import Built_Resume
from app.models.dto import application_stage
from app.models.jobs import Job_Post
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.models.sent_resume import Sent_Resume
from app.models.written_answers import Written_Answer
from app.queries.jobs.filters import AUTO_APPLY_SUPPORTED, LISTED
from app.queries.jobs.listings import LISTING_COLUMNS, to_listing
from app.schemas.applications import Application, NamedFact, WrittenAnswer, WrittenQuestion
from app.schemas.sent_resume import SentResumeResponse


async def queue_applications(
    db: AsyncSession, applicant_id: uuid.UUID, job_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """
    Saves as queued each of `job_ids` that is listed (open, scraped), is on a
    hiring system auto apply fills (AUTO_APPLY_SUPPORTED), and has no
    application of this applicant yet, or only a saved one (KAN-261);
    answers the ones it queued. One with an application at any other stage
    keeps it: queueing never moves an applied or skipped job back.
    """
    if not job_ids:
        return set()
    stage_type = Job_Application.__table__.c.stage.type
    listed = select(
        literal(applicant_id, Uuid()),
        Job_Post.id,
        # Cast: a bare parameter in a SELECT list reaches Postgres as text,
        # which it won't put in an enum column.
        cast(literal(application_stage.queued, stage_type), stage_type),
        # Not applied yet: NULL in place of the column's now() default.
        cast(null(), DateTime(timezone=True)),
    ).where(Job_Post.id.in_(job_ids), LISTED, AUTO_APPLY_SUPPORTED)
    queued = await db.scalars(
        insert(Job_Application)
        .from_select(["applicant_id", "job_id", "stage", "applied_at"], listed)
        # A saved job is no application yet: it becomes queued. RETURNING
        # names it as queued too, so the button and the batch count it. Its
        # created_at moves to now, since that orders the queue: kept, a job
        # saved last month would jump ahead of everything queued since.
        .on_conflict_do_update(
            index_elements=["applicant_id", "job_id"],
            set_={"stage": application_stage.queued, "created_at": func.now()},
            where=Job_Application.stage == application_stage.saved,
        )
        .returning(Job_Application.job_id)
    )
    return set(queued)


async def fetch_open_apply_url(db: AsyncSession, job_id: uuid.UUID) -> str | None:
    """The apply_url of this job posting while it is listed (open), else None."""
    return await db.scalar(select(Job_Post.apply_url).where(Job_Post.id == job_id, LISTED))


async def fetch_stage(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage | None:
    """This applicant's stage for this job, or None when they have no
    application for it."""
    return await db.scalar(
        select(Job_Application.stage).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


def _applications(applicant_id: uuid.UUID) -> Select:
    """This applicant's applications, each with its job posting's listing
    and the sent resume it names (KAN-267), if any."""
    return (
        select(
            *LISTING_COLUMNS,
            Job_Application.stage.label("stage"),
            Job_Application.created_at.label("added_at"),
            Job_Application.applied_at.label("applied_at"),
            LISTED.label("open"),
            Sent_Resume,
        )
        .join(Job_Application, Job_Application.job_id == Job_Post.id)
        .outerjoin(Sent_Resume, Sent_Resume.id == Job_Application.sent_resume_id)
        .where(Job_Application.applicant_id == applicant_id)
    )


def _to_application(row) -> Application:
    return Application(
        job=to_listing(row),
        stage=row.stage,
        added_at=row.added_at,
        applied_at=row.applied_at,
        open=row.open,
        sent_resume=SentResumeResponse.from_row(row.Sent_Resume) if row.Sent_Resume else None,
    )


async def link_resume(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, sent_resume_id: uuid.UUID
) -> None:
    """Names the sent resume an application goes out with (KAN-267): auto
    apply's resume step, which made it for this job posting. Flushes; the
    caller commits."""
    await db.execute(
        update(Job_Application)
        .where(Job_Application.applicant_id == applicant_id, Job_Application.job_id == job_id)
        .values(sent_resume_id=sent_resume_id)
    )


async def fetch_applications(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    stages: Sequence[application_stage] = (),
) -> list[Application]:
    """This applicant's applications in `stages` (every stage when empty),
    newest first. Closed job postings stay in, marked `open=False`."""
    query = _applications(applicant_id)
    if stages:
        query = query.where(Job_Application.stage.in_(stages))
    rows = await db.execute(
        query.order_by(Job_Application.created_at.desc(), Job_Application.job_id)
    )
    return [_to_application(row) for row in rows]


async def fetch_application(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> Application | None:
    """This applicant's application for this job, or None when they have
    none. A closed job posting's comes back marked `open=False`."""
    row = (
        await db.execute(_applications(applicant_id).where(Job_Application.job_id == job_id))
    ).first()
    return _to_application(row) if row else None


async def fetch_next_application(
    db: AsyncSession, applicant_id: uuid.UUID, skip: Sequence[uuid.UUID] = ()
) -> Application | None:
    """The oldest queued application whose job posting is still open, or
    None when nothing is left to fill. A closed one is passed over: its page
    is gone. So is each job in `skip`: batch apply's tabs already open."""
    query = _applications(applicant_id).where(
        Job_Application.stage == application_stage.queued, LISTED
    )
    if skip:
        query = query.where(Job_Application.job_id.not_in(skip))
    row = (
        await db.execute(
            query.order_by(Job_Application.created_at, Job_Application.job_id).limit(1)
        )
    ).first()
    return _to_application(row) if row else None


async def remove_queued(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> bool:
    """Deletes this application if it is still queued; answers whether it
    did. The stage is in the same statement, so a fill that finishes it in
    between is never undone."""
    removed = await db.scalar(
        delete(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
            Job_Application.stage == application_stage.queued,
        )
        .returning(Job_Application.job_id)
    )
    return removed is not None


async def set_stage(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, stage: application_stage
) -> None:
    """Moves this application to `stage`. Applied also records when, unless
    it already has a date."""
    values: dict = {"stage": stage}
    if stage == application_stage.applied:
        values["applied_at"] = func.coalesce(Job_Application.applied_at, func.now())
    await db.execute(
        update(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
        .values(**values)
    )


@dataclass(frozen=True)
class ResumeChoice:
    """The resume an application sends: exactly one of the two ids."""

    built_resume_id: uuid.UUID | None = None
    uploaded_resume_id: uuid.UUID | None = None


async def chosen_resume(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> ResumeChoice | None:
    """
    The resume the student chose for this application on the Auto Apply
    page's Up Next (KAN-359), read from the sent resume the application
    names: the built or uploaded resume it was sent from. None when the
    application names none, or its source has since been deleted (the sent
    resume's pointer is then null): pick_resume decides instead. A link an
    earlier run made reads the same way, which is that run's own pick.
    """
    row = (
        await db.execute(
            select(Sent_Resume.built_resume_id, Sent_Resume.uploaded_resume_id)
            .join(Job_Application, Job_Application.sent_resume_id == Sent_Resume.id)
            .where(
                Job_Application.applicant_id == applicant_id,
                Job_Application.job_id == job_id,
            )
        )
    ).first()
    if row is None:
        return None
    if row.built_resume_id is not None:
        return ResumeChoice(built_resume_id=row.built_resume_id)
    if row.uploaded_resume_id is not None:
        return ResumeChoice(uploaded_resume_id=row.uploaded_resume_id)
    return None


async def pick_resume(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> ResumeChoice | None:
    """
    The resume to attach to this applicant's application for this job
    (auto-apply/architecture.md, "Picking the resume"): the one tailored to
    the job posting, else the default resume, a built or an uploaded one
    (set_default keeps one pointer, never both). None when there is neither,
    or the default upload has no stored file: the form is filled without one.
    """
    tailored = await db.scalar(
        select(Built_Resume.id).where(
            Built_Resume.applicant_id == applicant_id,
            Built_Resume.job_posting_id == job_id,
        )
    )
    if tailored is not None:
        return ResumeChoice(built_resume_id=tailored)
    default = (
        await db.execute(
            select(Applicant_Profile.default_built_resume_id, Resume.id.label("uploaded_id"))
            .outerjoin(
                Resume,
                and_(
                    Resume.id == Applicant_Profile.default_resume_id,
                    Resume.storage_path.is_not(None),
                ),
            )
            .where(Applicant_Profile.id == applicant_id)
        )
    ).first()
    if default is None:
        return None
    if default.default_built_resume_id is not None:
        return ResumeChoice(built_resume_id=default.default_built_resume_id)
    if default.uploaded_id is not None:
        return ResumeChoice(uploaded_resume_id=default.uploaded_id)
    return None


async def put_questions(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, questions: Sequence[WrittenQuestion]
) -> None:
    """Keeps the questions an application's form needs written (KAN-377),
    in the form's order. A question asked again keeps the answer saved for
    it; one the form no longer sends stays, with its answer. Flushes; the
    caller commits."""
    if not questions:
        return
    rows = [
        {"applicant_id": applicant_id, "job_id": job_id, "position": n, **q.model_dump()}
        for n, q in enumerate(questions)
    ]
    insert_rows = insert(Written_Answer).values(rows)
    await db.execute(
        insert_rows.on_conflict_do_update(
            index_elements=["applicant_id", "job_id", "name"],
            set_={
                "label": insert_rows.excluded.label,
                "required": insert_rows.excluded.required,
                "max_length": insert_rows.excluded.max_length,
                "kind": insert_rows.excluded.kind,
                "options": insert_rows.excluded.options,
                "position": insert_rows.excluded.position,
            },
        )
    )


async def fetch_written(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> list[WrittenAnswer]:
    """An application's questions that need writing, in the form's order,
    each with its saved answer or None."""
    rows = await db.scalars(
        select(Written_Answer)
        .where(Written_Answer.applicant_id == applicant_id, Written_Answer.job_id == job_id)
        .order_by(Written_Answer.position, Written_Answer.name)
    )
    return [
        WrittenAnswer(
            name=r.name, label=r.label, required=r.required, max_length=r.max_length, kind=r.kind, options=r.options,
            answer=r.answer,
        )
        for r in rows
    ]


async def fetch_next_to_write(
    db: AsyncSession, applicant_id: uuid.UUID, skip: Collection[uuid.UUID] = ()
) -> tuple[uuid.UUID, str | None] | None:
    """The oldest open application (queued or needs_you, its job posting
    open) with a question still unanswered, leaving out the jobs in `skip`:
    its job id and the posting's description. None when nothing is left to
    write."""
    unanswered = (
        select(Written_Answer.job_id)
        .where(
            Written_Answer.applicant_id == applicant_id,
            Written_Answer.job_id == Job_Application.job_id,
            Written_Answer.answer.is_(None),
        )
        .exists()
    )
    row = (
        await db.execute(
            select(Job_Application.job_id, Job_Post.description)
            .join(Job_Post, Job_Post.id == Job_Application.job_id)
            .where(
                Job_Application.applicant_id == applicant_id,
                Job_Application.stage.in_((application_stage.queued, application_stage.needs_you)),
                LISTED,
                unanswered,
                Job_Application.job_id.not_in(skip),
            )
            .order_by(Job_Application.created_at, Job_Application.job_id)
            .limit(1)
        )
    ).first()
    return (row.job_id, row.description) if row else None


async def fetch_unanswered(
    db: AsyncSession, applicant_id: uuid.UUID
) -> list[tuple[uuid.UUID, str | None, str | None, list[WrittenAnswer]]]:
    """Every open application (queued or needs_you, its job posting open)
    with a question still unanswered, oldest first: its job id, the
    posting's company and title, and those questions in the form's order."""
    rows = await db.execute(
        select(Written_Answer, Job_Post.company_name, Job_Post.title)
        .join(
            Job_Application,
            and_(Job_Application.applicant_id == Written_Answer.applicant_id, Job_Application.job_id == Written_Answer.job_id),
        )
        .join(Job_Post, Job_Post.id == Written_Answer.job_id)
        .where(
            Written_Answer.applicant_id == applicant_id,
            Written_Answer.answer.is_(None),
            Job_Application.stage.in_((application_stage.queued, application_stage.needs_you)),
            LISTED,
        )
        .order_by(Job_Application.created_at, Job_Application.job_id, Written_Answer.position, Written_Answer.name)
    )
    found: dict[uuid.UUID, tuple[uuid.UUID, str | None, str | None, list[WrittenAnswer]]] = {}
    for r, company, title in rows:
        posting = found.setdefault(r.job_id, (r.job_id, company, title, []))
        posting[3].append(
            WrittenAnswer(
                name=r.name, label=r.label, required=r.required, max_length=r.max_length, kind=r.kind,
                options=r.options, answer=None,
            )
        )
    return list(found.values())


async def fetch_answered(
    db: AsyncSession, applicant_id: uuid.UUID
) -> list[tuple[uuid.UUID, str | None, str | None, list[Written_Answer]]]:
    """Every application with a written question answered (one asked in
    words, not a choice), at any stage, newest application first: its job
    id, the posting's company and title, and those questions' rows in the
    form's order."""
    rows = await db.execute(
        select(Written_Answer, Job_Post.company_name, Job_Post.title)
        .join(
            Job_Application,
            and_(Job_Application.applicant_id == Written_Answer.applicant_id, Job_Application.job_id == Written_Answer.job_id),
        )
        .join(Job_Post, Job_Post.id == Written_Answer.job_id)
        .where(
            Written_Answer.applicant_id == applicant_id,
            Written_Answer.answer.is_not(None),
            Written_Answer.kind.is_(None),
        )
        .order_by(Job_Application.created_at.desc(), Job_Application.job_id, Written_Answer.position, Written_Answer.name)
    )
    found: dict[uuid.UUID, tuple[uuid.UUID, str | None, str | None, list[Written_Answer]]] = {}
    for r, company, title in rows:
        found.setdefault(r.job_id, (r.job_id, company, title, []))[3].append(r)
    return list(found.values())


async def save_written(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, answers: dict[str, str],
    named: dict[str, NamedFact] | None = None,
) -> None:
    """Writes each answer onto its question's row, with the brief fact it
    names in `named` (none when absent), but never over the student's own
    (KAN-379). Flushes; the caller commits, and has checked every name is
    the application's."""
    named = named or {}
    for name, answer in answers.items():
        await db.execute(
            update(Written_Answer)
            .where(
                Written_Answer.applicant_id == applicant_id,
                Written_Answer.job_id == job_id,
                Written_Answer.name == name,
                Written_Answer.own.is_(False),
            )
            .values(answer=answer, answered_at=func.now(),
                    named_fact=named[name].model_dump() if name in named else None)
        )


async def drop_written(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, names: Collection[str]) -> None:
    """Clears the answers to these questions, so the student's Claude
    writes them again, but never the student's own. Flushes; the caller
    commits."""
    if names:
        await db.execute(
            update(Written_Answer)
            .where(
                Written_Answer.applicant_id == applicant_id,
                Written_Answer.job_id == job_id,
                Written_Answer.name.in_(list(names)),
                Written_Answer.own.is_(False),
            )
            .values(answer=None, answered_at=None, named_fact=None)
        )


# Where a question the form never sent goes among the application's (an
# edit to a field a saved answer filled): after every one the form sent.
UNSENT = 10_000


async def save_own_written(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, name: str, label: str, answer: str,
    own: bool = True,
) -> None:
    """The student's answer to their application's question `name`
    (KAN-379), over whatever was saved: `own` for their own words, false for
    their edit of an answer WorkIt filled (still that answer's). A question
    the tab never sent (a field a saved answer filled) is kept too, so later
    forms reuse it. Flushes; the caller commits."""
    row = insert(Written_Answer).values(
        applicant_id=applicant_id, job_id=job_id, name=name, label=label, required=False, position=UNSENT,
        answer=answer, answered_at=func.now(), own=own,
    )
    await db.execute(row.on_conflict_do_update(
        index_elements=["applicant_id", "job_id", "name"],
        # Their own words name no brief fact; an edit keeps the one it had.
        set_={"answer": row.excluded.answer, "answered_at": row.excluded.answered_at, "own": own,
              **({"named_fact": None} if own else {})},
    ))


async def fetch_posting_text(db: AsyncSession, job_id: uuid.UUID) -> tuple[str | None, str | None, str | None]:
    """One job posting's company, title and description, as saved."""
    row = (
        await db.execute(select(Job_Post.company_name, Job_Post.title, Job_Post.description).where(Job_Post.id == job_id))
    ).first()
    return (row.company_name, row.title, row.description) if row else (None, None, None)


async def fetch_application_companies(db: AsyncSession, applicant_id: uuid.UUID) -> list[str]:
    """The companies of every job posting the applicant has an application
    for, at any stage, each once."""
    rows = await db.scalars(
        select(Job_Post.company_name)
        .join(Job_Application, Job_Application.job_id == Job_Post.id)
        .where(Job_Application.applicant_id == applicant_id, Job_Post.company_name.is_not(None))
        .distinct()
    )
    return list(rows)


@dataclass(frozen=True)
class SavedAnswer:
    """An answer saved to one application's question, and the company of
    its job posting."""

    question: str
    # a choice's answer brought from Apply may be the options ticked
    answer: str | list[str]
    company: str | None
    # the student's own words, not their Claude's (KAN-379)
    own: bool = False
    # an option (or options) picked, not words: WorkIt's writing checks don't apply
    choice: bool = False


async def fetch_saved_answers(
    db: AsyncSession, applicant_id: uuid.UUID, exclude: uuid.UUID | None = None
) -> list[SavedAnswer]:
    """Every answer the applicant has saved to an application's question,
    the student's own first (KAN-379), then newest first, but those of the
    job `exclude`."""
    query = (
        select(Written_Answer.label, Written_Answer.answer, Written_Answer.own, Written_Answer.kind, Job_Post.company_name)
        .join(Job_Post, Job_Post.id == Written_Answer.job_id)
        .where(Written_Answer.applicant_id == applicant_id, Written_Answer.answer.is_not(None))
        .order_by(Written_Answer.own.desc(), Written_Answer.answered_at.desc(), Written_Answer.job_id, Written_Answer.name)
    )
    if exclude is not None:
        query = query.where(Written_Answer.job_id != exclude)
    return [
        SavedAnswer(question=r.label, answer=r.answer, company=r.company_name, own=r.own, choice=r.kind is not None)
        for r in await db.execute(query)
    ]


async def fetch_brought_answers(db: AsyncSession, applicant_id: uuid.UUID) -> list[SavedAnswer]:
    """The answers the student brought from Apply (`fill_answers`, in the
    order they were filed), each their own. An entry with no answer is left out."""
    answers = await db.scalar(select(Applicant_Profile.fill_answers).where(Applicant_Profile.id == applicant_id))
    return [
        SavedAnswer(question=question, answer=entry["answer"], company=entry.get("company"), own=bool(entry.get("own", True)))
        for question, entry in (answers or {}).items()
        if isinstance(entry, dict) and entry.get("answer") not in (None, "", [])
    ]
