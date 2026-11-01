"""Built resumes under /applicants/{applicant_id}/built-resumes (KAN-207).
Every route checks the token's account owns `applicant_id` first; another
applicant's resume answers 404. The rules (the default resume) live in `app/services/built_resumes.py`; what shows on a resume is
`app/services/resume_view.py`.

POST   /applicants/{id}/built-resumes              BuiltResumeCreate -> 201 BuiltResumeResponse
       Generate: a base resume with every bank entry, bullet and skill. With
       no name it is "Resume #N", one past the highest number in use. No
       limit: only uploads count toward the 5 (KAN-268). 409
       {"detail": {"message": "Duplicate Resume found: <name>",
       "built_resume_id"}} when the new resume would print the same as one
       the student has (KAN-267); nothing is written.
GET    /applicants/{id}/built-resumes              -> [BuiltResumeResponse], newest first
       `posting_closed` is true for a tailored resume whose posting the Jobs
       page no longer lists (story 90's "Posting closed"). `posting_title`
       and `posting_company` name a tailored resume's posting, for its
       card's link back to it (KAN-268); null on a base resume. `edited_at` is
       the last change to the resume itself (its choices or its name); it
       equals `created_at` until the first one.
PATCH  /applicants/{id}/built-resumes/{rid}        BuiltResumeRename -> BuiltResumeResponse
       Rename (KAN-258). Its sent resumes keep the name they went out under.
DELETE /applicants/{id}/built-resumes/{rid}        -> 204
PUT    /applicants/{id}/built-resumes/{rid}/default -> {"default_built_resume_id"}
       Makes a base or tailored resume the default resume, clearing an
       uploaded default. A tailored one could not be until KAN-268.
GET    /applicants/{id}/built-resumes/{rid}/render -> RenderResponse
       {pdf (base64), file_name, page_count, lines_over, missing_characters, boxes}:
       the name the PDF downloads under, the characters
       the template's font cannot draw, for the warning before download, and
       a box per line for the editor's click targets (schemas: RenderBox).
       The editor's Download PDF takes this file and keeps nothing (KAN-267).
       503 {detail} when Tectonic is missing or the compile fails.
GET    /applicants/{id}/built-resumes/{rid}/choices -> ChoicesResponse
       The resume's choice rows (KAN-218): what shows, in what order, the
       GPA and coursework toggles. A bank item with no row is not on it.
PATCH  /applicants/{id}/built-resumes/{rid}/choices ChoicesUpdate -> ChoicesResponse
       The editor's hide, show, move and toggles, all saved together. An
       item with no row gets one. 404 for an item outside the bank. Written
       in one statement with no read first when every change finds its row
       (KAN-391); `?read_back=false` answers 204 instead of the choices, so
       the save reads nothing.
POST   /applicants/{id}/built-resumes/{rid}/render EditRender -> EditRendered
       The editor's edit rendered, never saved (KAN-391): a typed `line`
       ({item_id, kind, text}) or choice `changes` (the PATCH .../choices
       body), made in memory to the editor's copy (`source`, ResumeCopy,
       required, with the template and file name of the last render). Reads
       no database: the token is checked by its signature alone
       (deps.token_applicant), and nothing of the resume is read. Answers
       the render and what the edit changed in the copy (`choices`,
       `entry`; the header is `render.identity`). 422 for text the save
       would refuse or an unknown template, 404 for an item outside the
       copy, 503 like render.
PUT    /applicants/{id}/built-resumes/{rid}/lines  LineSave -> LineSaved
       One typed line saved, with no read first (KAN-391): one statement
       per kind, whose WHERE checks ownership. The API reads the text
       (services/resume_lines.py): a bullet becomes this resume's wording
       (`variant_id` answered, null when the original is typed back), an
       entry field changes the bank, checked whole against `source`'s copy
       of the entry (read when none is sent), a header field the profile
       (`profile` answered). 422 {detail} for text it cannot save (an
       empty title, a GPA that is not a number, a kind not typed here),
       404 for an item that is not the applicant's.
GET    /applicants/{id}/built-resumes/{rid}/changed-at -> ResumeChanged {changed_at, now}
       When anything the page prints last changed (the resume, the bank,
       the profile) and the database's clock, in one read: the editor asks
       on a return to its tab after a while away (KAN-391). 404 for a
       resume that is not the applicant's.
POST   /applicants/{id}/built-resumes/{rid}/fit    -> FitResponse {hidden, undo, render}
       Fit to One Page (docs/cut_to_one_page.md): hides bullets, whole
       entries and skills in services/fit_page.py's order (by the posting's
       rank on a tailored resume, by position on any other) until a render
       is one page, which it always reaches. Each cut is checked against
       the last render by prediction; a render confirms, about two in all.
       It saves every cut together at the end. `undo` is the PATCH
       .../choices body that shows them all again.
       Each render gets a second try (FIT_RENDER_TRIES); 503 like render
       when one fails twice, and then nothing is saved.
GET    /applicants/{id}/built-resumes/{rid}/docx   -> the Word file, as an attachment:
       the editor's Download Word, which keeps nothing (KAN-267)
GET    /applicants/{id}/built-resumes/{rid}/tex    -> the LaTeX source, as an attachment:
       the editor's Download LaTeX, the PDF's .tex without its position
       markers, for Overleaf. Needs no Tectonic. Keeps nothing.
GET    /applicants/{id}/built-resumes/{rid}/keyword-match?job_posting_id=
       -> KeywordMatchResponse {job_posting_id, matched, missing, uses_left}
       The keyword match ("12 of 18") against a posting; with no
       job_posting_id, a tailored resume's own posting (else 422). The
       posting's keywords are extracted once and cached
       (app/services/keywords.py); only an extraction spends a Tailor use:
       429 at the limit, 503 when the model fails or answers out of schema
       (nothing counted). 404 for a posting the Jobs page does not list,
       unless it is the tailored resume's own.
"""

import asyncio
import base64
import dataclasses
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer
from workit_scout.llm import LLM, ScoutUnavailable

from app.db import get_session
from app.deps import owned_applicant, token_applicant
from app.models.built_resume import Built_Resume
from app.models.jobs import Job_Post
from app.models.profiles import Applicant_Profile
from app.schemas.bank import EntryResponse
from app.schemas.built_resume import (
    BuiltResumeCreate,
    BuiltResumeRename,
    BuiltResumeResponse,
    ChoicesResponse,
    ChoicesUpdate,
    EditRender,
    EditRendered,
    FitResponse,
    LineSave,
    LineSaved,
    RenderBox,
    RenderResponse,
    ResumeChanged,
)
from app.schemas.keywords import KeywordMatchResponse
from app.schemas.profile import ApplicantProfileResponse, ApplicantProfileUpdate
from app.services import bank, keywords, postings, resume_copy, resume_lines
from app.services import built_resumes as service
from app.services.ai_messages import AIMessages
from app.services.bank import NotFound
from app.services.models import get_small_llm
from app.services.names import name_columns
from app.services.resume_copy import identity_copy
from app.services.resume_render import (
    HEADER,
    HeaderIdentity,
    Rendered,
    TectonicUnavailable,
    latex,
    render,
)
from app.services.resume_render.word import render_docx
from app.services.resume_view import build_view
from app.services.usage import Feature, count_use, uses_left

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applicants/{applicant_id}/built-resumes", tags=["built-resumes"])

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _response(
    row: Built_Resume, default_id: uuid.UUID | None, posting: service.TailoredPosting | None = None
) -> BuiltResumeResponse:
    return BuiltResumeResponse(
        id=row.id, name=row.name, template=row.template, job_posting_id=row.job_posting_id,
        is_default=row.id == default_id, created_at=row.created_at, edited_at=row.updated_at,
        posting_closed=posting.closed if posting else False,
        posting_title=posting.title if posting else None,
        posting_company=posting.company if posting else None,
    )


async def _commit(session: AsyncSession, failure: str) -> None:
    try:
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        logger.exception(failure)
        raise HTTPException(500, failure)


async def _identity(session: AsyncSession, applicant_id: uuid.UUID) -> HeaderIdentity:
    try:
        return await service.load_header_identity(session, applicant_id)
    except NotFound:
        raise HTTPException(404, "Applicant not found")


async def _owned(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> Built_Resume:
    try:
        return await service.get_resume(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")


@router.post("", status_code=201, response_model=BuiltResumeResponse)
async def generate(
    body: BuiltResumeCreate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BuiltResumeResponse:
    try:
        resume = await service.generate(session, applicant_id, body.name, refuse_duplicate=True)
    except service.DuplicateResume as exc:
        raise HTTPException(409, {"message": str(exc), "built_resume_id": str(exc.resume.id)})
    default_id = await service.default_built_id(session, applicant_id)
    await _commit(session, "Failed to save the resume")
    return _response(resume, default_id)


@router.get("", response_model=list[BuiltResumeResponse])
async def list_built_resumes(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> list[BuiltResumeResponse]:
    default_id = await service.default_built_id(session, applicant_id)
    postings = await service.tailored_postings(session, applicant_id)
    return [_response(r, default_id, postings.get(r.id)) for r in await service.list_resumes(session, applicant_id)]


@router.patch("/{resume_id}", response_model=BuiltResumeResponse)
async def rename_built_resume(
    resume_id: uuid.UUID,
    body: BuiltResumeRename,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BuiltResumeResponse:
    try:
        resume = await service.rename(session, applicant_id, resume_id, body.name)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    await _commit(session, "Failed to rename the resume")
    default_id = await service.default_built_id(session, applicant_id)
    posting = (await service.tailored_postings(session, applicant_id)).get(resume.id)
    return _response(resume, default_id, posting)


@router.delete("/{resume_id}", status_code=204)
async def delete_built_resume(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await _owned(session, applicant_id, resume_id)
    await service.delete_resume(session, applicant_id, resume_id)
    await _commit(session, "Failed to delete the resume")
    return Response(status_code=204)


@router.put("/{resume_id}/default")
async def set_default(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        await service.set_default(session, applicant_id, built_id=resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    await _commit(session, "Failed to set the default resume")
    return {"default_built_resume_id": str(resume_id)}


@router.get("/{resume_id}/render", response_model=RenderResponse)
async def render_pdf(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> RenderResponse:
    try:
        resume, view = await service.load_view(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    identity = await _identity(session, applicant_id)
    return _render_response(await _render(view, identity, resume.template), resume.name, identity, resume.template)


RENDER_FAILED = "The PDF could not be made. Try again, or download the Word file."


# Fit to One Page renders two or three times in one request and saves only
# at the end, so one failed compile would throw away the whole run: each of
# its renders gets a second try. A compile that fails twice fails the
# request, with nothing saved.
FIT_RENDER_TRIES = 2


async def _render(view, identity: HeaderIdentity, template: str, tries: int = 1) -> Rendered:
    for attempt in range(1, tries + 1):
        try:
            return await asyncio.to_thread(render, view, identity, template)
        except TectonicUnavailable as exc:
            if attempt == tries:
                logger.error("resume render failed: %s", exc)
                raise HTTPException(503, RENDER_FAILED) from exc
            logger.warning("resume render failed, trying again: %s", exc)
    raise AssertionError("tries must be at least 1")


def _render_response(
    rendered: Rendered, name: str, identity: HeaderIdentity, template: str
) -> RenderResponse:
    return RenderResponse(
        pdf=base64.b64encode(rendered.pdf).decode("ascii"),
        file_name=service.file_name(name, "pdf"),
        page_count=rendered.page_count,
        lines_over=rendered.lines_over,
        missing_characters=list(rendered.missing_characters),
        boxes=[RenderBox(**vars(box)) for box in rendered.boxes],
        identity=identity_copy(identity),
        template=template,
    )


@router.post("/{resume_id}/fit", response_model=FitResponse)
async def fit(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> FitResponse:
    resume = await _owned(session, applicant_id, resume_id)
    identity = await _identity(session, applicant_id)

    async def draw(view) -> Rendered:
        return await _render(view, identity, resume.template, tries=FIT_RENDER_TRIES)

    cuts, rendered = await service.fit_to_one_page(session, applicant_id, resume_id, draw)
    await _commit(session, "Failed to save the resume")
    return FitResponse(
        hidden=[c.id for c in cuts if c.kind == "bullet"],
        undo=ChoicesUpdate(**service.fit_changes(cuts, hide=False)),
        render=_render_response(rendered, resume.name, identity, resume.template),
    )


@router.get("/{resume_id}/changed-at", response_model=ResumeChanged)
async def changed_at(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> ResumeChanged:
    try:
        changed, now = await service.changed_at(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    return ResumeChanged(changed_at=changed, now=now)


@router.get("/{resume_id}/choices", response_model=ChoicesResponse)
async def get_choices(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> ChoicesResponse:
    await _owned(session, applicant_id, resume_id)
    return await service.choices_response(session, resume_id)


@router.patch("/{resume_id}/choices", response_model=ChoicesResponse | None)
async def update_choices(
    body: ChoicesUpdate,
    resume_id: uuid.UUID,
    read_back: bool = True,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> ChoicesResponse | Response:
    # Written with no read first when every change finds its row
    # (`service.save_choices`, KAN-391). The editor asks `read_back=false`:
    # it renders through POST .../render and needs nothing back, so the
    # save stays writes only
    try:
        await service.save_choices(
            session, applicant_id, resume_id,
            entries=[c.model_dump(exclude_unset=True) for c in body.entries],
            bullets=[c.model_dump(exclude_unset=True) for c in body.bullets],
            skills=[c.model_dump(exclude_unset=True) for c in body.skills],
        )
    except NotFound:
        raise HTTPException(404, "Resume or bank item not found")
    await _commit(session, "Failed to save the resume")
    if not read_back:
        return Response(status_code=204)
    return await service.choices_response(session, resume_id)


@router.post("/{resume_id}/render", response_model=EditRendered)
async def render_edit(
    body: EditRender,
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(token_applicant),
) -> EditRendered:
    # The editor's edit, rendered and never saved (KAN-391): made in memory
    # to its copy and compiled, with no database at all. The token is
    # checked without a read (`token_applicant`), and nothing of the resume
    # is read: the copy carries its template and file name, and the PDF
    # prints only what the student sent, so the path's resume needs no
    # ownership check here. The save goes separately and writes with its
    # own check (PUT .../lines, PATCH .../choices).
    source = body.source
    held, choices, identity = resume_copy.from_copy(source)
    variants = source.choices.variants
    entry = None
    after = choices
    try:
        if body.line is not None:
            line = _parse(body.line)
            if line.target == "bullet":
                after = service.apply_choices(held, choices, bullets=[{"bullet_id": body.line.item_id, **line.changes}])
            elif line.target == "entry":
                found = next((e for e in held.entries if e.row.id == body.line.item_id), None)
                if found is None:
                    raise NotFound
                bank.edit_entry(found.row, line.changes)
                entry = EntryResponse.model_validate({
                    **bank.entry_fields(found.row), "id": found.row.id, "copy_group": bank.copy_group(found.row),
                })
            else:
                identity = _with_header(identity, line.changes)
        else:
            changes = {kind: [c.model_dump(exclude_unset=True) for c in getattr(body.changes, kind)]
                       for kind in ("entries", "bullets", "skills")}
            after = service.apply_choices(held, choices, **changes, variant_text={v.id: v.text for v in variants})
    except resume_lines.LineError as exc:
        raise HTTPException(422, str(exc))
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False, include_context=False))
    except NotFound:
        raise HTTPException(404, "Resume or bank item not found")
    try:
        rendered = await _render(build_view(held, after), identity, source.template)
    except ValueError:
        raise HTTPException(422, "Unknown template")
    response = _render_response(rendered, "", identity, source.template)
    return EditRendered(
        # The copy's file name, from the last render: the name is not read
        render=response.model_copy(update={"file_name": source.file_name}),
        choices=service.choices_out(after, variants) if after is not choices else None,
        entry=entry,
    )


def _parse(line) -> resume_lines.Line:
    parsed = resume_lines.parse(line.kind, line.text)
    if (parsed.target == "header") != (line.item_id == HEADER):
        raise resume_lines.LineError("This line is not typed here.")
    return parsed


def _with_header(identity: HeaderIdentity, changes: dict) -> HeaderIdentity:
    """The header after a typed header field, in memory, checked as My
    Profile's PATCH checks it."""
    ApplicantProfileUpdate.model_validate(changes)
    field, value = next(iter(changes.items()))
    if field == "full_name":
        return dataclasses.replace(identity, name=name_columns(value)["full_name"])
    if field == "phone_number":
        return dataclasses.replace(identity, phone=value)
    links = dict(identity.links)
    links[field] = value
    order = ("linkedin_url", "github_url", "portfolio_url", "other_url")
    return dataclasses.replace(identity, links=tuple((f, links[f]) for f in order if links.get(f)))


@router.put("/{resume_id}/lines", response_model=LineSaved)
async def save_line(
    body: LineSave,
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> LineSaved:
    # The save alone, written with no read first (KAN-391): each kind of
    # line is one statement whose WHERE checks the row is the applicant's.
    # A typed entry field is checked whole against the editor's copy of the
    # entry, read only when no copy is sent. The editor renders through
    # POST .../render beside it and does not wait for this answer.
    saved = LineSaved()
    try:
        line = _parse(body)
        if line.target == "bullet":
            saved.variant_id = await service.type_wording(
                session, applicant_id, resume_id, body.item_id, line.changes["text"])
        elif line.target == "entry":
            current = None
            if body.source is not None:
                held = resume_copy.from_copy(body.source)[0]
                current = next((bank.entry_fields(e.row) for e in held.entries if e.row.id == body.item_id), None)
            if current is None:
                current = bank.entry_fields(await bank.entry_row(session, applicant_id, body.item_id))
            await bank.write_entry(session, applicant_id, body.item_id, current, line.changes)
        else:
            saved.profile = await _write_header(session, applicant_id, line.changes)
    except resume_lines.LineError as exc:
        raise HTTPException(422, str(exc))
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False, include_context=False))
    except NotFound:
        raise HTTPException(404, "Resume or bank item not found")
    await _commit(session, "Failed to save the resume")
    return saved


async def _write_header(session: AsyncSession, applicant_id: uuid.UUID, changes: dict) -> ApplicantProfileResponse:
    """A header field on the profile in one UPDATE, checked as My Profile's
    PATCH checks it; a name typed whole is split into its parts there too
    (routers/profiles.py)."""
    ApplicantProfileUpdate.model_validate(changes)
    values = {}
    for field, value in changes.items():
        values.update(name_columns(value) if field == "full_name" else {field: value})
    profile = (await session.scalars(
        update(Applicant_Profile).where(Applicant_Profile.id == applicant_id).values(**values)
        .returning(Applicant_Profile))).first()
    if profile is None:
        raise NotFound
    return ApplicantProfileResponse.model_validate(profile)


@router.get("/{resume_id}/docx")
async def download_docx(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    try:
        resume, view = await service.load_view(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    identity = await _identity(session, applicant_id)
    data = await asyncio.to_thread(render_docx, view, identity)
    return Response(
        data,
        media_type=DOCX_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{service.file_name(resume.name, "docx")}"'},
    )


@router.get("/{resume_id}/tex")
async def download_tex(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    try:
        resume, view = await service.load_view(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    identity = await _identity(session, applicant_id)
    return Response(
        latex(view, identity, resume.template),
        media_type="application/x-tex",
        headers={"Content-Disposition": f'attachment; filename="{service.file_name(resume.name, "tex")}"'},
    )


AI = AIMessages(
    spent="You've used today's Tailor runs. They reset at midnight UTC.",
    offline="WorkIt can't read this posting's keywords right now. Try again in a minute.",
    lost="WorkIt couldn't make sense of this posting's keywords. Try again.",
)


@router.get("/{resume_id}/keyword-match", response_model=KeywordMatchResponse)
async def keyword_match(
    resume_id: uuid.UUID,
    job_posting_id: uuid.UUID | None = Query(None),
    applicant_id: uuid.UUID = Depends(owned_applicant),
    llm: LLM = Depends(get_small_llm),
    session: AsyncSession = Depends(get_session),
) -> KeywordMatchResponse:
    try:
        resume, view = await service.load_view(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    posting_id = job_posting_id or resume.job_posting_id
    if posting_id is None:
        raise HTTPException(422, "Choose a job posting to match against")
    if posting_id == resume.job_posting_id:
        # A tailored resume keeps its own posting's match after it closes.
        job = await session.get(
            Job_Post, posting_id, options=[undefer(Job_Post.keywords), undefer(Job_Post.keywords_hash)])
    else:
        job = await postings.listed(session, posting_id, keywords=True)
    if job is None:
        raise HTTPException(404, "Job posting not found")

    left = await uses_left(session, applicant_id, Feature.TAILOR)
    if keywords.cached(job) is None and left <= 0:
        raise HTTPException(429, AI.spent)
    try:
        found, extracted = await keywords.ensure(job, llm)
    except ScoutUnavailable as exc:
        raise HTTPException(503, AI.failure(exc)) from exc
    if extracted:
        await count_use(session, applicant_id, Feature.TAILOR)
        # One commit: the cache and the count.
        await session.commit()
        left -= 1
    matched, missing = keywords.match(view, found)
    return KeywordMatchResponse(job_posting_id=job.id, matched=matched, missing=missing, uses_left=left)
