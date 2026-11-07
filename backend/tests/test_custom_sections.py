"""
Custom sections (KAN-498): a section the student names, in the experience
bank and on built resumes. The view, the page's order, the LaTeX, the Word
file, the sent resume's hash, Fit to One Page's order and the import's
reading run with no database; the API's writes run on real Postgres
(backend/CLAUDE.md, Tests against real Postgres) and skip without it.
"""

import dataclasses
import hashlib
import io
import json
import uuid
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.schemas.bank import (
    MAX_CUSTOM_SECTIONS,
    CustomSectionCreate,
    DraftEntry,
    EntryCreate,
)
from app.schemas.built_resume import PageSettings as ApiPageSettings
from app.schemas.intake import IntakeTurnRequest
from app.services import resume_render
from app.services.bank_import import other_drafts, read
from app.services.fit_page import plan
from app.services.resume_render import PageSettings, printed_order, valid_order
from app.services.resume_render.jakes import body as jakes_body
from app.services.resume_render.sample import IDENTITY, VIEW
from app.services.resume_view import (
    BulletChoice,
    Choices,
    EntryChoice,
    ResumeView,
    ViewBullet,
    ViewEntry,
    ViewSection,
    build_view,
    custom_key,
    view_from_json,
    view_from_reading,
)
from app.utils.resume_parser import parse_resume
from tests.test_fit_page import _Layout, _names, _view

# --- the view -------------------------------------------------------------------


def _row(section, title, *, custom_section_id=None, **fields):
    return SimpleNamespace(
        id=uuid.uuid4(), section=section, custom_section_id=custom_section_id, title=title,
        organization=fields.get("organization"), location=None, start_month=None, end_month=None,
        end_kind=None, degree=None, field_of_study=None, gpa=None, gpa_scale=None, coursework=[], honors=None,
        link=None, issuer=None, award_date=None,
    )


def _bank(*sections, entries):
    """`entries`: (row, [bullet texts]). Every entry and bullet is shown."""
    built = [SimpleNamespace(row=row, bullets=[SimpleNamespace(id=uuid.uuid4(), text=t) for t in lines])
             for row, lines in entries]
    bank = SimpleNamespace(entries=built, skills=[], sections=list(sections))
    choices = Choices(
        entries={e.row.id: EntryChoice(position=i) for i, e in enumerate(built)},
        bullets={b.id: BulletChoice(position=j) for e in built for j, b in enumerate(e.bullets)},
    )
    return bank, choices


def _section(name, layout="entries"):
    return SimpleNamespace(id=uuid.uuid4(), name=name, layout=layout)


def test_a_custom_section_shows_after_the_fixed_ones_under_its_own_name():
    volunteering = _section("Volunteering")
    job = _row("experience", "Intern")
    tutor = _row("custom", "Tutor", custom_section_id=volunteering.id, organization="Library")
    bank, choices = _bank(volunteering, entries=[(tutor, ["Taught math"]), (job, ["Built it"])])

    view = build_view(bank, choices)
    assert [s.section for s in view.sections] == ["experience", "custom:volunteering"]
    custom = view.sections[1]
    assert (custom.label, custom.layout) == ("Volunteering", "entries")
    assert [(e.section, e.title, e.organization) for e in custom.entries] == [("custom", "Tutor", "Library")]
    # The fixed sections carry neither, as before
    assert (view.sections[0].label, view.sections[0].layout) == (None, None)


def test_two_sections_of_one_name_print_as_one_and_an_empty_one_not_at_all():
    mine, theirs, empty = _section("Languages", "lines"), _section("languages"), _section("Hobbies")
    a = _row("custom", "Languages", custom_section_id=mine.id)
    b = _row("custom", "Languages", custom_section_id=theirs.id)
    bank, choices = _bank(mine, theirs, empty, entries=[(a, ["Spanish"]), (b, ["French"])])

    view = build_view(bank, choices)
    assert [(s.section, s.label, s.layout) for s in view.sections] == [("custom:languages", "Languages", "lines")]
    assert [b.text for e in view.sections[0].entries for b in e.bullets] == ["Spanish", "French"]


def test_an_entry_whose_section_the_copy_lacks_shows_nowhere():
    lost = _row("custom", "Tutor", custom_section_id=uuid.uuid4())
    bank, choices = _bank(entries=[(lost, ["x"])])
    assert build_view(bank, choices).sections == ()


def test_custom_key_ignores_case_and_spacing():
    assert custom_key(" Community   Service ") == custom_key("community service") == "custom:community service"


# --- the page's order -----------------------------------------------------------

LINES = ViewSection("custom:interests", (ViewEntry(uuid.uuid4(), "custom", "Interests", bullets=(
    ViewBullet(uuid.uuid4(), "Rock climbing"), ViewBullet(uuid.uuid4(), "Chess, *photography*", None),
)),), "Interests", "lines")
SUMMARY = ViewSection("custom:summary", (ViewEntry(uuid.uuid4(), "custom", "Summary", bullets=(
    ViewBullet(uuid.uuid4(), "Student who builds backend services."),
)),), "Summary", "lines")
PUBLICATIONS = ViewSection("custom:publications", (ViewEntry(
    uuid.uuid4(), "custom", "Fast Robots", organization="ICRA",
    bullets=(ViewBullet(uuid.uuid4(), "Cut lap time by 20%"),)),), "Publications", "entries")
WITH_CUSTOM = replace(VIEW, sections=(*VIEW.sections, LINES, SUMMARY, PUBLICATIONS))


def test_a_summary_prints_first_and_any_other_custom_section_last():
    order = printed_order(resume_render.SECTION_ORDER, WITH_CUSTOM.sections)
    assert order == ["custom:summary", *resume_render.SECTION_ORDER, "custom:interests", "custom:publications"]


def test_a_dragged_custom_section_prints_where_the_order_puts_it():
    order = ("education", "custom:interests", *resume_render.SECTION_ORDER[1:])
    assert printed_order(order, WITH_CUSTOM.sections) == ["custom:summary", *order, "custom:publications"]


@pytest.mark.parametrize("order", [
    (*resume_render.SECTION_ORDER, "custom:x", "custom:x"),  # twice
    (*resume_render.SECTION_ORDER, "custom:"),  # no name
    (*resume_render.SECTION_ORDER, "custom:" + "x" * 80),  # too long
    (*resume_render.SECTION_ORDER[1:], "custom:x"),  # a fixed section left out
])
def test_a_section_order_names_each_custom_section_once_and_every_fixed_one(order):
    assert not valid_order(order)
    with pytest.raises(ValueError):
        PageSettings(section_order=order)
    with pytest.raises(ValidationError):
        ApiPageSettings(section_order=list(order))


def test_a_section_order_may_hold_custom_sections():
    order = [*resume_render.SECTION_ORDER, "custom:volunteering", "custom:languages"]
    assert ApiPageSettings(section_order=order).section_order == order
    assert PageSettings(section_order=order).section_order == tuple(order)


# --- the LaTeX and the Word file ------------------------------------------------


def test_the_pdf_prints_custom_sections_by_their_names_and_layouts():
    tex = jakes_body(WITH_CUSTOM, IDENTITY, marks=False)
    at = [tex.index(rf"\section{{{name}}}") for name in ("Summary", "Education", "Technical Skills", "Interests",
                                                          "Publications")]
    assert at == sorted(at)
    lines = tex[tex.index(r"\section{Interests}"):tex.index(r"\section{Publications}")]
    # Lines: no heading, no dot, each line an item of its own
    assert r"\begin{itemize}[leftmargin=0.15in, label={}]" in lines
    assert r"\resumeItem{Rock climbing\ignorespaces}" in lines
    assert r"\resumeSubheading" not in lines and r"\resumeProjectHeading" not in lines
    # Entries print as a project does: title | organization
    assert r"\resumeProjectHeading{\textbf{Fast Robots} $|$ \emph{ICRA}}" in tex


def test_each_line_of_a_lines_section_is_a_bullet_to_the_editor():
    printed: dict[str, str] = {}
    jakes_body(WITH_CUSTOM, IDENTITY, printed=printed)
    line = LINES.entries[0].bullets[0]
    assert printed[f"{line.id}.bullet"] == "Rock climbing"
    # The holding entry prints no heading, so it has no box
    assert not any(key.startswith(str(LINES.entries[0].id)) for key in printed)


def test_custom_sections_compile_offline_with_a_box_for_each_line():
    from tests.test_resume_render import _tectonic_or_skip

    _tectonic_or_skip()
    rendered = resume_render.render(WITH_CUSTOM, IDENTITY, "jakes")
    boxes = {(b.item_id, b.kind) for b in rendered.boxes}
    assert all((str(b.id), "bullet") in boxes for b in LINES.entries[0].bullets)
    assert (str(PUBLICATIONS.entries[0].id), "title") in boxes


def test_a_lines_section_with_no_line_prints_nothing():
    empty = ViewSection("custom:x", (ViewEntry(uuid.uuid4(), "custom", "X"),), "X", "lines")
    assert r"\section{X}" not in jakes_body(replace(VIEW, sections=(*VIEW.sections, empty)), IDENTITY)


def test_a_custom_sections_name_is_escaped():
    odd = replace(LINES, label=r"Fun \input{/etc/passwd} & 100%")
    tex = jakes_body(replace(VIEW, sections=(odd,)), IDENTITY, marks=False)
    assert r"\input{/etc/passwd}" not in tex


def test_the_word_file_prints_custom_sections_in_the_same_order():
    from docx import Document

    from app.services.resume_render.word import render_docx

    doc = Document(io.BytesIO(render_docx(WITH_CUSTOM, IDENTITY)))
    texts = [p.text for p in doc.paragraphs]
    headings = [t for t in texts if t in ("SUMMARY", "EDUCATION", "TECHNICAL SKILLS", "INTERESTS", "PUBLICATIONS")]
    assert headings == ["SUMMARY", "EDUCATION", "TECHNICAL SKILLS", "INTERESTS", "PUBLICATIONS"]
    assert "Rock climbing" in texts


# --- the sent resume -------------------------------------------------------------


def test_a_resume_with_no_custom_section_hashes_as_before():
    from app.services.sent_resumes import _identity, content_hash

    # The hash before KAN-498: no label or layout key, no empty `marked`
    view = dataclasses.asdict(VIEW, dict_factory=lambda items: {
        k: v for k, v in items if k not in ("label", "layout") and (k != "marked" or v)})
    payload = {"template": "jakes", "identity": _identity(IDENTITY), "view": view}
    before = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    assert content_hash(VIEW, IDENTITY, "jakes") == before
    assert content_hash(WITH_CUSTOM, IDENTITY, "jakes") != before


def test_a_snapshot_keeps_a_custom_section_and_an_old_one_reads_without():
    stored = json.loads(json.dumps(dataclasses.asdict(WITH_CUSTOM), default=str))
    assert view_from_json(stored) == WITH_CUSTOM
    for section in stored["sections"]:
        section.pop("label")
        section.pop("layout")
    assert view_from_json(stored).sections[0].label is None


# --- Fit to One Page ------------------------------------------------------------


def test_fit_cuts_custom_sections_first_bullets_and_entries():
    view, names = _view(experience=[3], projects=[3], awards=[3])
    lines = ViewSection("custom:languages", (ViewEntry(
        uuid.uuid4(), "custom", "Languages", bullets=tuple(ViewBullet(uuid.uuid4(), f"l{j}") for j in range(3))),),
        "Languages", "lines")
    names[lines.entries[0].id] = "languages0"
    names.update((b.id, f"languages0.b{j}") for j, b in enumerate(lines.entries[0].bullets))
    view = ResumeView((*view.sections, lines), view.skills)

    order = _names(plan(view, None, _Layout(view)), names)
    # Bullets to two, then one: the custom section before Awards
    assert order[:2] == ["bullet:languages0.b2", "bullet:awards0.b2"]
    # Whole entries: the custom section before any fixed one
    assert next(o for o in order if o.startswith("entry:")) == "entry:languages0"


# --- the import -----------------------------------------------------------------

OTHERS = """\
Summary
Computer science student who builds reliable backend services and enjoys working on
distributed systems and developer tools.
Education
Riverside State University  Expected May 2099
B.S. in Computer Science
INTERESTS
Rock climbing
Chess, photography
References
Available upon request
"""
# The Summary's two lines, read as one
SUMMARY_LINE = ("Computer science student who builds reliable backend services and enjoys working on "
                "distributed systems and developer tools.")


def test_the_parser_keeps_each_heading_the_bank_has_no_section_for():
    parsed = parse_resume(OTHERS)
    assert [(o.heading, o.lines) for o in parsed.others] == [
        ("Summary", [SUMMARY_LINE]),
        # Upper case reads as a name; short lines stay lines; References goes
        ("Interests", ["Rock climbing", "Chess, photography"]),
    ]


def test_marked_lines_stay_one_item_each():
    parsed = parse_resume("Education\nX University  May 2020\nHobbies\n• Running marathons\n• Baking bread\n")
    assert [(o.heading, o.lines) for o in parsed.others] == [("Hobbies", ["Running marathons", "Baking bread"])]


def test_import_drafts_a_lines_section_for_each_other_heading():
    entries, _ = read(OTHERS)
    custom = [(d.section_name, d.title, d.bullets) for d in entries if d.section == "custom"]
    assert custom == [
        ("Summary", "Summary", [SUMMARY_LINE]),
        ("Interests", "Interests", ["Rock climbing", "Chess, photography"]),
    ]
    # The model's reading keeps the same sections
    assert [d.section_name for d in other_drafts(OTHERS)] == ["Summary", "Interests"]
    # An upload's snapshot prints them as Lines sections
    view = view_from_reading(entries, [])
    assert [(s.label, s.layout) for s in view.sections if s.label] == [("Summary", "lines"), ("Interests", "lines")]


# --- the schemas ----------------------------------------------------------------


def test_a_custom_entry_needs_its_section_and_other_entries_take_none():
    with pytest.raises(ValidationError):
        EntryCreate(section="custom", title="Tutor")
    with pytest.raises(ValidationError):
        EntryCreate(section="experience", title="Intern", custom_section_id=uuid.uuid4())
    # An import's draft names the section it makes
    assert DraftEntry(section="custom", title="Summary", section_name="Summary").section_name == "Summary"


@pytest.mark.parametrize("name", ["Education", "technical  skills", "Leadership & Activities"])
def test_a_custom_section_never_takes_a_fixed_sections_name(name):
    with pytest.raises(ValidationError):
        CustomSectionCreate(name=name)


def test_intake_asks_about_the_fixed_sections_only():
    with pytest.raises(ValidationError):
        IntakeTurnRequest(section="custom", messages=[{"role": "user", "content": "hi"}])


# --- the API, on real Postgres ----------------------------------------------------


async def _seed_applicant(session) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam Seeker')"),
        {"id": applicant_id, "email": f"{applicant_id.hex[:8]}@example.com"},
    )
    await session.commit()
    return applicant_id


@pytest.fixture
async def student(database):
    """A signed-in applicant and an API client: (client, applicant id, bank URL)."""
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id, email="sam@example.com", full_name="Sam Seeker", account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, applicant_id, f"/applicants/{applicant_id}/bank"
    finally:
        app.dependency_overrides.pop(get_current_account, None)


async def _seed_resume(database, applicant_id: uuid.UUID, raw_text: str) -> uuid.UUID:
    resume_id = uuid.uuid4()
    async with database() as session:
        await session.execute(
            text("INSERT INTO resumes (id, applicant_id, original_filename, storage_path, status, raw_text)"
                 " VALUES (:id, :applicant, 'resume.pdf', :path, 'parsed', :raw)"),
            {"id": resume_id, "applicant": applicant_id, "path": f"{applicant_id}/{resume_id}.pdf", "raw": raw_text},
        )
        await session.commit()
    return resume_id


@pytest.mark.anyio
async def test_a_section_takes_entries_and_the_bank_sends_both(student):
    client, _, bank = student
    res = await client.post(f"{bank}/sections", json={"name": "Volunteering"})
    assert res.status_code == 201
    section = res.json()
    assert (section["name"], section["layout"], section["resume_ids"]) == ("Volunteering", "entries", [])

    res = await client.post(f"{bank}/entries", json={
        "section": "custom", "custom_section_id": section["id"], "title": "Tutor", "organization": "Library",
        "bullets": ["Taught math"]})
    assert res.status_code == 201
    assert res.json()["custom_section_id"] == section["id"]

    saved = (await client.get(bank)).json()
    assert [(s["name"], s["layout"]) for s in saved["sections"]] == [("Volunteering", "entries")]
    assert [(e["section"], e["title"], e["custom_section_id"]) for e in saved["entries"]] == [
        ("custom", "Tutor", section["id"])]


@pytest.mark.anyio
async def test_an_owner_holds_five_sections_each_name_once(student):
    client, _, bank = student
    for i in range(MAX_CUSTOM_SECTIONS):
        assert (await client.post(f"{bank}/sections", json={"name": f"S{i}", "layout": "lines"})).status_code == 201
    res = await client.post(f"{bank}/sections", json={"name": "One More"})
    assert res.status_code == 409 and "up to 5" in res.json()["detail"]

    res = await client.post(f"{bank}/sections", json={"name": "s0"})
    assert res.status_code == 409 and "already" in res.json()["detail"]


@pytest.mark.anyio
async def test_a_section_renames_and_deletes_with_its_entries(student):
    client, _, bank = student
    first = (await client.post(f"{bank}/sections", json={"name": "Hobbies", "layout": "lines"})).json()
    other = (await client.post(f"{bank}/sections", json={"name": "Languages", "layout": "lines"})).json()
    await client.post(f"{bank}/entries", json={
        "section": "custom", "custom_section_id": first["id"], "title": "Hobbies", "bullets": ["Chess"]})

    assert (await client.patch(f"{bank}/sections/{first['id']}", json={"name": "Languages"})).status_code == 409
    res = await client.patch(f"{bank}/sections/{first['id']}", json={"name": "Interests"})
    assert res.status_code == 200 and res.json()["name"] == "Interests"
    # The layout is fixed once made
    assert (await client.patch(f"{bank}/sections/{first['id']}", json={"layout": "entries"})).status_code == 422

    assert (await client.delete(f"{bank}/sections/{first['id']}")).status_code == 204
    saved = (await client.get(bank)).json()
    assert [s["id"] for s in saved["sections"]] == [other["id"]]
    assert saved["entries"] == []


@pytest.mark.anyio
async def test_another_students_section_is_not_found(student, database):
    client, _, bank = student
    async with database() as session:
        other = await _seed_applicant(session)
        section_id = uuid.uuid4()
        await session.execute(
            text("INSERT INTO bank_custom_sections (id, applicant_id, name, layout) VALUES (:id, :a, 'Theirs', 'lines')"),
            {"id": section_id, "a": other},
        )
        await session.commit()
    res = await client.post(f"{bank}/entries", json={
        "section": "custom", "custom_section_id": str(section_id), "title": "Mine"})
    assert res.status_code == 404
    assert (await client.patch(f"{bank}/sections/{section_id}", json={"name": "Mine"})).status_code == 404
    assert (await client.delete(f"{bank}/sections/{section_id}")).status_code == 404


@pytest.mark.anyio
async def test_import_makes_the_uploads_own_lines_sections_and_replaces_them(student, database):
    client, applicant_id, bank = student
    resume_id = await _seed_resume(database, applicant_id, OTHERS)

    assert (await client.post(f"{bank}/import", json={"resume_id": str(resume_id)})).status_code == 200
    saved = (await client.get(bank)).json()
    assert [(s["name"], s["layout"], s["resume_ids"]) for s in saved["sections"]] == [
        ("Summary", "lines", [str(resume_id)]), ("Interests", "lines", [str(resume_id)])]
    first = {s["id"] for s in saved["sections"]}

    # Import Again replaces them with the new reading's
    assert (await client.post(f"{bank}/import", json={"resume_id": str(resume_id)})).status_code == 200
    again = (await client.get(bank)).json()
    assert len(again["sections"]) == 2 and first.isdisjoint(s["id"] for s in again["sections"])
    lines = [b["text"] for e in again["entries"] if e["section"] == "custom" for b in e["bullets"]]
    assert "Rock climbing" in lines

    # Deleting the upload takes its sections and their entries
    async with database() as session:
        await session.execute(text("DELETE FROM resumes WHERE id = :id"), {"id": resume_id})
        await session.commit()
    gone = (await client.get(bank)).json()
    assert gone["sections"] == [] and not any(e["section"] == "custom" for e in gone["entries"])


@pytest.mark.anyio
async def test_a_built_resume_prints_a_custom_section(student, database):
    """Generate shows every entry, so the custom section's lines reach the
    view the PDF prints."""
    from app.services import built_resumes

    client, applicant_id, bank = student
    section = (await client.post(f"{bank}/sections", json={"name": "Languages", "layout": "lines"})).json()
    await client.post(f"{bank}/entries", json={
        "section": "custom", "custom_section_id": section["id"], "title": "Languages", "bullets": ["Spanish"]})
    await client.post(f"{bank}/entries", json={"section": "projects", "title": "WorkIt"})

    async with database() as session:
        resume = await built_resumes.generate(session, applicant_id)
        await session.commit()
        _, view = await built_resumes.load_view(session, applicant_id, resume.id)
    assert [(s.section, s.label, s.layout) for s in view.sections] == [
        ("projects", None, None), ("custom:languages", "Languages", "lines")]
    # And the bank says which built resume shows the section
    saved = (await client.get(bank)).json()
    assert saved["sections"][0]["resume_ids"] == [str(resume.id)]
