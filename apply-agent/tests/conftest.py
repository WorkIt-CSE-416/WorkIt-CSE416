import atexit
import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest

APPLY = Path(__file__).parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
# The data folder every test runs on: Apply sets its data paths when it is imported, so
# APPLY_HOME points here before that, never at ~/.config/apply. data_folder() fills it.
os.environ["APPLY_HOME"] = tempfile.mkdtemp(prefix="apply-test-home-")
os.environ["APPLY_TEST_TEMP_OK"] = "1"  # that folder is temp on purpose (home.temp_state, KAN-665)
atexit.register(shutil.rmtree, os.environ["APPLY_HOME"], True)

# Before anything else can open a connection: no test reaches past loopback (KAN-662).
import network_block

network_block.install()

from fake_lever import FakeLeverServer
from fakes import FakeJobServer

from apply import browsers, cli, cover_letter, gates, home, profile

# Never the student's own data folder: data_folder() deletes HOME before each test. Were
# Apply imported before APPLY_HOME was set above, HOME would be ~/.config/apply (it was,
# 2026-11-04, and the fixture wiped it): stop the whole run instead.
TEST_HOME = Path(os.environ["APPLY_HOME"]).resolve()
if home.HOME.resolve() != TEST_HOME or home.HOME.resolve() == Path("~/.config/apply").expanduser().resolve():
    pytest.exit(f"Apply's data folder is {home.HOME}, not the tests' own {TEST_HOME}: refusing to run, "
                "since each test deletes it. Run pytest from apply-agent/ so tests/conftest.py loads first.", 2)

from apply.fill_engine import ENGINE_DIR
from apply.model import Kind, Posting, Question

# Saved forms live in the Fill engine (the extension's submodule), which is tested on them too.
FORMS = ENGINE_DIR / "test" / "fixtures" / "forms"
ARC_FORM = FORMS / "greenhouse-arc"
ARC_URL = "https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008"
PURE_STORAGE_FORM = FORMS / "greenhouse-purestorage"
PURE_STORAGE_URL = "https://job-boards.greenhouse.io/purestorage/jobs/8249749"
SKYDIO_FORM = FORMS / "ashby-skydio"
SKYDIO_URL = "https://jobs.ashbyhq.com/skydio/79fdda46-4ff5-42c7-b208-55f2084cdb8c/application?embed=true"
POLICIES = APPLY / "policies.default.yaml"  # the default policies: they hold nothing personal
# The real Question sets saved by the application-questions research (58 forms: 30 Greenhouse,
# 18 Ashby, 10 Lever), kept in the Fill engine, whose planner is tested on them.
RESEARCH_FORMS = {f["company"]: f for f in json.loads(
    (ENGINE_DIR / "test" / "fixtures" / "planner" / "research-forms.json").read_text())}
# Each job system's field types, reduced to the planner's kinds. Ashby's Boolean
# is a Yes/No choice. Education blocks and hidden fields aren't questions.
KINDS: dict[str, Kind] = {
    "input_text": "text", "textarea": "textarea", "input_file": "file",
    "multi_value_single_select": "select", "multi_value_multi_select": "multi_select",
    "String": "text", "Email": "text", "Phone": "text", "Url": "text", "Number": "text", "Date": "text",
    "Location": "text", "LongText": "textarea", "File": "file", "ValueSelect": "select", "Boolean": "select",
    "MultiValueSelect": "multi_select",
    "text": "text", "university": "text", "file-upload": "file",
    "dropdown": "select", "select": "select", "multiple-choice": "select", "multiple-select": "multi_select",
}


def research_form(company: str) -> tuple[list[Question], Posting]:
    form = RESEARCH_FORMS[company]
    questions = []
    for i, q in enumerate(form["questions"]):
        kind = "file" if q["type"] == "std:resume" else "text" if q["type"].startswith("std:") else KINDS.get(q["type"])
        if kind:
            options = ("Yes", "No") if q["type"] == "Boolean" else tuple(q["options"])
            questions.append(Question(f"q{i}", q["label"], kind, q["required"], options))
    return questions, Posting(id=company, company=company, title=form["title"], url=form["url"])


# Saved with a location search for "Riverton"; asks a location and a date.
HARVEY_FORM = FORMS / "ashby-harvey"
HARVEY_URL = "https://jobs.ashbyhq.com/harvey/3a34578d-d42e-45bb-ac5c-0c3357e8cbb7/application"
COHERE_FORM = FORMS / "ashby-cohere"
COHERE_URL = "https://jobs.ashbyhq.com/cohere/8c035d3d-081d-4c8a-914a-72f4efaad254/application"
# Asks for text-message consent under its Phone field.
PATREON_FORM = FORMS / "ashby-patreon"
PATREON_URL = "https://jobs.ashbyhq.com/patreon/cefe07ab-ba4f-48cc-86b9-a88b1859a95c/application"
# Asks Yes or No whether he can start on one of two days.
SEMGREP_FORM = FORMS / "ashby-semgrep"
SEMGREP_URL = "https://jobs.ashbyhq.com/semgrep/8e64dc7f-e925-4361-86d5-b01ee518c987/application"
# Saved with searches for "Riverton" and "Example State University"; asks an
# Education History, pay and Yes/No questions with conditional follow-ups.
AMPLIFY_FORM = FORMS / "ashby-amplify"
AMPLIFY_URL = "https://jobs.ashbyhq.com/amplify/855d22a3-f15e-49f6-854c-29e505653efa/application?embed=true"
IMMUTA_FORM = FORMS / "lever-immuta"
IMMUTA_URL = "https://jobs.lever.co/immuta/b9b21075-74a4-4b64-8f1b-f0be1fb0b24d/apply"
RHOMBUS_FORM = FORMS / "lever-rhombus"
RHOMBUS_URL = "https://jobs.lever.co/rhombus-systems/59e7a5f3-b457-491d-af08-b629ad35e380/apply"
XCIMER_FORM = FORMS / "lever-xcimer"
XCIMER_URL = "https://jobs.lever.co/xcimer/fee9965c-8040-4614-8fd1-10bddfe3b911/apply"
SHIELD_AI_FORM = FORMS / "lever-shieldai"
SHIELD_AI_URL = "https://jobs.lever.co/shieldai/8c850c75-081d-4d09-bebf-096379a93010/apply"
HERMEUS_FORM = FORMS / "lever-hermeus"
HERMEUS_URL = "https://jobs.lever.co/hermeus/5b08e2df-c9db-4831-aece-67d89e744796/apply"
BELVEDERE_FORM = FORMS / "lever-belvedere"
BELVEDERE_URL = "https://jobs.lever.co/belvederetrading/10746b3d-1760-4573-9b63-b93f5a5e4fc0/apply"


@pytest.fixture(autouse=True)
def no_network(request):
    """Fails a test that tried to reach past loopback, even if it swallowed the error, or a server's thread did.
    A test that goes live on purpose names its hosts: @pytest.mark.live_network("example.com")."""
    marked = request.node.get_closest_marker("live_network")
    if marked and not marked.args:
        pytest.fail("live_network needs the hosts this test may reach, by name.")
    network_block.begin(marked.args if marked else ())
    yield
    tried = network_block.end()
    if tried:
        pytest.fail("Reached past loopback:\n" + "\n".join(tried), pytrace=False)


@pytest.fixture(autouse=True)
def data_folder() -> Path:
    """Each test runs on a fresh copy of the Test Person sample data in APPLY_HOME, with the
    tests' Story bank (the episodes they quote): whatever a test writes there (Traces, sent
    files, briefs, the ledger, Story bank answers) is gone by the next test."""
    if home.HOME.resolve() != TEST_HOME:  # never anything but the folder this run made
        pytest.exit(f"Refusing to delete {home.HOME}: it is not the tests' own data folder.", 2)
    shutil.rmtree(home.HOME, ignore_errors=True)
    shutil.copytree(home.SAMPLE, home.HOME)
    shutil.copy(FIXTURES / "story-bank.md", home.STORY_BANK)
    gates.companies.cache_clear()  # read again from this test's briefs
    return home.HOME


@pytest.fixture(autouse=True)
def cover_letters_printed_as_their_text(monkeypatch):
    """A cover letter's PDF holds just its text, so a run needs no Chrome (test_cover_letter prints real ones)."""
    monkeypatch.setattr(cover_letter, "pdf", lambda text, posting, profile, path, today=None: path.write_text(text))


# Lisul's switches in the real policies.yaml (live runs, phone pushes, headed Workers) are his to
# flip; tests run with them at their defaults, so flipping one never breaks a test.
SWITCHES = ("live_runs", "phone_push", "worker_headless")


@pytest.fixture(autouse=True)
def switches_at_their_defaults(monkeypatch):
    load = profile.load_policies

    def without_switches(path: Path = profile.POLICIES) -> dict:
        rules = load(path)
        if Path(path).resolve() == profile.POLICIES.resolve():
            for switch in SWITCHES:
                rules.pop(switch, None)
        return rules

    for module in (profile, cli, browsers):
        monkeypatch.setattr(module, "load_policies", without_switches)


@pytest.fixture
def one_pager() -> Path:
    return FIXTURES / "one-pager.pdf"


@pytest.fixture
def job_server():
    with FakeJobServer(ARC_FORM) as server:
        yield server


@pytest.fixture
def ashby_server():
    with FakeJobServer(SKYDIO_FORM) as server:
        yield server


@pytest.fixture
def lever_server():
    with FakeLeverServer(IMMUTA_FORM) as server:
        yield server
# Saved with education lists and a school search for "Example State University".
ANDURIL_FORM = FORMS / "greenhouse-anduril"
ANDURIL_URL = "https://job-boards.greenhouse.io/andurilindustries/jobs/5265158007"
COINBASE_FORM = FORMS / "greenhouse-coinbase"
COINBASE_URL = "https://job-boards.greenhouse.io/embed/job_app?for=coinbase&token=8175510"
PERRY_FORM = FORMS / "workable-perryhomes"
PERRY_URL = "https://apply.workable.com/perryhomes/j/D309E69A5B/apply"
SCOUT_FORM = FORMS / "workable-scout"
SCOUT_URL = "https://apply.workable.com/scout-clean-energy/j/7BF0CEDF9F/apply"
# Asks a date of its own: "What is your earliest available start date?"
ENFOS_FORM = FORMS / "workable-enfos"
ENFOS_URL = "https://apply.workable.com/enfos-inc/j/CA15908E0A/apply"


