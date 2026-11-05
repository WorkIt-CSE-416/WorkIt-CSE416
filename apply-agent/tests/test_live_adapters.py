"""The live wiring: `apply run` with no fakes builds every real adapter.
Nothing here reaches the network, Keychain or Claude: building an adapter
only reads where it will connect, and those that look something up at
once (the Sheet, and the Gmail app password and ntfy topic in Keychain) are
stubbed."""

import json
import os
import urllib.request

import pytest
from conftest import FIXTURES
from trackers import FakeSpreadsheet

from apply import cli, dashboard, home, orchestrator, rehearsal, sheet
from apply.browsers import WorkerBrowsers
from apply.claude_cli import ClaudeCLI
from apply.clock import SystemClock
from apply.feed import SimplifyFeed
from apply.gmail import GmailMailbox
from apply.keychain import GMAIL, PHONE_PUSH, MacKeychain
from apply.notify import MacNotifier, NtfyNotifier, RecordingNotifier
from apply.profile import ApplicantProfile
from apply.records import FolderRecords, GitRecords
from apply.sheet import TABS
from apply.tracker import FileTracker, InMemoryTracker, WorkItTracker


class _Opened(list):
    behind: list[str]


@pytest.fixture(autouse=True)
def windows(monkeypatch, tmp_path) -> list[tuple[str, object]]:
    """The dashboard windows a command opened, none for real; Worker profiles in a scratch folder."""
    monkeypatch.setenv("APPLY_PROFILES", str(tmp_path / "profiles"))
    opened = _Opened()
    behind = opened.behind = []  # the windows opened behind Lisul's app, as a run's are
    monkeypatch.setattr(dashboard, "open_window", lambda url, profile, front=True:
                        opened.append((url, profile)) or (front or behind.append(url)))
    return opened


def a_profile_with_live_runs(folder, live_runs):
    """The test Applicant profile in a scratch folder, with a policies.yaml beside it that switches
    live runs on or off (None: a policies.yaml that never mentions them)."""
    folder.mkdir()
    profile = folder / "applicant-profile.yaml"
    profile.write_text((FIXTURES / "profile.yaml").read_text())
    policies = (FIXTURES / "policies.yaml").read_text()
    (folder / "policies.yaml").write_text(policies + (f"live_runs: {str(live_runs).lower()}\n" if live_runs is not None else ""))
    return profile


def test_apply_run_without_fakes_wires_every_live_adapter(monkeypatch, tmp_path):
    mine = a_profile_with_live_runs(tmp_path / "mine", True)
    with (mine.parent / "policies.yaml").open("a") as policies:
        policies.write("records_remote: https://github.com/test-person/my-records.git\n")
    sheet_id = tmp_path / "sheet-id"
    sheet_id.write_text("the-sheet\n")
    opened = []
    monkeypatch.setattr(sheet, "SHEET_ID", sheet_id)
    monkeypatch.setattr(sheet, "open_sheet", lambda sheet_id: opened.append(sheet_id) or FakeSpreadsheet(tmp_path / "sheet", TABS))
    looked_up = []
    monkeypatch.setattr(MacKeychain, "password", lambda self, account: looked_up.append((self._service, account)) or "app")
    runs = []
    monkeypatch.setattr(orchestrator, "run", lambda adapters, profile, workers, **kinds: runs.append(adapters))

    cli.main(["run", "--profile", str(mine), "--workers", "4"])

    [adapters] = runs
    assert len(adapters.board.state()["tiles"]) == 4  # a dashboard tile per Worker
    assert isinstance(adapters.feed, SimplifyFeed)
    # Apply's Tracker file, writing each status to WorkIt; the retired Sheet only read, one time, to copy its rows
    assert isinstance(adapters.tracker, WorkItTracker) and isinstance(adapters.tracker.inner, FileTracker)
    assert opened == ["the-sheet"] and adapters.tracker.inner.path.exists()
    assert isinstance(adapters.site, WorkerBrowsers)
    assert isinstance(adapters.claude, ClaudeCLI) and adapters.usage is adapters.claude
    assert isinstance(adapters.mailbox, GmailMailbox) and (GMAIL, "test.person@example.com") in looked_up
    assert isinstance(adapters.phone, NtfyNotifier) and (PHONE_PUSH, "ntfy.sh") in looked_up
    assert len(looked_up) == 2
    assert isinstance(adapters.clock, SystemClock)
    assert isinstance(adapters.records, GitRecords)
    assert isinstance(adapters.notifier, MacNotifier)
    assert isinstance(adapters.keychain, MacKeychain)
    cli.main(["run", "--profile", str(mine), "--workers", "4"])
    assert opened == ["the-sheet"]  # copied one time only


def test_with_no_records_remote_set_a_run_keeps_its_records_in_the_data_folder(monkeypatch, tmp_path):
    runs = []
    monkeypatch.setattr(orchestrator, "run", lambda adapters, profile, workers, **kinds: runs.append(adapters))
    monkeypatch.setattr(cli, "live_tracker", lambda: InMemoryTracker())
    monkeypatch.setattr(cli, "RECORDS", tmp_path / "records")

    cli.main(["run", "--profile", str(a_profile_with_live_runs(tmp_path / "mine", True)), "--workers", "1"])

    [adapters] = runs
    assert isinstance(adapters.records, FolderRecords) and adapters.records.root == tmp_path / "records"


@pytest.mark.parametrize("command", [["run"], ["run", "--requests-only"], ["approve-pass"]])
@pytest.mark.parametrize("live_runs", [False, None])
def test_a_live_run_is_refused_until_lisul_switches_live_runs_on(monkeypatch, tmp_path, command, live_runs):
    monkeypatch.setattr(sheet, "open_sheet", lambda sheet_id: pytest.fail("a refused run opened the Sheet"))
    monkeypatch.setattr(MacKeychain, "password", lambda self, account: pytest.fail("a refused run read Keychain"))
    monkeypatch.setattr(WorkerBrowsers, "seed", lambda self, count: pytest.fail("a refused run seeded a Worker profile"))
    monkeypatch.setattr(orchestrator, "run", lambda *args, **kinds: pytest.fail("a refused run started"))

    with pytest.raises(SystemExit) as refused:
        cli.main([*command, "--profile", str(a_profile_with_live_runs(tmp_path / "mine", live_runs))])

    message = refused.value.code  # printed to stderr, exit status 1
    assert isinstance(message, str)
    assert "live runs are off" in message.lower()
    assert "live_runs: true" in message and "policies.yaml" in message  # how to turn them on
    assert "apply rehearse" in message  # what still works


@pytest.mark.parametrize("command", [["rehearse", "https://jobs.lever.co/a/1"], ["run"], ["approve-pass"]])
def test_a_second_run_or_rehearsal_refuses_to_start_while_another_has_a_worker_profile_open(
    monkeypatch, tmp_path, command,
):
    busy = tmp_path / "profiles" / "worker-1"
    busy.mkdir(parents=True)
    os.symlink(f"host-{os.getpid()}", busy / "SingletonLock")  # the browser of the run going
    monkeypatch.setattr(sheet, "open_sheet", lambda sheet_id: FakeSpreadsheet(tmp_path / "sheet", {}))
    monkeypatch.setattr(MacKeychain, "password", lambda self, account: "app")
    monkeypatch.setattr(WorkerBrowsers, "seed", lambda self, count: pytest.fail("seeded a Worker profile"))
    monkeypatch.setattr(orchestrator, "run", lambda *args, **kinds: pytest.fail("a second run started"))
    monkeypatch.setattr(rehearsal, "rehearse", lambda *args, **kwargs: pytest.fail("a second rehearsal started"))

    with pytest.raises(SystemExit) as refused:
        cli.main([*command, "--profile", str(a_profile_with_live_runs(tmp_path / "mine", True))])

    assert "worker-1 open in another browser" in str(refused.value.code)


def test_apply_rehearse_uses_the_live_adapters_gmail_and_keychain_but_never_the_records_repo_or_notifications(
    monkeypatch, tmp_path, windows,
):
    # The Sheet only keeps the Applications Lisul submits himself from a held page.
    kept = InMemoryTracker()
    monkeypatch.setattr(cli, "live_tracker", lambda: kept)
    monkeypatch.setattr(sheet, "open_sheet", lambda sheet_id: pytest.fail("a rehearsal opened the Sheet otherwise"))
    # A rehearsal signs in and makes Employer accounts as a run does: Gmail's app password, and Keychain.
    looked_up = []
    monkeypatch.setattr(MacKeychain, "password", lambda self, account: looked_up.append((self._service, account)) or "app")
    rehearsals, exits = [], []
    monkeypatch.setattr(rehearsal, "rehearse", lambda urls, adapters, profile, workers, on_done, submitted_to, together, **_:
                        rehearsals.append((urls, adapters, workers, submitted_to)))
    monkeypatch.setattr(os, "_exit", exits.append)

    cli.main(["rehearse", "https://jobs.lever.co/a/1", "https://jobs.lever.co/b/2", "--workers", "2",
              "--profile", str(FIXTURES / "profile.yaml")])

    [(urls, adapters, workers, submitted_to)] = rehearsals
    assert submitted_to is kept
    # One dashboard window, a tile per link, in a profile of its own; `apply watch` finds it again.
    [(url, profile)] = windows
    assert windows.behind == [url]  # it never pulls Lisul away from the app he's working in
    assert isinstance(adapters.board, dashboard.Dashboard) and adapters.board.url == url
    assert len(adapters.board.state()["tiles"]) == 2
    assert profile == tmp_path / "profiles" / "dashboard"
    assert exits == [0]  # ended at once, so a browser stuck mid-fill can't keep it alive
    assert (urls, workers) == (["https://jobs.lever.co/a/1", "https://jobs.lever.co/b/2"], 2)
    assert isinstance(adapters.tracker, InMemoryTracker)
    assert isinstance(adapters.records, FolderRecords) and adapters.records.root == cli.REHEARSALS
    assert cli.REHEARSALS == home.HOME / "rehearsals"  # in the data folder, never the checkout
    assert adapters.repairs.folder == home.HOME / "repairs"  # a rehearsal's failures are real, so Repairs take them
    assert isinstance(adapters.notifier, RecordingNotifier) and isinstance(adapters.phone, RecordingNotifier)
    assert isinstance(adapters.site, WorkerBrowsers)
    assert isinstance(adapters.claude, ClaudeCLI) and adapters.usage is adapters.claude
    assert isinstance(adapters.mailbox, GmailMailbox) and adapters.mailbox.unavailable() is None
    assert isinstance(adapters.keychain, MacKeychain)
    assert looked_up == [(GMAIL, "test.person@example.com")]


@pytest.mark.parametrize(("profile", "says"), [(home.SAMPLE / "applicant-profile.yaml", True),
                                               (FIXTURES / "profile.yaml", False)])
def test_a_rehearsal_on_the_sample_profile_says_sample_data_in_its_window(monkeypatch, windows, profile, says):
    monkeypatch.setattr(cli, "live_tracker", InMemoryTracker)
    monkeypatch.setattr(MacKeychain, "password", lambda self, account: "app")
    shown = []
    monkeypatch.setattr(rehearsal, "rehearse", lambda urls, adapters, *rest, **kwargs: shown.append(adapters.board.page()))
    monkeypatch.setattr(os, "_exit", lambda code: None)

    cli.main(["rehearse", "https://jobs.lever.co/a/1", "--profile", str(profile)])

    assert ("Sample data" in shown[0]) is says


def test_apply_watch_reopens_the_dashboard_of_the_run_going(tmp_path, windows):
    (tmp_path / "profiles").mkdir()
    (tmp_path / "profiles" / "dashboard.url").write_text("http://127.0.0.1:61234")

    cli.main(["watch"])

    assert windows == [("http://127.0.0.1:61234", tmp_path / "profiles" / "dashboard")]
    assert windows.behind == []  # asked for: it comes to the front


def a_profile_with_a_bank(folder):
    """A dummy Applicant profile with an Answer bank beside it, in a scratch folder."""
    folder.mkdir()
    profile = folder / "applicant-profile.yaml"
    profile.write_text((FIXTURES / "profile.yaml").read_text())
    (folder / "answer-bank.yaml").write_text(
        "how did you hear about us?:\n  question: How did you hear about us?\n  answer: The Simplify list.\n"
        "  source: claude\n  reviewed: false\n")
    return profile


def test_live_adapters_use_the_answer_bank_beside_the_profile_given(tmp_path):
    profile = ApplicantProfile.load(a_profile_with_a_bank(tmp_path / "mine"))
    adapters = cli.live_adapters(profile, tracker=InMemoryTracker(), mailbox=object(), phone=RecordingNotifier())
    assert [e.question for e in adapters.answer_bank.entries()] == ["How did you hear about us?"]


@pytest.mark.parametrize("command", [["answers"], ["watch"]])
def test_with_no_run_going_the_window_opens_on_the_answers_tab_alone(monkeypatch, tmp_path, windows, command):
    profile = a_profile_with_a_bank(tmp_path / "mine")
    served = []

    def window_open(profile_dir):  # Lisul reads his answers, then closes the window
        [(url, _)] = windows
        with urllib.request.urlopen(url + "/answers") as response:
            served.append(json.loads(response.read()))
        return False

    monkeypatch.setattr(dashboard, "window_open", window_open)

    cli.main([*command, "--profile", str(profile)])

    [(url, window_profile)] = windows
    assert window_profile == tmp_path / "profiles" / "answers"  # never the run's window, nor a Worker's
    [view] = served
    assert [e["question"] for e in view["bank"]] == ["How did you hear about us?"]
    assert view["profile"][0]["facts"][0] == ["legal_first_name", "Test"]
    with pytest.raises(OSError):
        urllib.request.urlopen(url + "/answers", timeout=2)  # the window closed: so did its server


def test_apply_answers_while_a_run_goes_opens_its_window_on_the_answers_tab(tmp_path, windows):
    (tmp_path / "profiles").mkdir()
    (tmp_path / "profiles" / "dashboard.url").write_text("http://127.0.0.1:61234")

    cli.main(["answers"])

    assert windows == [("http://127.0.0.1:61234/#answers", tmp_path / "profiles" / "dashboard")]


def test_a_runs_window_shows_its_answer_bank_and_profile_in_the_answers_tab(monkeypatch, tmp_path, windows):
    profile = a_profile_with_a_bank(tmp_path / "mine")
    monkeypatch.setattr(MacKeychain, "password", lambda self, account: "app")
    monkeypatch.setattr(cli, "live_tracker", InMemoryTracker)
    monkeypatch.setattr(rehearsal, "rehearse", lambda urls, adapters, profile, workers, on_done, submitted_to, together, **_: None)
    monkeypatch.setattr(os, "_exit", lambda code: None)
    boards = []
    stop = dashboard.Dashboard.__exit__
    monkeypatch.setattr(dashboard.Dashboard, "__exit__", lambda board, *exc: boards.append(board) or stop(board, *exc))

    cli.main(["rehearse", "https://jobs.lever.co/a/1", "--profile", str(profile)])

    [board] = boards
    view = board.answers.view()
    assert [e["question"] for e in view["bank"]] == ["How did you hear about us?"]
    assert view["profile"][0]["facts"][0] == ["legal_first_name", "Test"]


def test_a_live_run_fills_postings_on_the_sites_lisul_signed_the_worker_profiles_in_to(monkeypatch, tmp_path):
    WorkerBrowsers(tmp_path / "profiles").signed_in_to("lifeattiktok.com")  # by apply sign-in
    monkeypatch.setattr(MacKeychain, "password", lambda self, account: "app")
    rehearsals = []
    monkeypatch.setattr(cli, "live_tracker", InMemoryTracker)
    monkeypatch.setattr(rehearsal, "rehearse",
                        lambda urls, adapters, profile, workers, on_done, submitted_to, together, **_: rehearsals.append(adapters))
    monkeypatch.setattr(os, "_exit", lambda code: None)

    cli.main(["rehearse", "https://lifeattiktok.com/search/1", "--profile", str(FIXTURES / "profile.yaml")])

    [adapters] = rehearsals
    assert adapters.signed_in == {"lifeattiktok.com"}


@pytest.mark.parametrize("worker_headless", [True, False])
@pytest.mark.parametrize("command", [["run"], ["rehearse", "https://jobs.lever.co/a/1"]])
def test_the_workers_run_headless_or_headed_as_policies_yaml_says(monkeypatch, tmp_path, command, worker_headless):
    # Measured before deciding: does a headed Chrome draw fewer Bot signals than a headless one?
    monkeypatch.setattr(sheet, "SHEET_ID", tmp_path / "no-sheet-id")  # no Sheet: nothing to copy
    monkeypatch.setattr(MacKeychain, "password", lambda self, account: "app")
    sites = []
    monkeypatch.setattr(orchestrator, "run", lambda adapters, *args, **kinds: sites.append(adapters.site))
    monkeypatch.setattr(rehearsal, "rehearse", lambda urls, adapters, *args, **kwargs: sites.append(adapters.site))
    monkeypatch.setattr(os, "_exit", lambda status: None)
    profile = a_profile_with_live_runs(tmp_path / "mine", True)
    (profile.parent / "policies.yaml").write_text(
        (profile.parent / "policies.yaml").read_text() + f"worker_headless: {str(worker_headless).lower()}\n")

    cli.main([*command, "--profile", str(profile)])

    [site] = sites
    assert site.launch_options(0)["headless"] is worker_headless


def test_workers_run_headless_unless_policies_yaml_says_otherwise(tmp_path):
    assert WorkerBrowsers(tmp_path).launch_options(0)["headless"] is True


def test_an_answer_typed_in_the_window_goes_to_the_trackers_answer_cell_or_the_profile(tmp_path):
    from apply.model import Status
    from apply.tracker import InMemoryTracker, Row

    tracker = InMemoryTracker()
    tracker.add(Row(application_id="c2", company="Cohere", role="ML Intern", posting_url="https://c.example/2",
                    job_system="ashby", status=Status.MISSING_FACT, missing_fact="Pronouns"))
    saved = []
    tab = type("Tab", (), {"save_answered": lambda self, q, a: saved.append((q, a))})()
    answer = cli._answering(lambda: tracker, tab)

    said = answer({"status": "missing fact", "application_id": "c2", "company": "Cohere"}, "Pronouns", "he/him")
    assert tracker.get("c2").answer == "he/him" and saved == [] and "next check" in said
    said = answer({"status": "ready to submit", "missing": ["Pronouns"]}, "Pronouns", "he/him")
    assert saved == [("Pronouns", "he/him")] and "facts" in said
