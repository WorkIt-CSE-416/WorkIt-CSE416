"""Repairs, on real git repos in a temporary folder: a fake Claude makes a
scripted edit and commit in the Repair's worktree, and a fake suite says how
the tests went. Real claude never runs here."""

import fcntl
import subprocess
from datetime import date
from pathlib import Path

import pytest
from fakes import ScriptedUsage

from apply import claude_fill, cli, eightfold, home
from apply.adapters import Drive, UsageReading
from apply.model import Status
from apply.notify import RecordingNotifier
from apply.repair import (
    FIXED,
    MISSING,
    NEEDS_LISUL,
    NOT_A_BUG,
    OPEN,
    RepairRequest,
    RepairRequests,
)
from apply.repairer import Repairer, repair_later
from apply.tracker import InMemoryTracker, Row

TODAY = date(2026, 10, 16)
PLANNER = "apply-agent/src/apply/planner.py"
PLANNER_TEST = "apply-agent/tests/test_planner.py"
FAILED_ID = "6e2de8e6"
GREENHOUSE = "apply-agent/src/apply/greenhouse.py"
GREENHOUSE_CODE = """from apply.confirmation import wait_for_confirmation

SUBMIT = "Submit application"


class GreenhouseFiller:
    def fill(self, page):
        return {}

    def submit(self, page):
        page.click(SUBMIT)
        wait_for_confirmation(page, lambda: True)
"""
ENGINE = "autofiller_extension/fill-engine"
ENGINE_FILLER = "src/greenhouse.ts"
ENGINE_TEST = "test/greenhouse.spec.ts"
ENGINE_FILES = {
    ENGINE_FILLER: "export function fill() { return {}; }\n",
    ENGINE_TEST: 'test("fills a school", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n',
    "dist/engine.js": "var FillEngine = {};\n",
    "package.json": '{"scripts": {"test": "playwright test"}}\n',
    "playwright.config.ts": "export default {};\n",
    "test/build.ts": "export default () => {};\n",
    "test/fixtures/forms/arc/form.html": "<form></form>\n",
}


def git(folder: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(folder), *args], check=True, capture_output=True, text=True).stdout.strip()


def new_repo(folder: Path, branch: str, files: dict[str, str]) -> None:
    subprocess.run(["git", "init", "-q", "-b", branch, str(folder)], check=True)
    git(folder, "config", "user.name", "Lisul")
    git(folder, "config", "user.email", "lisul@example.com")
    git(folder, "config", "commit.gpgsign", "false")
    for name, text in files.items():
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_text(text)


@pytest.fixture
def engine_origin(tmp_path: Path) -> Path:
    """The Fill engine's origin: a bare repo whose tracked branch is main."""
    origin, start = tmp_path / "engine.git", tmp_path / "engine-start"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    new_repo(start, "main", ENGINE_FILES)
    git(start, "add", ".")
    git(start, "commit", "-q", "-m", "Start the engine")
    git(start, "push", "-q", str(origin), "main")
    return origin


@pytest.fixture
def repo(tmp_path: Path, engine_origin: Path) -> Path:
    """Apply's repo: the integration branch checked out, pushed to a bare
    origin, with the Fill engine as the submodule autofiller_extension/fill-engine."""
    origin, repo = tmp_path / "origin.git", tmp_path / "repo"
    subprocess.run(["git", "init", "-q", "--bare", str(origin)], check=True)
    files = {
        PLANNER: "RULES = []\n",
        PLANNER_TEST: "def test_email():\n    assert True\n    assert 1 == 1\n",
        "apply-agent/src/apply/submit_guard.py": "BLOCK = True\n",
        GREENHOUSE: GREENHOUSE_CODE,
        "apply-agent/tests/conftest.py": "FIXTURES = 'fixtures'\n",
        "apply-agent/applicant-profile.yaml": "identity:\n  email: lisul@example.com\n",
        "apply-agent/tests/fixtures/feed.json": "[]\n",
    }
    new_repo(repo, "apply-livefill", files)
    git(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", "-b", "main", str(engine_origin), ENGINE)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "Start Apply")
    git(repo, "remote", "add", "origin", str(origin))
    git(repo, "push", "-q", "origin", "apply-livefill")
    return repo


class FakeClaude:
    """Claude's coding session: runs `edit(folder)` in the Repair's worktree,
    then gives `verdict`."""

    def __init__(self, edit=lambda folder: None, verdict: str = "fixed", capped: bool = False):
        self._edit = edit
        self._verdict = verdict
        self._capped = capped
        self.sessions: list[dict] = []

    def work(self, **session) -> Drive:
        self.sessions.append(session)
        self._edit(session["folder"].parent)  # the worktree; the session starts in its apply-agent/
        if self._capped:
            return Drive(None, 81, 7_000_000, capped=True)
        return Drive({"verdict": self._verdict, "summary": "Answer school questions from the profile."}, 12, 300_000)


def commits(*changes: tuple[str, str | None], message: str = "Answer a school question from the profile"):
    """An edit that writes (or, with None, deletes) each file and commits it."""
    def edit(folder: Path) -> None:
        for name, text in changes:
            if text is None:
                (folder / name).unlink()
            else:
                (folder / name).parent.mkdir(parents=True, exist_ok=True)
                (folder / name).write_text(text)
        git(folder, "add", "-A")
        git(folder, "-c", "user.name=Lisul", "-c", "user.email=lisul@example.com", "commit", "-q", "-m", message)
    return edit


FIX = commits(
    (PLANNER, "RULES = ['school']\n"),
    (PLANNER_TEST, "def test_email():\n    assert True\n    assert 1 == 1\n\n\ndef test_school():\n    assert 'school'\n"),
)


def request(signature: str = "keyerror-planner-fit-abc123", kind: str = "failure") -> RepairRequest:
    return RepairRequest(signature, kind, "greenhouse", "https://job-boards.greenhouse.io/arc/jobs/1",
                         failure="KeyError: 'school'", traceback="Traceback ...",
                         applications=[{"id": FAILED_ID, "url": "https://job-boards.greenhouse.io/arc/jobs/1"}])


class World:
    def __init__(self, repo: Path, tmp_path: Path, claude: FakeClaude, suite_passes: bool = True, cap: int = 3,
                 usage: UsageReading = UsageReading(), engine_passes: bool = True, engine_builds: str | None = None,
                 branch: str = "apply-livefill"):
        """`engine_builds`: what the engine's tests build dist/engine.js into (as `npm test` does), if not what is committed."""
        self.repo = repo
        self.requests = RepairRequests(tmp_path / "repairs")
        self.notifier = RecordingNotifier()
        self.tracker = InMemoryTracker()
        self.tracker.add(Row(FAILED_ID, "Arc", "Intern", "https://job-boards.greenhouse.io/arc/jobs/1", "greenhouse",
                             Status.FAILED, reason="KeyError: 'school'"))
        self.claude = claude
        self.suites: list[Path] = []
        self.engines_tested: list[str] = []  # the engine each Apply suite ran against
        self.engine_suites: list[Path] = []

        def suite(folder: Path) -> tuple[bool, str]:
            self.suites.append(folder)
            self.engines_tested.append(git(folder / ENGINE, "rev-parse", "HEAD"))
            return suite_passes, "547 passed" if suite_passes else "1 failed, 546 passed"

        def engine_suite(folder: Path) -> tuple[bool, str]:
            self.engine_suites.append(folder)
            if engine_builds is not None:
                (folder / "dist/engine.js").write_text(engine_builds)
            return engine_passes, "180 passed" if engine_passes else "1 failed, 179 passed"

        self.repairer = Repairer(
            repo=repo, requests=self.requests, claude=claude, usage=ScriptedUsage(lambda: usage),
            notifier=self.notifier, tracker=lambda: self.tracker, branch=branch,
            worktrees=tmp_path / "worktrees", policy={"max_per_day": cap, "max_turns": 80, "max_tokens": 6_000_000},
            suite=suite, engine_suite=engine_suite, engine_setup=lambda folder: None, today=lambda: TODAY,
        )

    def repair(self, *requests: RepairRequest) -> list[RepairRequest]:
        for r in requests or [request()]:
            self.requests.add(r)
        return self.repairer.repair_waiting()

    def integration(self, name: str = PLANNER) -> str:
        return git(self.repo, "show", f"apply-livefill:{name}")

    def engine(self, name: str = ENGINE_FILLER) -> str:
        """`name` on the engine's tracked branch, at its origin."""
        return git(self.engine_origin, "show", f"main:{name}")

    @property
    def engine_origin(self) -> Path:
        return self.repo.parent / "engine.git"


def engine_commits(*changes: tuple[str, str | None], message: str = "Pick a school from the list"):
    """An edit that commits each change inside the Fill engine (autofiller_extension/fill-engine)."""
    def edit(folder: Path) -> None:
        commits(*changes, message=message)(folder / ENGINE)
    return edit


ENGINE_FIX = engine_commits(
    (ENGINE_FILLER, "export function fill() { return {school: 'SBU'}; }\n"),
    (ENGINE_TEST, ENGINE_FILES[ENGINE_TEST] + 'test("picks a school", () => {\n  expect(3).toBe(3);\n});\n'),
)


def test_a_repair_in_a_filler_merges_on_the_engines_branch_and_apply_runs_it_next(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(ENGINE_FIX))

    [done] = world.repair()

    assert done.status == FIXED
    fixed = "export function fill() { return {school: 'SBU'}; }"
    assert world.engine() == fixed  # merged into the engine's tracked branch and pushed
    engine_head = git(world.engine_origin, "rev-parse", "main")
    assert world.engine_suites and world.engines_tested == [engine_head]  # both suites ran on the fix
    # Apply's integration branch points at it, pushed, and the checkout Apply runs from has it.
    assert git(repo, "rev-parse", f"apply-livefill:{ENGINE}") == engine_head
    assert git(repo, "rev-parse", "apply-livefill") == git(tmp_path / "origin.git", "rev-parse", "apply-livefill")
    assert (repo / ENGINE / ENGINE_FILLER).read_text().strip() == fixed
    assert world.tracker.get(FAILED_ID).status == Status.QUEUED
    assert not (tmp_path / "worktrees" / done.signature).exists()


def waited_for_lisul(world: World, done: RepairRequest, why: str) -> None:
    """The Repair waits on its branches for Lisul: nothing merged in either repo, nothing queued."""
    assert done.status == NEEDS_LISUL and why in done.why
    assert world.engine() == ENGINE_FILES[ENGINE_FILLER].rstrip("\n")
    assert git(world.repo, "rev-parse", f"apply-livefill:{ENGINE}") == git(world.engine_origin, "rev-parse", "main")
    assert git(world.repo / ENGINE, "rev-parse", "--verify", "repair/keyerror-planner-fit-abc123")  # the engine branch stays
    assert world.tracker.get(FAILED_ID).status == Status.FAILED
    [(title, message)] = world.notifier.sent
    assert "needs you" in title and "repair/keyerror-planner-fit-abc123" in message


@pytest.mark.parametrize("protected", ["package.json", "package-lock.json", "playwright.config.ts", "tsconfig.json",
                                       "test/build.ts", "README.md", ".gitignore"])
def test_a_repair_that_touches_a_protected_engine_path_waits_for_lisul(repo, tmp_path, protected):
    world = World(repo, tmp_path, FakeClaude(engine_commits((ENGINE_FILLER, "export const x = 1;\n"), (protected, "{}\n"))))

    [done] = world.repair()

    waited_for_lisul(world, done, f"{ENGINE}/{protected}")
    assert world.suites == world.engine_suites == []  # nothing the Repair wrote ran in the gate


@pytest.mark.parametrize("edit, why", [
    (engine_commits((ENGINE_TEST, 'test("fills a school", () => {\n  expect(1).toBe(1);\n});\n')), "lost assertions"),
    (engine_commits((ENGINE_TEST, 'test.skip("fills a school", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n')),
     "lost fills a school"),
    (engine_commits((ENGINE_TEST, None)), "lost every test"),
    (engine_commits(("test/fixtures/forms/arc/form.html", "<form>easier</form>\n")), "saved form"),
    (engine_commits((ENGINE_FILLER, "export function fill() { document.forms[0].requestSubmit(); }\n")),
     "never submits"),
    (engine_commits((ENGINE_FILLER, "export function fill() { return {}; }\n// x\n"),
                    message="Fix school\n\nCo-Authored-By: Claude <noreply@anthropic.com>"), "commit message"),
])
def test_a_repair_that_weakens_an_engine_test_or_makes_it_submit_waits_for_lisul(repo, tmp_path, edit, why):
    world = World(repo, tmp_path, FakeClaude(edit))

    [done] = world.repair()

    waited_for_lisul(world, done, why)
    assert world.suites == world.engine_suites == []


@pytest.mark.parametrize("world_options, why", [
    ({"engine_passes": False}, "the engine's tests failed: 1 failed"),
    ({"suite_passes": False}, "the suite failed: 1 failed"),  # Apply's suite, against the changed engine
    ({"engine_builds": "var FillEngine = {school: 1};\n"}, "dist isn't the build"),  # dist/ not rebuilt and committed
])
def test_a_repair_that_fails_either_suite_waits_for_lisul(repo, tmp_path, world_options, why):
    world = World(repo, tmp_path, FakeClaude(ENGINE_FIX), **world_options)

    [done] = world.repair()

    waited_for_lisul(world, done, why)


def test_a_repair_that_commits_only_in_the_engine_is_no_empty_repair(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(ENGINE_FIX))

    [done] = world.repair()

    # Apply's only new commit is the one that moves its pointer to the engine.
    assert git(repo, "log", "--format=%s", "-1", "apply-livefill").startswith("Move the Fill engine to ")
    assert done.status == FIXED and "fill-engine's main" in world.notifier.sent[0][1]


def test_the_engines_branch_moving_during_a_repair_still_merges_and_is_tested_again(repo, tmp_path, engine_origin):
    def fix_while_the_engine_moves(folder: Path) -> None:
        other = tmp_path / "engine-other"
        subprocess.run(["git", "clone", "-q", str(engine_origin), str(other)], check=True)
        (other / "src/lever.ts").write_text("export const QUIRKS = [];\n")
        git(other, "add", ".")
        git(other, "-c", "user.name=Lisul", "-c", "user.email=lisul@example.com", "commit", "-q", "-m", "Fill a Lever quirk")
        git(other, "push", "-q", "origin", "main")
        ENGINE_FIX(folder)

    world = World(repo, tmp_path, FakeClaude(fix_while_the_engine_moves))

    [done] = world.repair()

    assert done.status == FIXED
    assert world.engine() == "export function fill() { return {school: 'SBU'}; }"
    assert world.engine("src/lever.ts") == "export const QUIRKS = [];"
    assert len(world.engine_suites) == 2 and len(world.suites) == 2  # both again, with the engine's newer commits in
    assert world.engines_tested[-1] == git(engine_origin, "rev-parse", "main") == git(repo, "rev-parse", f"apply-livefill:{ENGINE}")


def test_a_repair_that_changes_no_engine_code_leaves_the_engine_alone(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(FIX))
    pinned = git(repo, "rev-parse", f"apply-livefill:{ENGINE}")

    [done] = world.repair()

    assert done.status == FIXED and world.engine_suites == []
    assert git(repo, "rev-parse", f"apply-livefill:{ENGINE}") == pinned == git(world.engine_origin, "rev-parse", "main")
    assert world.engines_tested == [pinned]  # Apply's suite ran against the engine Apply pins


def test_a_missing_fact_leaves_no_engine_branch(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(verdict="not a bug"))

    [done] = world.repair(request("missing-favorite-color-abc123", MISSING))

    assert done.status == NOT_A_BUG
    assert "repair/missing-favorite-color-abc123" not in git(repo / ENGINE, "branch", "--list")
    assert not (tmp_path / "worktrees" / done.signature).exists()


def test_a_repair_that_passes_its_gate_is_merged_pushed_and_its_application_queued_again(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(FIX))

    [done] = world.repair()

    assert done.status == FIXED
    assert done.branch == "repair/keyerror-planner-fit-abc123"
    assert world.integration() == "RULES = ['school']"
    assert (repo / PLANNER).read_text() == "RULES = ['school']\n"  # the checkout Apply runs from has it
    assert git(repo, "rev-parse", "apply-livefill") == git(tmp_path / "origin.git", "rev-parse", "apply-livefill")
    row = world.tracker.get(FAILED_ID)
    assert row.status == Status.QUEUED and "Repaired" in row.reason
    [(title, message)] = world.notifier.sent
    assert "Repaired" in title and "Answer school questions" in message
    assert world.suites  # the whole suite ran in the Repair's worktree
    assert not (tmp_path / "worktrees" / done.signature).exists()  # its worktree is gone once merged


def test_the_session_gets_the_request_the_rules_and_only_the_tools_it_needs(repo, tmp_path):
    claude = FakeClaude(FIX)
    world = World(repo, tmp_path, claude)

    world.repair()

    [session] = claude.sessions
    folder = tmp_path / "worktrees" / "keyerror-planner-fit-abc123"
    assert session["folder"] == folder / "apply-agent"  # where `uv run pytest` runs; edits reach the whole worktree
    assert session["model"] == "sonnet" and (session["max_turns"], session["max_tokens"]) == (80, 6_000_000)
    assert "KeyError: 'school'" in session["prompt"] and "Traceback ..." in session["prompt"]
    for rule in ("failing test first", "invent a fact about the applicant", "Co-Authored-By", "submit_guard.py"):
        assert rule.casefold() in session["system"].casefold()
    assert set(session["tools"]) == {"Read", "Edit", "Write", "Grep", "Glob", "Bash"}
    bash = [rule for rule in session["allowed"] if rule.startswith("Bash")]
    git_commands = ("git add", "git commit", "git diff", "git status", "git log")
    assert sorted(bash) == sorted(f"Bash({c}:*)" for c in (
        "uv run pytest", *git_commands, *(c.replace("git", "git -C ../autofiller_extension/fill-engine") for c in git_commands),
        "npm --prefix ../autofiller_extension/fill-engine test", "npm --prefix ../autofiller_extension/fill-engine run build"))
    edits = [rule for rule in session["allowed"] if rule.startswith(("Edit", "Write"))]
    # Only Apply's code, tests and docs, and the engine's code, tests and bundle, in its own worktree...
    assert sorted(edits) == sorted([*(f"Edit(/{folder}/apply-agent/{part}/**)" for part in ("src/apply", "tests", "docs")),
                                    *(f"Edit(/{folder}/{ENGINE}/{part}/**)" for part in ("src", "test", "dist"))])
    # ...and never a conftest.py (which its own `uv run pytest` would run) nor a protected path.
    denied = session["denied"]
    assert f"Edit(/{folder}/**/conftest.py)" in denied
    for path in ("apply-agent/src/apply/submit_guard.py", "apply-agent/tests/test_repairer.py",
                 f"{ENGINE}/package.json", f"{ENGINE}/playwright.config.ts", f"{ENGINE}/test/build.ts"):
        assert f"Edit(/{folder}/{path})" in denied
    # The applicant's own files live in the data folder: a Repair may read them, never change them.
    assert f"Edit(/{home.HOME}/**)" in denied
    for name in ("applicant-profile.yaml", "story-bank.md", "answer-bank.yaml"):
        assert f"Read(/{home.HOME / name})" in session["allowed"]
        assert str(home.HOME / name) in session["system"]
    assert "npm --prefix ../autofiller_extension/fill-engine test" in session["system"]
    assert "conftest.py" in session["system"] and "GreenhouseFiller.submit" in session["system"]
    profiles = Path(session["env"]["APPLY_PROFILES"])
    assert not profiles.is_relative_to(home.HOME / "profiles")  # never a Worker profile
    assert int(session["env"]["BASH_DEFAULT_TIMEOUT_MS"]) >= 15 * 60_000  # the whole suite takes about 7 minutes


@pytest.mark.parametrize("protected", [
    "apply-agent/src/apply/submit_guard.py", "apply-agent/applicant-profile.yaml", "apply-agent/policies.yaml", "apply-agent/story-bank.md",
    "apply-agent/src/apply/orchestrator.py", "apply-agent/src/apply/presubmit.py", "apply-agent/src/apply/keychain.py",
    "apply-agent/src/apply/accounts.py", "apply-agent/src/apply/repairer.py", "apply-agent/pyproject.toml", "README.md",
    # What sends the form, checks it was sent, signs in or reads mail, and what holds an Application or rules it out.
    "apply-agent/src/apply/confirmation.py", "apply-agent/src/apply/browsers.py", "apply-agent/src/apply/gmail.py",
    "apply-agent/src/apply/walls.py", "apply-agent/src/apply/eligibility.py", "apply-agent/src/apply/essays.py",
    "apply-agent/answer-bank.yaml", "apply-agent/src/apply/account_pages.py", "apply-agent/src/apply/oracle.py",
    # Code its own `uv run pytest` would run before any gate: a conftest.py anywhere, or pytest's config.
    "apply-agent/tests/conftest.py", "apply-agent/tests/workday/conftest.py", "apply-agent/src/apply/conftest.py", "apply-agent/conftest.py",
    "apply-agent/tests/pytest.ini", "apply-agent/tests/tox.ini",
])
def test_a_repair_that_touches_a_protected_path_waits_for_lisul_on_its_branch(repo, tmp_path, protected):
    world = World(repo, tmp_path, FakeClaude(commits((PLANNER, "RULES = ['school']\n"), (protected, "changed\n"))))
    before = git(repo, "rev-parse", "apply-livefill")

    [done] = world.repair()

    assert done.status == NEEDS_LISUL
    assert protected in done.why
    assert world.suites == []  # nothing the Repair wrote ran in the gate
    assert git(repo, "rev-parse", "apply-livefill") == before  # nothing merged
    assert git(repo, "rev-parse", "--verify", "repair/keyerror-planner-fit-abc123")  # the branch stays for Lisul
    assert world.tracker.get(FAILED_ID).status == Status.FAILED
    [(_title, message)] = world.notifier.sent
    assert "repair/keyerror-planner-fit-abc123" in message and protected in message


def test_a_repair_may_change_how_a_filler_fills(repo, tmp_path):
    fills = GREENHOUSE_CODE.replace("return {}", "return {'school': 'SBU'}")
    world = World(repo, tmp_path, FakeClaude(commits((GREENHOUSE, fills))))

    [done] = world.repair()

    assert done.status == FIXED and world.integration(GREENHOUSE) == fills.rstrip("\n")


@pytest.mark.parametrize("changed", [
    GREENHOUSE_CODE.replace("page.click(SUBMIT)", "page.click(SUBMIT)\n        page.click(SUBMIT)"),
    GREENHOUSE_CODE.replace('SUBMIT = "Submit application"', 'SUBMIT = "Save draft"'),
    GREENHOUSE_CODE.replace("    def submit(self, page):\n        page.click(SUBMIT)\n", "    def _old(self, page):\n"),
    GREENHOUSE_CODE + "\n\ndef wait_for_confirmation(page, confirmed):\n    pass\n",  # the wait replaced
    None,  # the whole Filler deleted
    "class GreenhouseFiller:\n    def submit(\n",  # not Python
])
def test_a_repair_that_changes_how_a_filler_submits_waits_for_lisul(repo, tmp_path, changed):
    world = World(repo, tmp_path, FakeClaude(commits((GREENHOUSE, changed))))

    [done] = world.repair()

    assert done.status == NEEDS_LISUL and GREENHOUSE in done.why
    assert world.suites == []
    assert world.integration(GREENHOUSE) == GREENHOUSE_CODE.rstrip("\n")


CLAUDE_FILL = "apply-agent/src/apply/claude_fill.py"


@pytest.mark.parametrize("old, new, changed", [
    ("        self._guard.arm()\n", "", "ClaudeFill._drive"),  # Claude drives with the guard lifted
    ("if blocked := self._guard.blocked():", "if blocked := []:", "ClaudeFill._drive"),  # what it blocked is no Handoff
    # Claude would be told the password, or an account page would be no sign-in.
    ("told = self._account_pages.told()", "told = self._account_pages.told() + str(self._accounts_password)",
     "ClaudeFill._session"),
])
def test_a_repair_that_changes_how_claude_fill_is_guarded_waits_for_lisul(repo, tmp_path, old, new, changed):
    guarded = Path(claude_fill.__file__).read_text()
    (repo / CLAUDE_FILL).write_text(guarded)
    git(repo, "add", CLAUDE_FILL)
    git(repo, "commit", "-q", "-m", "Add Claude fill")
    assert old in guarded
    world = World(repo, tmp_path, FakeClaude(commits((CLAUDE_FILL, guarded.replace(old, new)))))

    [done] = world.repair()

    assert done.status == NEEDS_LISUL and changed in done.why and CLAUDE_FILL in done.why
    assert world.suites == []
    assert world.integration(CLAUDE_FILL) == guarded.rstrip("\n")


EIGHTFOLD = "apply-agent/src/apply/eightfold.py"


def test_a_repair_that_changes_how_eightfold_submits_waits_for_lisul(repo, tmp_path):
    filler = Path(eightfold.__file__).read_text()
    (repo / EIGHTFOLD).write_text(filler)
    git(repo, "add", EIGHTFOLD)
    git(repo, "commit", "-q", "-m", "Add the Eightfold Filler")
    sends = "    def submit(self, page: Page) -> None:\n"
    assert sends in filler
    world = World(repo, tmp_path, FakeClaude(commits((EIGHTFOLD, filler.replace(sends, sends + "        page.keyboard.press(\"Enter\")\n")))))

    [done] = world.repair()

    assert done.status == NEEDS_LISUL and "EightfoldFiller.submit" in done.why
    assert world.integration(EIGHTFOLD) == filler.rstrip("\n")


@pytest.mark.parametrize("edit, why", [
    (commits((PLANNER_TEST, "def test_email():\n    assert True\n")), "lost"),
    (commits((PLANNER_TEST, None)), "lost"),
    (commits((PLANNER_TEST, "def test_other():\n    assert True\n    assert 1 == 1\n")), "lost"),
    (commits(("apply-agent/tests/fixtures/feed.json", "[1]\n")), "saved form"),
    (commits((PLANNER, "RULES = ['school']\n"), message="Fix school\n\nCo-Authored-By: Claude <noreply@anthropic.com>"),
     "commit message"),
])
def test_a_repair_that_weakens_a_test_or_names_claude_waits_for_lisul(repo, tmp_path, edit, why):
    world = World(repo, tmp_path, FakeClaude(edit))

    [done] = world.repair()

    assert done.status == NEEDS_LISUL and why in done.why


def test_a_repair_whose_suite_fails_waits_for_lisul(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(FIX), suite_passes=False)

    [done] = world.repair()

    assert done.status == NEEDS_LISUL and "1 failed" in done.why
    assert world.integration() == "RULES = []"


def test_a_repair_that_hits_its_cap_or_commits_nothing_waits_for_lisul(repo, tmp_path):
    capped = World(repo, tmp_path / "a", FakeClaude(FIX, capped=True)).repair()
    nothing = World(repo, tmp_path / "b", FakeClaude(verdict="fixed")).repair(request("other-abc123"))

    assert capped[0].status == NEEDS_LISUL and "cap" in capped[0].why
    assert nothing[0].status == NEEDS_LISUL and "no commit" in nothing[0].why


def test_a_missing_fact_no_profile_entry_answers_stays_lisuls(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(verdict="not a bug"))

    [done] = world.repair(request("missing-favorite-color-abc123", MISSING))

    assert done.status == NOT_A_BUG
    assert world.notifier.sent == []
    assert world.tracker.get(FAILED_ID).status == Status.FAILED
    assert "repair/missing-favorite-color-abc123" not in git(repo, "branch", "--list")


def test_the_integration_branch_moving_during_a_repair_still_merges(repo, tmp_path):
    def fix_while_lisul_commits(folder: Path) -> None:
        (repo / "apply-agent/src/apply/lever.py").write_text("QUIRKS = []\n")
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "Fill a Lever quirk")
        FIX(folder)

    world = World(repo, tmp_path, FakeClaude(fix_while_lisul_commits))

    [done] = world.repair()

    assert done.status == FIXED
    assert world.integration() == "RULES = ['school']"
    assert world.integration("apply-agent/src/apply/lever.py") == "QUIRKS = []"


def test_repairs_stop_at_the_days_cap_and_wait_for_tomorrow(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(verdict="not a bug"), cap=2)

    done = world.repair(request("a-abc123"), request("b-abc123"), request("c-abc123"))

    assert len(done) == 2
    assert [r.signature for r in world.requests.waiting()] == ["c-abc123"]


def test_no_repair_runs_while_lisuls_usage_is_high(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(FIX), usage=UsageReading(five_hour=0.9))

    assert world.repair() == []
    assert [r.status for r in world.requests.all()] == [OPEN]


def test_only_one_repair_runs_at_a_time(repo, tmp_path):
    world = World(repo, tmp_path, FakeClaude(FIX))
    (tmp_path / "worktrees").mkdir()
    with open(tmp_path / "worktrees" / ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)  # another `apply repair` is going

        assert world.repair() == []

    assert [r.status for r in world.requests.all()] == [OPEN]



def test_a_run_with_waiting_requests_starts_apply_repair_in_the_background(tmp_path):
    requests = RepairRequests(tmp_path / "repairs")
    started = []

    def spawn(argv, **options):
        started.append((argv, options))

    assert repair_later(requests, {"max_per_day": 1}, spawn) is False  # nothing waits: nothing starts
    requests.add(request())

    assert repair_later(requests, {"max_per_day": 1}, spawn) is True
    [(argv, options)] = started
    assert argv[-1] == "repair" and options["start_new_session"] is True  # outlives the run
    assert Path(options["stdout"].name) == tmp_path / "repairs" / "repair.log"


@pytest.mark.parametrize("policy", [{"max_per_day": 0}, {}])
def test_with_repairs_off_no_repair_process_starts_even_outside_a_git_checkout(tmp_path, monkeypatch, policy):
    requests = RepairRequests(tmp_path / "repairs")
    requests.add(request())
    started = []
    assert repair_later(requests, policy, lambda argv, **options: started.append(argv)) is False
    assert started == []

    monkeypatch.chdir(tmp_path)  # no git here, and `apply repair` itself says Repairs are off before looking for one
    monkeypatch.setattr(cli, "load_policies", lambda: {"repair": policy})
    monkeypatch.setattr(cli, "live_repairer", lambda *a, **k: pytest.fail("a Repairer was made"))
    cli.main(["repair"])


def test_a_repair_never_runs_on_main(repo, tmp_path):
    # Its pushes would move fill-engine's main and WorkIt's main to code Claude wrote.
    claude = FakeClaude(FIX)
    world = World(repo, tmp_path, claude, branch="main")

    assert world.repair() == []
    assert claude.sessions == []
    assert world.requests.waiting()  # it waits for a run from a branch of its own


def test_a_repair_that_could_not_finish_waits_for_lisul_whatever_it_committed(repo, tmp_path):
    # Seen live: a session denied a command gave up, and had only "not a bug" to say so.
    claude = FakeClaude(FIX, verdict="blocked")
    world = World(repo, tmp_path, claude)

    [done] = world.repair()

    assert "blocked" in claude.sessions[0]["schema"]["properties"]["verdict"]["enum"]
    assert done.status == NEEDS_LISUL and "Answer school questions" in done.why
    assert world.integration() == "RULES = []"  # its half-done work is never merged
    [(_title, message)] = world.notifier.sent
    assert "repair/keyerror-planner-fit-abc123" in message


def test_repairs_on_outside_a_git_checkout_stop_on_one_line(monkeypatch):
    monkeypatch.setattr(cli, "load_policies", lambda: {"repair": {"max_per_day": 1}})
    monkeypatch.setattr(cli, "CHECKOUT", Path("/"))  # no git repo there
    with pytest.raises(SystemExit) as stopped:
        cli.main(["repair"])
    assert "git checkout" in str(stopped.value.code) and "\n" not in str(stopped.value.code)
