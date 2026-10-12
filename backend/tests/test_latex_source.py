"""
An applicant's own LaTeX resume (KAN-176): reading its words, editing them
without touching anything else, the safety gate before Tectonic, and the
routes that need no database. Saving and tailoring read and write rows, so
they are checked on a throwaway local Postgres, as test_experience.py's are.

fixtures/latex/jakes_original.tex is Jake's resume exactly as published
(jakegut/resume, MIT); plain_itemize.tex is a resume in no template at all.
"""

import difflib
import os
import shutil
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.deps import get_current_account
from app.main import app
from app.routers import latex_resumes
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services.latex_source import compile_source
from app.services.latex_source.fields import fields
from app.services.latex_source.inline import remarked, to_latex, to_plain, unmarked
from app.services.latex_source.safety import Refused, check, prepare
from app.services.latex_source.splice import Delete, Edit, Insert, Unapplicable, apply
from app.services.resume_render import to_latex as tex

FIXTURES = Path(__file__).parent / "fixtures" / "latex"
JAKES = (FIXTURES / "jakes_original.tex").read_text()
PLAIN = (FIXTURES / "plain_itemize.tex").read_text()
HAS_TECTONIC = bool(os.environ.get("TECTONIC_BIN") or shutil.which("tectonic"))
needs_tectonic = pytest.mark.skipif(not HAS_TECTONIC, reason="tectonic not installed")


def _field(source: str, text: str):
    return next(f for f in fields(source) if f.text.startswith(text))


def _changed_lines(before: str, after: str) -> list[str]:
    return [line for line in difflib.ndiff(before.splitlines(), after.splitlines()) if line[:1] in "+-"]


# --- reading the words ----------------------------------------------------------------


def test_jakes_fields_are_its_words_and_nothing_else():
    found = fields(JAKES)
    assert found[0].text == "Jake Ryan"
    headings = [f.text for f in found if f.kind == "heading"]
    assert headings == ["Education", "Experience", "Projects", "Technical Skills"]
    bullets = [f for f in found if f.kind == "bullet"]
    assert len(bullets) == 20 and all(f.editable for f in bullets)
    assert _field(JAKES, "Texas A&M").kind == "text"  # \& reads as &
    assert _field(JAKES, "**Gitlytics**").text == "**Gitlytics** | *Python, Flask, React, PostgreSQL, Docker*"
    # No field is a length, a URL or a command
    assert not any("\\" in f.text or "pt" == f.text for f in found if f.editable)


def test_a_skills_list_is_never_a_bullet():
    assert _field(JAKES, "Java, Python").kind == "text"
    assert _field(PLAIN, "Python, SQL").kind == "text"


def test_plain_items_are_bullets_with_their_formatting():
    bullet = _field(PLAIN, "Built Airflow")
    assert bullet.kind == "bullet"
    assert bullet.text == "Built Airflow pipelines in **Python** that moved 2M rows a day"
    assert _field(PLAIN, "Alex Morgan").kind == "text"


def test_a_line_plain_text_cant_say_is_read_only():
    source = JAKES.replace(
        r"\resumeItem{Used Celery and Redis for asynchronous tasks}",
        r"\resumeItem{Used \href{https://docs.celeryq.dev}{Celery} for tasks}")
    line = _field(source, "Used ")
    assert not line.editable and r"\href" in line.text
    with pytest.raises(Unapplicable, match="Source tab"):
        apply(source, [Edit(line.id, "Used Celery")])


# --- plain text and back --------------------------------------------------------------


def test_plain_text_round_trips():
    latex = r"Cut \textbf{p99} latency 40\% \& costs $|$ A--B $\sim$5x"
    plain = to_plain(latex)
    assert plain == "Cut **p99** latency 40% & costs | A–B ∼5x"
    assert to_plain(to_latex(plain)) == plain


def test_typed_tex_is_printed_not_run():
    assert to_latex(r"\input{/etc/passwd} $x$ 100%") == (
        r"\textbackslash{}input\{/etc/passwd\} \$x\$ 100\%")


def test_marks_come_back_where_their_words_survive():
    assert unmarked("Built **Go** APIs") == "Built Go APIs"
    assert remarked("Built **Go** APIs", "Shipped Go services") == "Shipped **Go** services"
    assert remarked("Built **Go** APIs", "Shipped services") == "Shipped services"


# --- editing --------------------------------------------------------------------------


@pytest.mark.parametrize("source", [JAKES, PLAIN])
def test_no_edits_is_the_same_bytes(source):
    assert apply(source, []) == source


def test_an_edit_changes_its_own_line_only():
    target = _field(JAKES, "Developed a REST API")
    after = apply(JAKES, [Edit(target.id, "Built a **REST** API in FastAPI & Postgres")])
    assert _changed_lines(JAKES, after) == [
        r"-         \resumeItem{Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems}",
        r"+         \resumeItem{Built a \textbf{REST} API in FastAPI \& Postgres}",
    ]


def test_an_italic_stays_the_command_it_was():
    target = _field(JAKES, "**Gitlytics**")
    after = apply(JAKES, [Edit(target.id, "**Gitlytics** | *Python, Flask*")])
    assert r"{\textbf{Gitlytics} $|$ \emph{Python, Flask}}{June 2020 -- Present}" in after


def test_a_new_bullet_copies_its_neighbour():
    target = _field(JAKES, "Explored ways")
    after = apply(JAKES, [Insert(target.id, "Mentored 3 interns")])
    assert _changed_lines(JAKES, after) == [r"+         \resumeItem{Mentored 3 interns}"]
    plain = _field(PLAIN, "Cut warehouse")
    after = apply(PLAIN, [Insert(plain.id, "Wrote dbt tests")])
    assert _changed_lines(PLAIN, after) == ["+   \\item Wrote dbt tests"]


def test_removing_a_bullet_takes_its_line():
    target = _field(JAKES, "Communicate with managers")
    after = apply(JAKES, [Delete(target.id)])
    assert _changed_lines(JAKES, after) == [
        r"-         \resumeItem{Communicate with managers to set up campus computers used on campus}"]


def test_the_last_bullet_in_a_list_stays():
    source = PLAIN.replace("  \\item Cut warehouse costs by 30\\% by partitioning tables in BigQuery\n", "")
    with pytest.raises(Unapplicable, match="only bullet"):
        apply(source, [Delete(_field(source, "Built Airflow").id)])


def test_edits_from_an_older_source_are_refused():
    with pytest.raises(Unapplicable, match="Reload"):
        apply(PLAIN, [Edit("f999", "x")])


# --- the safety gate ------------------------------------------------------------------


def _with(line: str) -> str:
    return JAKES.replace("\\begin{document}", "\\begin{document}\n" + line, 1)


def test_jakes_template_as_published_passes():
    check(JAKES)
    check(PLAIN)
    # Its pdfTeX-only lines are guarded for XeTeX, on the same lines
    prepared = prepare(JAKES)
    assert r"\ifdefined\pdfgentounicode\input{glyphtounicode}\fi" in prepared
    assert prepared.count("\n") == JAKES.count("\n")


@pytest.mark.parametrize("line", [
    r"\input{/proc/self/environ}",
    r"\input /etc/hosts",
    r"\@@input /etc/hosts ",
    r"\InputIfFileExists{/etc/hosts}{}{}",
    r"\newread\f \openin\f=/etc/hosts",
    r"\lstinputlisting{/etc/hosts}",
    r"\verbatiminput{/etc/hosts}",
    r"\include{/etc/hosts}",
    r"\includegraphics{/etc/hosts}",
    "^^5cinput{/etc/hosts}",
    r"\csname input\endcsname{/etc/hosts}",
    r"\catcode`\|=0 |input{/etc/hosts}",
    r"\scantokens{\input{/etc/hosts}}",
    r"\immediate\write18{env}",
    r"\begin{filecontents}{x.tex}",
    r"\XeTeXpdffile /etc/hosts",
])
def test_anything_that_reads_or_writes_a_file_is_refused(line):
    with pytest.raises(Refused) as refused:
        check(_with(line))
    assert refused.value.line == JAKES[:JAKES.index("\\begin{document}")].count("\n") + 2


def test_packages_and_classes_come_from_the_list():
    with pytest.raises(Refused, match="package “tikz”"):
        check(JAKES.replace("\\usepackage{latexsym}", "\\usepackage{latexsym,tikz}"))
    with pytest.raises(Refused, match="document class “/etc/x”"):
        check(JAKES.replace("{article}", "{/etc/x}", 1))


def test_a_comment_never_counts():
    check(_with("% \\input{/etc/hosts} \\usepackage{tikz}"))


def test_a_compile_never_sees_the_apis_environment(monkeypatch):
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "secret")
    monkeypatch.setenv("TECTONIC_BIN", "/bin/sh")
    _, env, _ = tex.tectonic()
    assert "SUPABASE_SERVICE_KEY" not in env and "PATH" in env


# --- compiling --------------------------------------------------------------------------


@needs_tectonic
@pytest.mark.parametrize("source", [JAKES, PLAIN])
def test_pasted_resumes_compile(source):
    pdf, pages = compile_source(source)
    assert pdf.startswith(b"%PDF") and pages == 1


@needs_tectonic
def test_a_tex_error_names_its_line():
    broken = JAKES.replace(r"\section{Education}", r"\section{Education}\nosuchcommand")
    with pytest.raises(tex.LatexError) as error:
        compile_source(broken)
    assert error.value.line == broken[:broken.index(r"\nosuchcommand")].count("\n") + 1
    assert "Undefined control sequence" in error.value.message


# --- the routes -----------------------------------------------------------------------


def _account(account_id=None) -> AuthenticatedAccount:
    return AuthenticatedAccount(
        id=account_id or uuid.uuid4(), email="seeker@example.com", full_name="Sam Seeker",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


@pytest.fixture
def client():
    app.dependency_overrides[get_session] = lambda: None
    yield TestClient(app)
    app.dependency_overrides.clear()


ROUTES = [
    ("post", "/latex/fields", {"source": "x"}),
    ("post", "/latex/preview", {"source": "x"}),
    ("post", "/latex", {"source": "x"}),
    ("get", f"/resumes/{uuid.uuid4()}/latex", None),
    ("put", f"/resumes/{uuid.uuid4()}/latex", {"source": "x"}),
    ("post", f"/resumes/{uuid.uuid4()}/latex/tailor", {"job_id": str(uuid.uuid4())}),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_latex_routes_need_their_owner(client, method, path, body):
    url = f"/applicants/{uuid.uuid4()}{path}"
    assert client.request(method, url, json=body).status_code == 401
    app.dependency_overrides[get_current_account] = lambda: _account()  # someone else
    assert client.request(method, url, json=body).status_code == 403


def test_fields_route_applies_ops(client):
    me = uuid.uuid4()
    app.dependency_overrides[get_current_account] = lambda: _account(me)
    target = _field(PLAIN, "Cut warehouse")
    res = client.post(f"/applicants/{me}/latex/fields", json={
        "source": PLAIN, "ops": [{"edit": target.id, "text": "Cut costs by 30%"}]})
    assert res.status_code == 200
    assert r"\item Cut costs by 30\%" in res.json()["source"]
    assert any(f["text"] == "Cut costs by 30%" for f in res.json()["fields"])
    bad = client.post(f"/applicants/{me}/latex/fields", json={"source": PLAIN, "ops": [{"edit": "f1", "delete": "f2"}]})
    assert bad.status_code == 422


@needs_tectonic
def test_preview_compiles_or_says_why(client, monkeypatch):
    me = uuid.uuid4()
    app.dependency_overrides[get_current_account] = lambda: _account(me)
    monkeypatch.setattr(latex_resumes, "compile_quota", latex_resumes.DailyQuota())
    res = client.post(f"/applicants/{me}/latex/preview", json={"source": PLAIN})
    assert res.status_code == 200 and res.headers["x-pages"] == "1"
    assert res.content.startswith(b"%PDF")
    refused = client.post(f"/applicants/{me}/latex/preview",
                          json={"source": PLAIN.replace("\\pagestyle{empty}", "\\input{/etc/hosts}")})
    assert refused.status_code == 422 and refused.json()["detail"].startswith("Line 11:")


def test_preview_has_a_daily_cap(client, monkeypatch):
    me = uuid.uuid4()
    app.dependency_overrides[get_current_account] = lambda: _account(me)
    monkeypatch.setattr(latex_resumes, "compile_quota", latex_resumes.DailyQuota())
    monkeypatch.setattr(latex_resumes, "DAILY_COMPILES", 0)
    assert client.post(f"/applicants/{me}/latex/preview", json={"source": PLAIN}).status_code == 429
