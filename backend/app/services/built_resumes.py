"""
Built resumes (KAN-207): Generate, the 5-upload limit, the default resume,
and loading one resume's view. Like services/bank.py, every function takes
the applicant id and touches only that applicant's rows (another applicant's
resume answers `NotFound`), and flushes but never commits.

- **The limit:** uploaded resumes, at most `MAX_RESUMES`. Built resumes
  (base and tailored) and sent resumes do not count, so Generate has no
  limit (KAN-268; base resumes counted until then). `check_room` runs on
  upload, before anything is written.
- **The default resume** is `applicant_profiles.default_resume_id` (an
  uploaded resume) or `default_built_resume_id` (a base or a tailored
  resume; a tailored one could not be the default until KAN-268), never both:
  setting one clears the other, and a check constraint backs it. A student
  with exactly one resume has it as the default (`default_if_only`).
- **Names and edits** (KAN-258): a resume made with no name is "Resume #N"
  (`next_name`), and `rename` changes it. A resume's `updated_at` is when it
  last changed itself (`touch`): its choice rows have their own, which the
  list would have to read row by row.
- **Duplicates** (KAN-267): Generate with `refuse_duplicate` raises
  `DuplicateResume` when the new resume would print the same as one the
  student has: the same template and the same view (`build_view`), built
  now from today's bank. Nothing is stored to compare against: an edit in
  the editor or the bank changes a resume's content, so a stored hash would
  go stale. Tailor's own Generate does not refuse: it runs only when there
  is no base resume.
"""

import dataclasses
import re
import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank import Bank_Bullet_Variant
from app.models.built_resume import (
    Built_Resume,
    Built_Resume_Bullet,
    Built_Resume_Entry,
    Built_Resume_Skill,
)
from app.models.jobs import Job_Post
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.schemas.built_resume import (
    BulletChoiceResponse,
    ChoicesResponse,
    EntryChoiceResponse,
    SkillChoiceResponse,
    VariantResponse,
)
from app.services.bank import Bank, NotFound, copy_key, get_entry, load_bank
from app.services.postings import LISTED
from app.services.resume_render import HeaderIdentity, Rendered, line_count
from app.services.resume_view import (
    BulletChoice,
    Choices,
    Cut,
    EntryChoice,
    ResumeView,
    SkillChoice,
    all_chosen,
    build_view,
    fit_order,
)

MAX_RESUMES = 5
DEFAULT_TEMPLATE = "jakes"


class ResumeLimitReached(Exception):
    def __init__(self) -> None:
        super().__init__(
            f"You can upload up to {MAX_RESUMES} resumes. Delete one to upload another."
        )


async def check_room(session: AsyncSession, applicant_id: uuid.UUID) -> None:
    """Raise ResumeLimitReached when one more upload would pass the limit.
    Two requests at once can both pass; the limit errs toward the student."""
    uploaded = await session.scalar(select(func.count()).where(Resume.applicant_id == applicant_id))
    if (uploaded or 0) >= MAX_RESUMES:
        raise ResumeLimitReached


NUMBERED = re.compile(r"Resume #(\d+)")


async def next_name(session: AsyncSession, applicant_id: uuid.UUID) -> str:
    """The name of a resume made with no name: "Resume #N", one past the
    highest number the student's resumes carry, so a new resume never takes
    the name of one still there. Every one was "Base Resume" until KAN-258,
    so a student's list read as one name repeated."""
    names = await session.scalars(select(Built_Resume.name).where(Built_Resume.applicant_id == applicant_id))
    used = [int(match[1]) for name in names if (match := NUMBERED.fullmatch(name))]
    return f"Resume #{max(used, default=0) + 1}"


class DuplicateResume(Exception):
    """Generate would make a resume that prints the same as `resume`."""

    def __init__(self, resume: Built_Resume) -> None:
        super().__init__(f"Duplicate Resume found: {resume.name}")
        self.resume = resume


async def generate(
    session: AsyncSession, applicant_id: uuid.UUID, name: str | None = None, *, refuse_duplicate: bool = False
) -> Built_Resume:
    """A base resume with every bank entry, bullet and skill, in the bank's
    order (the fixed section order, newest first), except a copy of an entry
    already on it (`copy_key`), which waits hidden in "Not on This Resume":
    two copies of one job sent a resume to two pages. With no name it is
    "Resume #N" (`next_name`). With `refuse_duplicate`, raises
    DuplicateResume before writing anything when the student already has a
    resume that prints the same."""
    bank = await load_bank(session, applicant_id)
    choices = all_chosen(bank)
    seen: set[tuple] = set()
    for entry in bank.entries:
        if copy_key(entry.row) in seen:
            choices.entries[entry.row.id] = dataclasses.replace(choices.entries[entry.row.id], shown=False)
        seen.add(copy_key(entry.row))
    if refuse_duplicate and (same := await same_resume(session, applicant_id, bank, build_view(bank, choices))):
        raise DuplicateResume(same)

    name = name or await next_name(session, applicant_id)
    resume = Built_Resume(id=uuid.uuid4(), applicant_id=applicant_id, name=name, template=DEFAULT_TEMPLATE)
    session.add(resume)
    # No relationship() orders the inserts (models/CLAUDE.md): the resume
    # goes in before its choice rows.
    await session.flush()
    await write_choices(session, resume.id, choices)
    await default_if_only(session, applicant_id)
    await session.refresh(resume)
    return resume


async def write_choices(session: AsyncSession, resume_id: uuid.UUID, choices: Choices) -> None:
    """Replace the resume's choice rows with `choices`. The caller has
    checked that every id is the applicant's (a variant, that it belongs to
    its bullet)."""
    for table in (Built_Resume_Entry, Built_Resume_Bullet, Built_Resume_Skill):
        await session.execute(delete(table).where(table.built_resume_id == resume_id))
    session.add_all(
        [Built_Resume_Entry(built_resume_id=resume_id, entry_id=i, shown=c.shown, position=c.position,
                            show_gpa=c.show_gpa, show_coursework=c.show_coursework)
         for i, c in choices.entries.items()]
        + [Built_Resume_Bullet(built_resume_id=resume_id, bullet_id=i, shown=c.shown, position=c.position,
                               variant_id=c.variant_id)
           for i, c in choices.bullets.items()]
        + [Built_Resume_Skill(built_resume_id=resume_id, skill_id=i, shown=c.shown, position=c.position)
           for i, c in choices.skills.items()]
    )
    await session.flush()
    await touch(session, resume_id)


async def touch(session: AsyncSession, resume_id: uuid.UUID) -> None:
    """Mark the resume changed now: its `updated_at` is the list's "Last
    edited" (KAN-258), and a change to its choice rows alone leaves it as it
    was. now() is the transaction's start, so a resume made and written in
    one request stays unedited, its `updated_at` equal to its `created_at`."""
    await session.execute(update(Built_Resume).where(Built_Resume.id == resume_id).values(updated_at=func.now()))


async def rename(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID, name: str) -> Built_Resume:
    """Give the resume a new name (KAN-258). A sent resume keeps the name it
    was sent under, so the Sent list still says what went out."""
    resume = await get_resume(session, applicant_id, resume_id)
    resume.name = name
    await session.flush()
    # The flush expires updated_at, the database's now(); reading it
    # expired would lazy-load, which fails in async code.
    await session.refresh(resume)
    return resume


async def list_resumes(session: AsyncSession, applicant_id: uuid.UUID) -> list[Built_Resume]:
    """Newest first."""
    rows = await session.scalars(
        select(Built_Resume)
        .where(Built_Resume.applicant_id == applicant_id)
        .order_by(Built_Resume.created_at.desc(), Built_Resume.id)
    )
    return list(rows)


async def count_showing_entry(session: AsyncSession, applicant_id: uuid.UUID, entry_id: uuid.UUID) -> int:
    """How many of the applicant's built resumes show the entry: what the
    delete confirm names (story 18). A resume that hides it is not counted:
    deleting the entry changes nothing there. NotFound for an entry that is
    not the applicant's."""
    await get_entry(session, applicant_id, entry_id)
    return await session.scalar(
        select(func.count())
        .select_from(Built_Resume_Entry)
        .join(Built_Resume, Built_Resume.id == Built_Resume_Entry.built_resume_id)
        .where(
            Built_Resume.applicant_id == applicant_id,
            Built_Resume_Entry.entry_id == entry_id,
            Built_Resume_Entry.shown,
        )
    ) or 0


@dataclasses.dataclass(frozen=True)
class TailoredPosting:
    """A tailored resume's posting, as its card shows it (KAN-268). `closed`
    when the Jobs page no longer lists it: "Posting closed" (story 90),
    and its page answers 404, so the card drops the link. The resume stays
    usable; only Tailor needs a listed posting."""

    title: str
    company: str | None
    closed: bool


async def tailored_postings(session: AsyncSession, applicant_id: uuid.UUID) -> dict[uuid.UUID, TailoredPosting]:
    """Each of the applicant's tailored resumes' postings, by resume id."""
    rows = await session.execute(
        select(Built_Resume.id, Job_Post.title, Job_Post.company_name, LISTED.label("listed"))
        .join(Job_Post, Job_Post.id == Built_Resume.job_posting_id)
        .where(Built_Resume.applicant_id == applicant_id)
    )
    return {r.id: TailoredPosting(r.title, r.company_name, not r.listed) for r in rows}


async def latest_base(session: AsyncSession, applicant_id: uuid.UUID) -> Built_Resume | None:
    return await session.scalar(
        select(Built_Resume)
        .where(Built_Resume.applicant_id == applicant_id, Built_Resume.job_posting_id.is_(None))
        .order_by(Built_Resume.created_at.desc(), Built_Resume.id)
        .limit(1)
    )


async def tailored_for(session: AsyncSession, applicant_id: uuid.UUID, posting_id: uuid.UUID) -> Built_Resume | None:
    """The applicant's one tailored resume for the posting, if any."""
    return await session.scalar(
        select(Built_Resume).where(
            Built_Resume.applicant_id == applicant_id, Built_Resume.job_posting_id == posting_id)
    )


async def get_resume(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> Built_Resume:
    row = await session.scalar(
        select(Built_Resume).where(Built_Resume.id == resume_id, Built_Resume.applicant_id == applicant_id)
    )
    if row is None:
        raise NotFound
    return row


async def delete_resume(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> None:
    """Its choice rows go with it; a default pointing at it is cleared
    (ON DELETE SET NULL), and the one resume left, if one is, becomes it."""
    await session.delete(await get_resume(session, applicant_id, resume_id))
    await session.flush()
    await default_if_only(session, applicant_id)


async def default_built_id(session: AsyncSession, applicant_id: uuid.UUID) -> uuid.UUID | None:
    return await session.scalar(
        select(Applicant_Profile.default_built_resume_id).where(Applicant_Profile.id == applicant_id)
    )


async def set_default(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    *,
    uploaded_id: uuid.UUID | None = None,
    built_id: uuid.UUID | None = None,
) -> None:
    """Point the default at one resume and clear the other pointer. A built
    one may be tailored (KAN-268): the student picked it, and Apply and auto
    apply still take the resume tailored to a posting first. Raises NotFound
    for another applicant's built resume."""
    if built_id is not None:
        await get_resume(session, applicant_id, built_id)
    await session.execute(
        update(Applicant_Profile)
        .where(Applicant_Profile.id == applicant_id)
        .values(default_resume_id=uploaded_id, default_built_resume_id=built_id)
    )


async def default_if_only(session: AsyncSession, applicant_id: uuid.UUID) -> None:
    """A student with one resume (uploaded or base) has it as the default,
    so auto apply and Apply have a resume without a star click first. Called
    after every add and delete; with two or more it changes nothing."""
    # The session does not autoflush (app/db.py): a resume added but not
    # flushed would not be counted.
    await session.flush()
    uploaded = (await session.scalars(
        select(Resume.id).where(Resume.applicant_id == applicant_id).limit(2))).all()
    base = (await session.scalars(
        select(Built_Resume.id).where(
            Built_Resume.applicant_id == applicant_id, Built_Resume.job_posting_id.is_(None)
        ).limit(2))).all()
    if len(uploaded) + len(base) != 1:
        return
    await session.execute(
        update(Applicant_Profile)
        .where(Applicant_Profile.id == applicant_id)
        .values(default_resume_id=next(iter(uploaded), None), default_built_resume_id=next(iter(base), None))
    )


async def load_choices(session: AsyncSession, resume_id: uuid.UUID) -> Choices:
    return (await _choices_of(session, [resume_id])).get(resume_id, Choices())


async def _choices_of(session: AsyncSession, resume_ids: list[uuid.UUID]) -> dict[uuid.UUID, Choices]:
    """Each resume's choice rows, three queries for any number of resumes."""
    entries = await session.scalars(
        select(Built_Resume_Entry).where(Built_Resume_Entry.built_resume_id.in_(resume_ids)))
    bullets = await session.execute(
        select(Built_Resume_Bullet, Bank_Bullet_Variant.text)
        .outerjoin(Bank_Bullet_Variant, Bank_Bullet_Variant.id == Built_Resume_Bullet.variant_id)
        .where(Built_Resume_Bullet.built_resume_id.in_(resume_ids)))
    skills = await session.scalars(
        select(Built_Resume_Skill).where(Built_Resume_Skill.built_resume_id.in_(resume_ids)))
    found = {i: Choices() for i in resume_ids}
    for r in entries:
        found[r.built_resume_id].entries[r.entry_id] = EntryChoice(r.shown, r.position, r.show_gpa, r.show_coursework)
    for r, wording in bullets:
        found[r.built_resume_id].bullets[r.bullet_id] = BulletChoice(r.shown, r.position, r.variant_id, wording)
    for r in skills:
        found[r.built_resume_id].skills[r.skill_id] = SkillChoice(r.shown, r.position)
    return found


async def same_resume(
    session: AsyncSession, applicant_id: uuid.UUID, bank: Bank, view: ResumeView, template: str = DEFAULT_TEMPLATE
) -> Built_Resume | None:
    """The applicant's built resume (base or tailored) that prints the same
    as `view` in `template` today, if any. `bank` is the applicant's, loaded
    once by the caller. Compares the views themselves: equal views are what
    an equal content hash would say, without hashing either."""
    resumes = await list_resumes(session, applicant_id)
    choices = await _choices_of(session, [r.id for r in resumes])
    return next((r for r in resumes if r.template == template and build_view(bank, choices[r.id]) == view), None)


async def update_choices(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    entries: list[dict] = (),
    bullets: list[dict] = (),
    skills: list[dict] = (),
) -> None:
    """The editor's changes to one resume's choice rows (KAN-218), each a dict
    with the bank item's id (`entry_id`, `bullet_id`, `skill_id`) and only
    the fields that change. An item outside the applicant's bank raises
    NotFound and nothing is written. An item with no row (one in the tray
    because it joined the bank after Generate) gets one, shown, after its
    siblings; an entry brought onto the resume brings its row-less bullets
    with it, or it would show with none."""
    await get_resume(session, applicant_id, resume_id)
    bank = await load_bank(session, applicant_id)
    entry_of = {b.id: e.row.id for e in bank.entries for b in e.bullets}
    original = {b.id: b.text for e in bank.entries for b in e.bullets}
    section_of = {e.row.id: str(e.row.section) for e in bank.entries}
    bullets_of = {e.row.id: [b.id for b in e.bullets] for e in bank.entries}
    skill_ids = {s.id for s in bank.skills}
    if (any(c["entry_id"] not in section_of for c in entries)
            or any(c["bullet_id"] not in entry_of for c in bullets)
            or any(c["skill_id"] not in skill_ids for c in skills)):
        raise NotFound

    rows = {
        Built_Resume_Entry: {r.entry_id: r for r in await session.scalars(
            select(Built_Resume_Entry).where(Built_Resume_Entry.built_resume_id == resume_id))},
        Built_Resume_Bullet: {r.bullet_id: r for r in await session.scalars(
            select(Built_Resume_Bullet).where(Built_Resume_Bullet.built_resume_id == resume_id))},
        Built_Resume_Skill: {r.skill_id: r for r in await session.scalars(
            select(Built_Resume_Skill).where(Built_Resume_Skill.built_resume_id == resume_id))},
    }

    def row(model, key: str, item_id: uuid.UUID, siblings) -> object:
        found = rows[model].get(item_id)
        if found is None:
            used = [r.position for i, r in rows[model].items() if i in siblings]
            found = model(built_resume_id=resume_id, **{key: item_id}, shown=True,
                          position=max(used, default=-1) + 1)
            if model is Built_Resume_Entry:
                found.show_gpa = found.show_coursework = True
            session.add(found)
            rows[model][item_id] = found
        return found

    def apply(target: object, change: dict, key: str) -> None:
        for name, value in change.items():
            if name != key and value is not None:
                setattr(target, name, value)

    for change in entries:
        entry_id = change["entry_id"]
        siblings = {i for i, s in section_of.items() if s == section_of[entry_id]}
        apply(row(Built_Resume_Entry, "entry_id", entry_id, siblings), change, "entry_id")
        for bullet_id in bullets_of[entry_id]:
            row(Built_Resume_Bullet, "bullet_id", bullet_id, set(bullets_of[entry_id]))
    for change in bullets:
        bullet_id = change["bullet_id"]
        target = row(Built_Resume_Bullet, "bullet_id", bullet_id, set(bullets_of[entry_of[bullet_id]]))
        wording, switch = change.pop("text", None), change.pop("variant_id", _UNSET)
        apply(target, change, "bullet_id")
        if wording is not None:
            target.variant_id = await _type_wording(session, resume_id, bullet_id, original[bullet_id], wording)
        elif switch is not _UNSET:
            if switch is not None and switch not in await _offered(session, resume_id, bullet_id):
                raise NotFound
            target.variant_id = switch
    for change in skills:
        apply(row(Built_Resume_Skill, "skill_id", change["skill_id"], skill_ids), change, "skill_id")
    await session.flush()
    if entries or bullets or skills:
        await touch(session, resume_id)


async def load_view(
    session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID
) -> tuple[Built_Resume, ResumeView]:
    resume = await get_resume(session, applicant_id, resume_id)
    bank = await load_bank(session, applicant_id)
    return resume, build_view(bank, await load_choices(session, resume.id))



_UNSET = object()


async def _type_wording(
    session: AsyncSession, resume_id: uuid.UUID, bullet_id: uuid.UUID, original: str, wording: str
) -> uuid.UUID | None:
    """Save typed wording as the resume's one local variant of the bullet and
    return its id; the original typed back deletes it and returns None."""
    local = await session.scalar(select(Bank_Bullet_Variant).where(
        Bank_Bullet_Variant.built_resume_id == resume_id, Bank_Bullet_Variant.bullet_id == bullet_id))
    if wording == original.strip():
        if local is not None:
            await session.delete(local)
        return None
    if local is None:
        local = Bank_Bullet_Variant(id=uuid.uuid4(), bullet_id=bullet_id, built_resume_id=resume_id, text=wording)
        session.add(local)
        await session.flush()
    else:
        local.text = wording
    return local.id


async def _offered(session: AsyncSession, resume_id: uuid.UUID, bullet_id: uuid.UUID) -> set[uuid.UUID]:
    return {v.id for v in await list_variants(session, resume_id, [bullet_id])}


async def list_variants(
    session: AsyncSession, resume_id: uuid.UUID, bullet_ids: list[uuid.UUID]
) -> list[Bank_Bullet_Variant]:
    """The wordings a resume can show for these bullets: every Tailor
    variant, and this resume's own local ones, never another resume's."""
    if not bullet_ids:
        return []
    rows = await session.scalars(
        select(Bank_Bullet_Variant)
        .where(Bank_Bullet_Variant.bullet_id.in_(bullet_ids),
               (Bank_Bullet_Variant.built_resume_id.is_(None)) | (Bank_Bullet_Variant.built_resume_id == resume_id))
        .order_by(Bank_Bullet_Variant.created_at, Bank_Bullet_Variant.id))
    return list(rows)


FIT_ROUNDS = 8
# After the page fits, the last round's cuts it can show again, most useful
# first, one render each (about 0.3 s): `lines_over` misses headings and the
# blocks that move whole between pages, so a round can hide several too many
FIT_PUT_BACK = 4


def fit_changes(cuts: list[Cut], hide: bool) -> dict[str, list[dict]]:
    """Cuts as update_choices arguments: hidden with hide=True, shown again
    with hide=False (Fit's Undo sends that as its PATCH body)."""
    entries: list[dict] = []
    bullets: list[dict] = []
    for cut in cuts:
        if cut.kind == "bullet":
            bullets.append({"bullet_id": cut.id, "shown": not hide})
        elif cut.kind == "entry":
            entries.append({"entry_id": cut.id, "shown": not hide})
        else:
            entries.append({"entry_id": cut.id, "show_coursework": not hide})
    return {"entries": entries, "bullets": bullets}


def _cut_lines(cut: Cut, view: ResumeView, rendered: Rendered) -> int:
    """About how many lines hiding `cut` saves, read from the last render."""
    if cut.kind == "entry":
        entry = next(e for s in view.sections for e in s.entries if e.id == cut.id)
        ids = {str(cut.id), *(str(b.id) for b in entry.bullets)}
    else:
        ids = {str(cut.id)}
    boxes = [b for b in rendered.boxes
             if b.item_id in ids and (cut.kind != "coursework" or b.kind == "coursework")]
    return max(1, line_count(boxes))


async def fit_to_one_page(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    render: Callable[[ResumeView], Awaitable[Rendered]],
) -> tuple[list[Cut], Rendered]:
    """Hide what `fit_order` names, least useful first, until the resume
    renders on one page or nothing is left to cut. Each round hides about as
    many lines as the render says run over, by each cut's own boxes, then
    renders again, so a resume a few lines over costs two renders, not one
    per bullet. Once it fits, the last round's cuts after its first go back
    one at a time, most useful first, while it still fits (FIT_PUT_BACK).
    Returns the cuts (Undo shows them again) and the last render."""
    hidden: list[Cut] = []
    batch: list[Cut] = []
    _, view = await load_view(session, applicant_id, resume_id)
    rendered = await render(view)
    for _ in range(FIT_ROUNDS):
        if rendered.page_count <= 1:
            break
        candidates = fit_order(view)
        if not candidates:
            break
        need, batch = max(1, rendered.lines_over), []
        for cut in candidates:
            batch.append(cut)
            need -= _cut_lines(cut, view, rendered)
            if need <= 0:
                break
        await update_choices(session, applicant_id, resume_id, **fit_changes(batch, hide=True))
        hidden.extend(batch)
        _, view = await load_view(session, applicant_id, resume_id)
        rendered = await render(view)
    if rendered.page_count <= 1:
        # Never the round's first cut (the page needed at least one), nor a
        # bullet whose entry stays hidden: showing it changes nothing
        hidden_entries = {c.id for c in hidden if c.kind == "entry"}
        entry_of = {b.id: e.row.id for e in (await load_bank(session, applicant_id)).entries for b in e.bullets}
        tries = [c for c in reversed(batch[1:]) if entry_of.get(c.id) not in hidden_entries]
        for cut in tries[:FIT_PUT_BACK]:
            await update_choices(session, applicant_id, resume_id, **fit_changes([cut], hide=False))
            _, trial = await load_view(session, applicant_id, resume_id)
            tried = await render(trial)
            if tried.page_count > 1:
                await update_choices(session, applicant_id, resume_id, **fit_changes([cut], hide=True))
                break
            hidden.remove(cut)
            rendered = tried
    return hidden, rendered


async def load_header_identity(session: AsyncSession, applicant_id: uuid.UUID) -> HeaderIdentity:
    """The profile's identity fields a resume's header prints. Not
    `services/identity.py`'s `load_identity`, which loads the same fields
    for removal before a model sees text; this one is for display."""
    profile = await session.get(Applicant_Profile, applicant_id)
    if profile is None:
        raise NotFound
    return HeaderIdentity(
        name=profile.full_name,
        email=profile.email_for_employers,
        phone=profile.phone_number,
        links=tuple(
            (field, url)
            for field in ("linkedin_url", "github_url", "portfolio_url", "other_url")
            if (url := getattr(profile, field))
        ),
    )


def file_name(name: str, ext: str) -> str:
    """A download's file name, header-safe: letters, digits, spaces, dashes
    and underscores only."""
    stem = re.sub(r"[^A-Za-z0-9 _-]+", "", name).strip() or "Resume"
    return f"{stem}.{ext}"


async def choices_response(session: AsyncSession, resume_id: uuid.UUID) -> ChoicesResponse:
    """The resume's choice rows and the variants its bullets can show, in
    the API's shape (the choices GET and PATCH answer with it)."""
    choices = await load_choices(session, resume_id)
    variants = await list_variants(session, resume_id, list(choices.bullets))
    return ChoicesResponse(
        variants=[VariantResponse(id=v.id, bullet_id=v.bullet_id, text=v.text, job_posting_id=v.job_posting_id,
                                  local=v.built_resume_id is not None) for v in variants],
        entries=[EntryChoiceResponse(entry_id=i, shown=c.shown, position=c.position, show_gpa=c.show_gpa,
                                     show_coursework=c.show_coursework) for i, c in choices.entries.items()],
        bullets=[BulletChoiceResponse(bullet_id=i, shown=c.shown, position=c.position, variant_id=c.variant_id,
                                      text=c.text)
                 for i, c in choices.bullets.items()],
        skills=[SkillChoiceResponse(skill_id=i, shown=c.shown, position=c.position)
                for i, c in choices.skills.items()],
    )
