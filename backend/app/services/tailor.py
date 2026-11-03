"""
Tailor (KAN-217, `docs/tailor_resume.md`): one run that fits a resume to one
job posting and saves it as the posting's tailored resume, with no
confirmation step. Like services/bank.py, functions that touch rows take the
caller's session, scope to the applicant, flush and never commit; the rest
are pure.

The source is the resume the student picked: a built resume's choices, or an
uploaded resume shown as the entries and skills it owns (`upload_source`,
ADR 0005), built in memory and never saved. A run reads that resume
once, as its view (`resume_view.build_view`): its shown entries, bullets
and skills, in its own order and wording. The rank, the prompt, the
changes and the keyword match all read that one view, so the model sees
the resume the student sees, and never an entry, bullet or skill it hides.

A run (`routers/tailor.py`) reads the posting's keywords (KAN-215's cache, or
one extraction), ranks the resume's bullets against the posting with Postgres
text search (`rank_bullets`), and sends the model the posting, every bullet
the resume shows (the lowest-ranked left out past a token budget), its
skills numbered by group and the missing keywords the student picked to add
(`prompt`): no links, and the model seam removes identity data. The model
names bullets by handle (b1), never by id. `propose` turns its rewordings
into changes, dropping any that breaks the truth rule
(`services/truth_rule.py`: the resume's skills and the picked ones count)
or the overlap check, and adds each entry's bullets by rank.
`place_skills` turns its placements into the skills' order, and `place_on`
saves each picked skill as the tailored resume's own, never the bank's.
`edits` records what the run changed and what it replaced, for the editor
to mark and revert until Save.

Tailor changes only what shows: the order, which bullet variant shows, and
the tailored resume's own skills; it never writes the bank's text or adds a
skill to the bank. A keyword the student does not pick is never written in.
"""

import dataclasses
import re
import uuid
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import Text, cast, delete, func, select
from sqlalchemy.dialects.postgresql import ARRAY, TSQUERY, array
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.identity import placeholders_in

from app.models.bank import Bank_Bullet, Bank_Bullet_Variant, Bank_Entry, Bank_Skill
from app.models.jobs import Job_Post
from app.models.resume import Resume
from app.schemas.keywords import Keyword
from app.schemas.tailor import Placement, TailorChange, TailorEdit, TailorReading
from app.services import bank_import
from app.services import keywords as kw
from app.services.bank import (
    Bank,
    NotFound,
    add_local_skill,
    import_upload,
    load_bank,
)
from app.services.matching.embeddings import job_part
from app.services.resume_view import (
    BulletChoice,
    Choices,
    ResumeView,
    SkillChoice,
    ViewBullet,
    ViewEntry,
    ViewSkill,
    all_chosen,
)
from app.services.truth_rule import invented

MAX_TEXT = 500

# Sized to the chain's smallest room, Groq's free tier: 8,000 tokens a minute
# for gpt-oss-120b, prompt and reply (reasoning included) together. A prompt
# over its budget loses its lowest-ranked bullets; a provider that still finds
# it too large passes it down the chain (Scout's `RequestTooLarge`).
PROMPT_TOKENS = 5_000
REPLY_TOKENS = 3_000
# English runs about four characters a token; an estimate, never a count.
CHARS_PER_TOKEN = 4

# How the prompt names the skills with no group, as the renderer does beside
# groups (resume_render/fields.py's `skill_lines`).
OTHER = "Other"
# A new group the model names: this short, and at most this many a run.
MAX_GROUP = 40
MAX_NEW_GROUPS = 2

# One frozen string, so providers can cache it as a prefix.
PROMPT = """\
You tailor a student's resume to one job posting. You may rephrase \
facts the student gave or understand the job requirements and rewrite the experience based on the job description: \
never add a number or result that the \
bullet or the student's skills do not already hold. \
You can add skill or tool that's needed from job and relevant to the student's experience from the bullet point. \
Answer with JSON only: \
{"rewords": [{"bullet": "b1", "text": ...}], "placements": [{"skill": ..., "group": ..., "after": 2}]}.

- rewords: understand the type of bullets the posting cares about, use the given keyword match list, reworded to use the \
posting's words where the bullet's experience supports them. One line each, \
under 200 characters, starting with a strong verb. Most resumes have several \
bullets that relate to the posting: reword each of them so a reader sees the \
match, rather than leaving them as they are. Leave a bullet out only when it \
already uses the posting's words, or when no honest rewording fits it; an empty \
list is fine when none do.
- Use only the bullet handles given such as (b1).
- placements: one for each skill under "Place these skills", none \
otherwise. group: the resume's group it belongs in, or a short new group \
when none fits. after: the number of the skill in that group it should \
follow, or 0 to put it first.
"""


def posting_text(job: Job_Post, keywords: Sequence[Keyword]) -> str:
    """What the bullets are ranked against: the title, the keywords and the
    description's job sections (`job_part`; only the title and keywords when it
    has none)."""
    words = " ".join(k.keyword for k in keywords)
    return f"{job.title} {words} {job_part(job.description)[: kw.MAX_DESCRIPTION_CHARS]}"


def weak_match(job: Job_Post) -> bool:
    return not (job.description or "").strip()


def _bullets(view: ResumeView) -> list[ViewBullet]:
    return [b for s in view.sections for e in s.entries for b in e.bullets]


def _entries(view: ResumeView) -> list[ViewEntry]:
    return [e for s in view.sections for e in s.entries]


async def rank_bullets(session: AsyncSession, view: ResumeView, text: str) -> dict[uuid.UUID, float]:
    '''
    Each bullet the resume shows, ranked against `text` (`posting_text`) by
    Postgres text search on its bank wording.
    '''
    ids = [b.id for b in _bullets(view)]
    if not ids:
        return {}
    # reformat the input job posting string 
    query = cast(func.replace(cast(func.plainto_tsquery("english", text), Text), "&", "|"), TSQUERY)
    rows = await session.execute(
        select(Bank_Bullet.id, func.ts_rank(func.to_tsvector("english", Bank_Bullet.text), query))
        .where(Bank_Bullet.id.in_(ids))
    )
    return {bullet_id: float(rank) for bullet_id, rank in rows}


async def rank_shown(session: AsyncSession, view: ResumeView, text: str) -> dict[uuid.UUID, float]:
    '''
    Each bullet the resume shows, ranked against `text` like `rank_bullets`,
    but on the wording the view shows (this resume's own, else the bank's).
    The texts go to Postgres as parameters, so it reads no table. Fit to One
    Page ranks with it: on a tailored resume the bank's wording is the text
    from before Tailor rewrote it (docs/cut_to_one_page.md).
    '''
    bullets = _bullets(view)
    if not bullets:
        return {}
    query = cast(func.replace(cast(func.plainto_tsquery("english", text), Text), "&", "|"), TSQUERY)
    shown = func.unnest(cast(array([b.text for b in bullets]), ARRAY(Text))).table_valued("body", with_ordinality="n").render_derived()
    rows = await session.execute(select(shown.c.n, func.ts_rank(func.to_tsvector("english", shown.c.body), query)))
    return {bullets[int(n) - 1].id: float(rank) for n, rank in rows}


def handles(view: ResumeView) -> dict[str, uuid.UUID]:
    """e1.. for entries and b1.. for bullets (counted across entries), in the
    resume's order. `prompt` and `propose` both number from the same view,
    so b3 names one bullet in both."""
    out: dict[str, uuid.UUID] = {}
    n = 0
    for i, entry in enumerate(_entries(view), 1):
        out[f"e{i}"] = entry.id
        for bullet in entry.bullets:
            n += 1
            out[f"b{n}"] = bullet.id
    return out


def prompt(
    job: Job_Post,
    keywords: Sequence[Keyword],
    view: ResumeView,
    ranks: Mapping[uuid.UUID, float],
    picked: Sequence[str] = (),
) -> list[dict[str, str]]:
    """Create a central prompt with job posting, extracted keywords and the
    resume's view: its entries and bullets in its order and wording, and
    only the skills it shows. Over `PROMPT_TOKENS`, the lowest-ranked bullets
    are left out until it fits (`ranks`, ties leaving the latest on the
    resume first); their entries stay. The skills are numbered by group
    (`skill_numbers`), with the `picked` ones to place after them."""
    named = {v: k for k, v in handles(view).items()}
    shown = {b.id: f"  {named[b.id]}: {b.text}" for b in _bullets(view)}
    description = (
        job_part(job.description, keep_headings=True).strip()[: kw.MAX_DESCRIPTION_CHARS]
        or "(No description: only the title.)"
    )
    words = ", ".join(f"{k.keyword} ({k.kind})" for k in keywords) or "(none)"
    number = {s.id: n for n, s in skill_numbers(view).items()}
    skills = "\n".join(
        f"{group or OTHER}: " + ", ".join(f"[{number[s.id]}] {s.name}" for s in members)
        for group, members in skill_groups(view)
    ) or "(none)"
    place = f"\n\nPlace these skills: {', '.join(picked)}" if picked else ""
    head = (
        f"Job posting: {job.title}\n\n{description}\n\nKeywords: {words}\n\n"
        f"The resume's skills:\n{skills}{place}\n\nThe resume's entries:\n"
    )
    entries = {e.id: f"{named[e.id]} [{e.section}] {_label(e)}" for e in _entries(view)}

    room = PROMPT_TOKENS * CHARS_PER_TOKEN - len(PROMPT) - len(head) - sum(len(t) + 1 for t in entries.values())
    kept = sorted(shown, key=lambda i: -ranks.get(i, 0.0))
    used = sum(len(t) + 1 for t in shown.values())
    while kept and used > room:
        used -= len(shown[kept.pop()]) + 1
    keep = set(kept)

    lines = []
    for entry in _entries(view):
        lines.append(entries[entry.id])
        lines += [shown[b.id] for b in entry.bullets if b.id in keep]
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": head + "\n".join(lines)}]


def skill_groups(view: ResumeView) -> list[tuple[str | None, list[ViewSkill]]]:
    """The resume's skills by group, each group where it first shows: the
    lines the renderer draws."""
    groups: dict[str | None, list[ViewSkill]] = {}
    for skill in view.skills:
        groups.setdefault(skill.group, []).append(skill)
    return list(groups.items())


def skill_numbers(view: ResumeView) -> dict[int, ViewSkill]:
    """1.. for the resume's skills, group by group, as the prompt prints
    them. A placement's `after` names one; the numbers never change in a
    run, so the model copies a number and never counts."""
    every = [s for _, members in skill_groups(view) for s in members]
    return dict(enumerate(every, 1))


@dataclasses.dataclass(frozen=True)
class Placed:
    """One skill in the tailored resume's order: one the resume shows
    (`skill_id`), or a picked one (`skill_id` None)."""

    skill_id: uuid.UUID | None
    name: str
    group: str | None


def _group(said: str | None, known: Mapping[str, str | None], made: list[str]) -> str | None:
    """The group a placement names: the resume's own (any case), no group
    for "Other", or a new one if it is short, holds no identity placeholder
    and the run has made fewer than `MAX_NEW_GROUPS`; else no group."""
    name = " ".join((said or "").split())
    if not name or name.casefold() == OTHER.casefold() and name.casefold() not in known:
        return None
    if name.casefold() in known:
        return known[name.casefold()]
    if hit := next((g for g in made if g.casefold() == name.casefold()), None):
        return hit
    if len(name) > MAX_GROUP or placeholders_in(name) or len(made) >= MAX_NEW_GROUPS:
        return None
    made.append(name)
    return name


def place_skills(view: ResumeView, picked: Sequence[str], placements: Sequence[Placement]) -> list[Placed]:
    """Every skill of the tailored resume, in order: the resume's own as
    they show, and each picked one where its placement says
    (`docs/tailor_resume.md`, "Skill placement"). Each placement is checked
    alone: a skill not picked, or placed twice, is ignored; an `after` that
    is out of range or in another group puts the skill last in its group;
    one with no placement goes last with no group. The group wins over the
    number. Positions come from this order, never from the model."""
    groups = skill_groups(view)
    number = skill_numbers(view)
    known = {(g or OTHER).casefold(): g for g, _ in groups}
    wanted = {name.casefold(): name for name in picked}
    made: list[str] = []
    first: dict[str | None, list[str]] = {}
    after: dict[uuid.UUID, list[str]] = {}
    last: dict[str | None, list[str]] = {}
    seen: set[str] = set()
    for p in placements:
        name = wanted.get(" ".join(p.skill.split()).casefold())
        if name is None or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        group = _group(p.group, known, made)
        anchor = number.get(p.after) if p.after else None
        if p.after == 0:
            first.setdefault(group, []).append(name)
        elif anchor is not None and anchor.group == group:
            after.setdefault(anchor.id, []).append(name)
        else:
            last.setdefault(group, []).append(name)
    for name in picked:
        if name.casefold() not in seen:
            seen.add(name.casefold())
            last.setdefault(None, []).append(name)

    members = dict(groups)
    order: list[str | None] = [g for g, _ in groups] + made
    if None not in members and (None in first or None in last):
        order.append(None)
    out: list[Placed] = []
    for group in order:
        out += [Placed(None, name, group) for name in first.get(group, [])]
        for skill in members.get(group, []):
            out.append(Placed(skill.id, skill.name, group))
            out += [Placed(None, name, group) for name in after.get(skill.id, [])]
        out += [Placed(None, name, group) for name in last.get(group, [])]
    return out


def _next(positions: Iterable[int]) -> int:
    return max(positions, default=-1) + 1


def _label(entry: Bank_Entry | ViewEntry) -> str:
    """An entry as a change names it: two jobs can share a title."""
    return ", ".join(p for p in (entry.title, entry.organization) if p)


def with_changes(
    bank: Bank,
    choices: Choices,
    changes: Sequence[TailorChange],
    variant_ids: Mapping[uuid.UUID, uuid.UUID] | None = None,
) -> Choices:
    """`choices` with the changes applied, pure. A reworded bullet shows the
    change's text (and `variant_ids[bullet]`, once saved)."""
    entries, bullets, skills = dict(choices.entries), dict(choices.bullets), dict(choices.skills)
    by_id = {e.row.id: e for e in bank.entries}
    for change in changes:
        if change.kind == "reword" and change.bullet_id is not None:
            old = bullets.get(change.bullet_id, BulletChoice(position=_next(c.position for c in bullets.values())))
            bullets[change.bullet_id] = dataclasses.replace(
                old, variant_id=(variant_ids or {}).get(change.bullet_id), text=change.text)
        elif change.kind == "order" and change.entry_id in by_id:
            listed = [b for b in change.bullet_ids if b in bullets]
            rest = sorted((b.id for b in by_id[change.entry_id].bullets if b.id in bullets and b.id not in listed),
                          key=lambda b: bullets[b].position)
            for i, bullet_id in enumerate([*listed, *rest]):
                bullets[bullet_id] = dataclasses.replace(bullets[bullet_id], position=i)
    return Choices(entries, bullets, skills)


class NothingRead(Exception):
    """The upload has no text, or the parser read no entry or skill from it."""


def upload_choices(bank: Bank, resume_id: uuid.UUID) -> Choices:
    """A resume of the entries (with all their bullets) and skills the upload
    owns, pure. Every other entry and skill waits hidden, as Generate leaves a
    copy: a run leaves them out."""
    chosen = all_chosen(bank)
    owned = {e.row.id for e in bank.entries if e.row.resume_id == resume_id}
    owned |= {s.id for s in bank.skills if s.resume_id == resume_id}
    entries = {i: c if i in owned else dataclasses.replace(c, shown=False) for i, c in chosen.entries.items()}
    skills = {i: c if i in owned else dataclasses.replace(c, shown=False) for i, c in chosen.skills.items()}
    return Choices(entries, chosen.bullets, skills)


async def upload_source(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> Choices:
    """An uploaded resume as a Tailor source: the entries and skills it owns
    (ADR 0005). An upload that owns nothing (one from before ADR 0005, or
    one whose entries the student deleted) is read into the bank first, as
    Import Again reads it; one that owns something is never read again,
    since a reading replaces what it owns and would drop it from the
    tailored resume. Run and Done both call it, so Done rebuilds what the run
    proposed against. Flushes, never commits. Raises NotFound for another
    applicant's upload, NothingRead when it owns nothing and its reading
    finds nothing."""
    resume = await session.scalar(select(Resume).where(Resume.id == resume_id, Resume.applicant_id == applicant_id))
    if resume is None:
        raise NotFound
    bank = await load_bank(session, applicant_id)
    if not any(e.row.resume_id == resume.id for e in bank.entries) and not any(
        s.resume_id == resume.id for s in bank.skills
    ):
        drafts, skills = bank_import.read(resume.raw_text)
        if not drafts and not skills:
            raise NothingRead
        await import_upload(session, applicant_id, resume.id, drafts, skills)
        bank = await load_bank(session, applicant_id)
    return upload_choices(bank, resume.id)


def _clean(text: str | None) -> str:
    return " ".join((text or "").split())[:MAX_TEXT]


_WORD = re.compile(r"[a-z0-9][a-z0-9+#]*")
_SMALL = frozenset(["and", "for", "from", "into", "the", "via", "with", "using", "onto", "over"])


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) > 2 and w not in _SMALL}


def _same_word(a: str, b: str) -> bool:
    short, long = sorted((a, b), key=len)
    return short == long or (len(short) >= 4 and long.startswith(short))


def keeps_its_bullet(text: str, original: str) -> bool:
    """Whether a rewording still says what its bullet says: at least a third
    of the original's words (three letters or more) are in it, a shared start
    of four letters counting ("data", "datasets"). A model that copies the
    wrong handle puts another bullet's rewording here, which shares almost
    none, and the truth rule passes it when it adds no number or tool."""
    old, new = _words(original), _words(text)
    shared = sum(1 for w in old if any(_same_word(w, n) for n in new))
    return shared * 3 >= len(old)


def check_wording(
    bank: Bank, bullet_id: uuid.UUID, text: str, skills: Iterable[str], keywords: Sequence[Keyword]
) -> list[str]:
    """The facts `text` invents for the bullet (empty: it keeps the truth
    rule), against its bank wording and `skills`: the skills the resume
    shows, never the whole bank's, so a wording cannot bring in a skill the
    student left off this resume. An identity placeholder the model echoed
    counts as one."""
    original = next(b.text for e in bank.entries for b in e.bullets if b.id == bullet_id)
    found = invented(text, original, skills, tools=[k.keyword for k in keywords])
    return found + placeholders_in(text)


def known(view: ResumeView, picked: Sequence[str], matched: Sequence[Keyword]) -> list[str]:
    """What the truth rule takes as already said by the student, beside each
    bullet's own wording: the skills the resume shows, the missing keywords
    they picked (picking one says they have it), and the posting's keywords
    the resume already shows anywhere (`keywords.match`: "algorithms" in
    coursework). A missing keyword they did not pick is in none of these, so
    a wording that names it is dropped: "backend" on a designer's bullet."""
    return [s.name for s in view.skills] + list(picked) + [k.keyword for k in matched]


def propose(
    bank: Bank,
    view: ResumeView,
    reading: TailorReading,
    ranks: Mapping[uuid.UUID, float],
    keywords: Sequence[Keyword],
    skills: Sequence[str] = (),
) -> tuple[list[TailorChange], int]:
    """(changes, how many wordings the truth rule dropped), for the bullets
    `view` shows. `bank` gives each bullet's own wording; the truth rule
    reads `skills` beside it (`known`)."""
    ids = handles(view)
    showing = {b.id: b.text for b in _bullets(view)}
    originals = {b.id: b.text for e in bank.entries for b in e.bullets if b.id in showing}
    changes: list[TailorChange] = []
    dropped = 0

    reworded: set[uuid.UUID] = set()
    for item in reading.rewords:
        bullet_id = ids.get(item.bullet.strip())
        if bullet_id not in originals or bullet_id in reworded:
            continue
        text = _clean(item.text)
        if not text or text.casefold() == showing[bullet_id].casefold():
            continue
        if check_wording(bank, bullet_id, text, skills, keywords) or not keeps_its_bullet(text, originals[bullet_id]):
            dropped += 1
            continue
        reworded.add(bullet_id)
        changes.append(TailorChange(kind="reword", bullet_id=bullet_id, text=text, original=originals[bullet_id]))

    for entry in _entries(view):
        shown = [b.id for b in entry.bullets]
        best = sorted(shown, key=lambda b: -ranks.get(b, 0.0))
        if len(shown) > 1 and best != shown:
            changes.append(TailorChange(kind="order", entry_id=entry.id, bullet_ids=best, label=_label(entry)))
    return changes, dropped


async def clear_run(session: AsyncSession, resume_id: uuid.UUID) -> None:
    """What the last run and the student's edits made on the posting's
    tailored resume and on no other: its own skills and its own typed
    wordings, cleared so a new run replaces the resume. The run then writes
    every choice row afresh (`write_choices`). The posting's variants stay:
    another resume may show one, and the same wording reuses it."""
    for model in (Bank_Skill, Bank_Bullet_Variant):
        await session.execute(delete(model).where(model.built_resume_id == resume_id))
    await session.flush()


async def place_on(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    choices: Choices,
    placed: Sequence[Placed],
) -> tuple[Choices, dict[str, uuid.UUID]]:
    """`choices` with the skills in `place_skills`' order, flushed: each
    picked skill saved as `resume_id`'s own (`add_local_skill`, never the
    bank's), and every shown skill numbered from 0 in that order. The
    source's hidden skill rows stay hidden, after them. Returns the choices
    and each picked skill's new id by name."""
    new: dict[str, uuid.UUID] = {}
    order: list[uuid.UUID] = []
    for p in placed:
        if p.skill_id is None:
            new[p.name] = (await add_local_skill(session, applicant_id, resume_id, p.name, p.group)).id
        order.append(p.skill_id or new[p.name])
    skills = {skill_id: SkillChoice(shown=True, position=i) for i, skill_id in enumerate(order)}
    hidden = [i for i, c in choices.skills.items() if i not in skills and not c.shown]
    skills |= {skill_id: SkillChoice(shown=False, position=len(order) + i) for i, skill_id in enumerate(hidden)}
    return Choices(choices.entries, choices.bullets, skills), new


def edits(
    view: ResumeView,
    source: Choices,
    changes: Sequence[TailorChange],
    variant_ids: Mapping[uuid.UUID, uuid.UUID],
    placed: Sequence[Placed],
    new: Mapping[str, uuid.UUID],
) -> list[TailorEdit]:
    """What a run changed on the tailored resume, each with what it replaced
    on the source (`view`, `source`), for the editor to mark and revert."""
    showing = {b.id: b.text for b in _bullets(view)}
    order = {e.id: [b.id for b in e.bullets] for e in _entries(view)}
    out: list[TailorEdit] = []
    for c in changes:
        if c.kind == "reword" and c.bullet_id is not None:
            choice = source.bullets.get(c.bullet_id)
            out.append(TailorEdit(
                kind="reword", bullet_id=c.bullet_id, text=c.text, variant_id=variant_ids.get(c.bullet_id),
                before=showing[c.bullet_id], before_variant_id=choice.variant_id if choice else None))
        elif c.kind == "order" and c.entry_id is not None:
            out.append(TailorEdit(
                kind="order", entry_id=c.entry_id, label=c.label, bullet_ids=c.bullet_ids,
                before_ids=order[c.entry_id]))
    out += [TailorEdit(kind="skill", skill_id=new[p.name], label=p.name, group=p.group)
            for p in placed if p.skill_id is None]
    return out


class BreaksTruthRule(Exception):
    def __init__(self, facts: list[str]) -> None:
        self.facts = facts
        super().__init__(f"This wording adds what your bank does not say: {', '.join(facts)}.")


async def save_variants(
    session: AsyncSession,
    bank: Bank,
    posting_id: uuid.UUID,
    changes: Sequence[TailorChange],
    skills: Iterable[str],
    keywords: Sequence[Keyword],
) -> dict[uuid.UUID, uuid.UUID]:
    """Each accepted wording as a bullet variant for the posting, checked
    against the truth rule again (the browser could send anything), with
    `skills` the ones the saved resume will show. The same
    wording for the same bullet reuses its variant, whichever posting made
    it. Returns bullet id -> variant id."""
    out: dict[uuid.UUID, uuid.UUID] = {}
    for change in changes:
        if change.kind != "reword" or change.bullet_id is None:
            continue
        change.text = _clean(change.text)
        if not change.text:
            raise BreaksTruthRule(["an empty line"])
        facts = check_wording(bank, change.bullet_id, change.text, skills, keywords)
        if facts:
            raise BreaksTruthRule(facts)
        variant = await session.scalar(
            select(Bank_Bullet_Variant).where(
                Bank_Bullet_Variant.bullet_id == change.bullet_id,
                Bank_Bullet_Variant.built_resume_id.is_(None),
                Bank_Bullet_Variant.text == change.text,
            ).limit(1)
        )
        if variant is None:
            variant = Bank_Bullet_Variant(
                id=uuid.uuid4(), bullet_id=change.bullet_id, text=change.text, job_posting_id=posting_id)
            session.add(variant)
        out[change.bullet_id] = variant.id
    await session.flush()
    return out
