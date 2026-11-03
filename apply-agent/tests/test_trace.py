"""The Trace: each Application's events in its own JSON-lines file, read
back with `apply trace`, so what went wrong in a run can be seen afterwards."""

import json
from datetime import date

from conftest import PERRY_FORM, PERRY_URL
from fake_workable import FakeWorkableServer

from apply import cli, trace
from apply.submit_guard import DriveGuard

TODAY = date(2026, 10, 20)
WORKABLE_SUBMIT = "https://apply.workable.com/api/v1/jobs/D309E69A5B/apply"


def events(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_a_traced_application_keeps_what_its_page_said_and_sent(tmp_path):
    with FakeWorkableServer(PERRY_FORM) as fake:
        with fake.open(PERRY_URL) as page:
            with trace.tracing("request-abc", PERRY_URL, tmp_path, TODAY) as path:
                trace.watch(page.context)
                DriveGuard(page)
                page.evaluate("console.log('hello from the page')")
                page.evaluate(f"fetch('{WORKABLE_SUBMIT}', {{method: 'POST', body: '{{}}'}}).catch(() => null)")
                page.evaluate("fetch(location.origin + '/nowhere', {method: 'POST', body: 'x'}).catch(() => null)")
                page.wait_for_timeout(300)
    kinds = [(e["kind"], e.get("text") or e.get("url")) for e in events(path)]
    assert kinds[0] == ("start", PERRY_URL)
    assert ("console", "hello from the page") in kinds
    assert ("console", f"Apply drive guard blocked the application request (POST {WORKABLE_SUBMIT})") in kinds
    assert any(kind == "request" and url.endswith("/nowhere") for kind, url in kinds)
    assert path == tmp_path / "2026-10-20" / "request-abc.jsonl"


def test_nothing_is_traced_outside_an_application(tmp_path, monkeypatch):
    monkeypatch.setattr(trace, "TRACES", tmp_path)
    trace.event("console", text="no Application is carried")
    assert list(tmp_path.iterdir()) == []


def test_an_error_leaving_the_application_is_traced_with_where_it_came_from(tmp_path):
    try:
        with trace.tracing("request-abc", "https://x.example/job", tmp_path, TODAY) as path:
            raise RuntimeError("the form never loaded")
    except RuntimeError:
        pass
    error = events(path)[-1]
    assert error["kind"] == "error" and error["error"] == "RuntimeError: the form never loaded"
    assert "raise RuntimeError" in error["traceback"]


def test_a_claude_fill_session_is_kept_to_what_claude_did(tmp_path):
    with trace.tracing("request-abc", "https://x.example/job", tmp_path, TODAY) as path:
        trace.claude({"type": "rate_limit_event", "rate_limit_info": {}})
        trace.claude({"type": "assistant", "message": {"content": [
            {"type": "text", "text": "I'll fill the email."},
            {"type": "tool_use", "id": "t1", "name": "mcp__browser__browser_type", "input": {"text": "a@b.c"}}]}})
        trace.claude({"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": "x" * 5000}]}})
        trace.claude({"type": "result", "is_error": False, "result": "done", "num_turns": 2})
    said = events(path)[1:]
    assert [e["block"] for e in said] == ["text", "tool_use", "tool_result", "result"]
    assert said[1]["name"] == "mcp__browser__browser_type" and said[1]["input"] == {"text": "a@b.c"}
    assert len(said[2]["content"]) < 2100  # a long page snapshot is cut short


def test_traces_older_than_two_weeks_are_deleted_when_a_new_one_starts(tmp_path):
    old = tmp_path / "2026-10-01"
    old.mkdir()
    (old / "request-old.jsonl").write_text("{}\n")
    with trace.tracing("request-abc", "https://x.example/job", tmp_path, TODAY):
        pass
    assert not old.exists()


def test_apply_trace_prints_the_newest_trace_whose_posting_matches(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(trace, "TRACES", tmp_path)
    with trace.tracing("request-1", "https://jobs.ashbyhq.com/notion/1", tmp_path, TODAY):
        trace.event("console", text="notion's page")
    with trace.tracing("request-2", "https://explore.jobs.netflix.net/careers/job/7", tmp_path, TODAY):
        trace.event("console", text="netflix's page")
    cli.main(["trace", "notion"])
    out = capsys.readouterr().out
    assert "notion's page" in out and "netflix's page" not in out
    cli.main(["trace", "--path"])
    assert capsys.readouterr().out.strip() == str(tmp_path / "2026-10-20" / "request-2.jsonl")
