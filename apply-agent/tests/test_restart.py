"""Restart recovery (docs/restart-recovery.md): what survives a quit or a restart of the Mac. No browser."""

import json
import threading
from pathlib import Path

from apply import batch
from apply.plain.launcher import PlainWorkers


def test_a_plain_worker_keeps_its_session_cookies_across_a_quit(tmp_path):
    # KAN-718: without it, a clean quit drops every job site's sign-in (a session cookie).
    command = PlainWorkers(tmp_path, kind="chrome").arguments(0)
    assert "--restore-last-session" in command
    assert "--no-startup-window" in command  # so no tab of the last session loads again, unguarded


# --- The open-forms list (KAN-719)

def test_a_form_is_kept_as_it_goes_and_leaves_once_it_went_in(tmp_path):
    path = tmp_path / "open-forms.json"
    batch.note("https://jobs.example/1", path, application_id="a1", job_system="workday", status="filling", worker=0)
    batch.note("https://jobs.example/1", path, status="needs sign-in", left=["Degree"])
    batch.note("https://jobs.example/2", path, application_id="a2", status="ready to submit", worker=1)
    [one, two] = batch.forms(path)
    assert (one["application_id"], one["job_system"], one["status"], one["left"]) == ("a1", "workday", "needs sign-in", ["Degree"])
    assert two["link"] == "https://jobs.example/2" and two["worker"] == 1
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    batch.done("https://jobs.example/1", path)
    assert [f["link"] for f in batch.forms(path)] == ["https://jobs.example/2"]


def test_workers_writing_at_once_lose_no_form(tmp_path):
    path = tmp_path / "open-forms.json"
    threads = [threading.Thread(target=batch.note, args=(f"https://jobs.example/{k}", path), kwargs={"status": "filling"})
               for k in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(batch.forms(path)) == 20 and len(json.loads(path.read_text())) == 20


def test_a_broken_list_reads_as_empty_and_is_written_anew(tmp_path):
    path = tmp_path / "open-forms.json"
    path.write_text("{not json")
    assert batch.forms(path) == []
    batch.note("https://jobs.example/1", path, status="filling")
    assert [f["link"] for f in batch.forms(path)] == ["https://jobs.example/1"]


# --- apply reopen (KAN-720)

FOLDER = "/Users/x/.config/apply/profiles"


def test_the_reopen_plan_gives_each_workers_forms_back_to_it_the_first_at_once(tmp_path):
    kept = [
        {"link": "https://a.example/1", "worker": 1, "opened": "2026-11-05 10:00", "profiles": FOLDER, "plain": True},
        {"link": "https://b.example/1", "worker": 0, "opened": "2026-11-05 10:01", "profiles": FOLDER, "plain": True},
        {"link": "https://a.example/2", "worker": 1, "opened": "2026-11-05 10:02", "profiles": FOLDER, "plain": True},
        {"link": "https://c.example/1", "worker": 0, "opened": "2026-11-05 10:03", "profiles": FOLDER, "status": batch.SENT},
        {"link": "https://d.example/1", "worker": 0, "opened": "2026-11-05 10:04", "profiles": "/elsewhere"},
        {"link": "https://e.example/1", "worker": 0, "opened": "2026-11-05 10:05", "profiles": FOLDER, "plain": False},
    ]
    planned = batch.plan(kept, Path(FOLDER))
    assert planned.firsts == ["https://b.example/1", "https://a.example/1", "https://e.example/1"]
    assert planned.workers == [0, 1, 2]  # a CDP form gets a Worker of its own, after the plain ones
    assert planned.later == {1: ["https://a.example/2"]}  # sent into Browser 2 once its first form has stopped
    assert [f["link"] for f in planned.sent] == ["https://c.example/1"]  # his Submit: never reopened
    assert list(planned.elsewhere) == ["/elsewhere"]
    said = "\n".join(batch.lines(planned))
    assert "4 open forms to reopen here" in said and "APPLY_PROFILES=/elsewhere uv run apply reopen" in said
    assert batch.lines(batch.plan([], Path(FOLDER))) == ["No open form on the list: nothing to reopen."]


def test_a_reopened_forms_draft_is_its_records_answers_but_no_file_or_secret(tmp_path):
    (tmp_path / "answers.json").write_text(json.dumps([
        {"question": "Why us?", "field": "q1", "kind": "textarea", "planned": "Claude's", "on_page": "His edit"},
        {"question": "LinkedIn", "field": "q2", "kind": "text", "planned": "https://x", "on_page": None},
        {"question": "Resume", "field": "q3", "kind": "file", "planned": "one-pager.pdf", "on_page": "one-pager.pdf"},
        {"question": "Password", "field": "q4", "kind": "text", "planned": "(secret, not recorded)", "on_page": None},
        {"question": "Cover letter", "field": "q5", "planned": "letter.pdf", "on_page": "letter.pdf"},  # an older Record
        {"question": "Skills", "field": "q6", "kind": "multi_select", "planned": ["Python"], "on_page": ["Python", "Go"]},
        {"question": "I certify that my answers are true", "field": "q7", "kind": "select", "planned": None,
         "on_page": "Yes"},  # his to tick, always
        {"question": "Please explain", "field": "q8", "kind": "textarea", "planned": None, "on_page": "One"},
        {"question": "Please explain", "field": "q9", "kind": "textarea", "planned": None, "on_page": "Two"},  # twice: neither
    ]))
    # Only what the page showed (q2 was only planned), each with its question: a field asks the same one, or none.
    assert batch.draft({"record": str(tmp_path)}) == {"q1": ("Why us?", "His edit"), "q6": ("Skills", ["Python", "Go"])}
    assert batch.draft({"record": str(tmp_path / "gone")}) == {} and batch.draft({}) == {}


class _Mailless:
    login, hands_off = "test.person@example.com", True


class _Page:
    url = "https://careers.example.com/signin"
    frames = ()


def test_a_reopened_forms_account_page_is_a_handoff_before_anything_is_typed():
    from apply.account_pages import AccountPages
    from apply.accounts import HANDS_OFF
    from apply.model import Handoff

    pages = AccountPages(_Mailless(), {"first_name": "Test"})
    assert "test.person@example.com" not in pages.told() and "type nothing" in pages.told()
    try:
        pages.after(_Page(), {"account_page": "sign_in", "account_button": "Sign in"}, None, None, _Page.url)
    except Handoff as handoff:
        assert str(handoff) == HANDS_OFF
    else:
        raise AssertionError("a reopened form's sign-in went on")
    pages.hands_off(_Page())  # no password box shows: Claude may look at the page


def test_reopen_list_prints_the_plan_and_opens_nothing(monkeypatch, tmp_path, capsys):
    from apply import cli

    monkeypatch.setattr(batch, "PATH", tmp_path / "open-forms.json")
    batch.note("https://a.example/1", status="ready to submit", worker=0, profiles=str(tmp_path), plain=True)

    class Site:
        profiles = tmp_path

    class Adapters:
        site = Site()

    class Args:
        list = True

    assert cli._reopening(Args(), Adapters()) is None
    assert "Browser 1: https://a.example/1" in capsys.readouterr().out


def test_the_window_aims_each_reopened_tile_at_the_worker_that_held_it():
    from apply.dashboard import Dashboard, NoFrames

    with Dashboard(2, NoFrames()) as board:
        board.aim([3, 1])
        assert [board.worker_of(0), board.worker_of(1)] == [3, 1]


def test_a_draft_value_goes_only_to_a_field_that_asks_the_same_question_now():
    from apply.model import Question
    from apply.worker import _held

    # Claude fill numbers its fields: this run's q9 is another question than the last run's.
    draft = {"q9": ("Phone", "555"), "q1": ("Why us?", "His edit")}
    now = [Question("q9", "Will you require sponsorship?", "select"), Question("q1", "Why  us?", "textarea")]
    assert _held(draft, now) == {"q1": "His edit"}


# --- apply preflight --open (KAN-721)


def test_preflight_open_lists_the_reopened_sites_that_wait_on_a_sign_in_now():
    from apply import preflight

    forms = [
        {"link": "https://acme.wd1.myworkdayjobs.com/x/job/1", "posting_url": "https://acme.wd1.myworkdayjobs.com/x/job/1",
         "application_id": "a1", "job_system": "workday", "company": "Acme", "worker": 0},
        {"link": "https://job-boards.greenhouse.io/arc/jobs/2", "posting_url": "https://job-boards.greenhouse.io/arc/jobs/2",
         "application_id": "a2", "job_system": "greenhouse", "company": "Arc", "worker": 1},
        {"link": "https://beta.wd5.myworkdayjobs.com/y/job/3", "posting_url": "https://beta.wd5.myworkdayjobs.com/y/job/3",
         "application_id": "a3", "job_system": "workday", "company": "Beta", "worker": 2},
    ]
    tiles = [{"posting_url": forms[0]["posting_url"], "status": "needs sign-in"},
             {"application_id": "a2", "status": "ready to submit"}]
    said = preflight.open_report(forms, tiles)
    now, _, later = said.partition("No window shows these yet")
    assert "Acme (Browser 1)" in now and "Arc" not in said  # Greenhouse asks no sign-in, and its form is held
    assert "Beta (Browser 3)" in later
    assert preflight.open_report([], []).startswith("No open form")
