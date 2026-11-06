"""Restart recovery (docs/restart-recovery.md): what survives a quit or a restart of the Mac. No browser."""

import json
import threading

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
