"""The `claude -p` adapter, against recorded stream-json output.

fixtures/claude/answer.jsonl is a real lean Haiku call (paths scrubbed).
fixtures/claude/limit-hit.jsonl is built from the documented limit signals
(research/max-orchestrator.md, section 3); a real hit was never captured.
"""

import json
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from conftest import FIXTURES

from apply import claude_cli
from apply.adapters import Drive, UsageLimitHit
from apply.claude_cli import ClaudeCLI, ClaudeError, run_claude

SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}}}
FIVE_HOUR_RESET = datetime.fromtimestamp(1792050600)
WEEKLY_RESET = datetime.fromtimestamp(1792062000)
BEFORE_RESETS = FIVE_HOUR_RESET - timedelta(hours=1)


def recorded(name: str) -> str:
    return (FIXTURES / "claude" / f"{name}.jsonl").read_text()


class FakeRun:
    """Stands in for running the claude binary: returns recorded stdout in order."""

    def __init__(self, *outputs: str):
        self._outputs = list(outputs)
        self.calls: list[tuple[list[str], str, dict]] = []

    def __call__(self, argv: list[str], stdin: str, env: dict) -> str:
        self.calls.append((argv, stdin, env))
        return self._outputs.pop(0)


def ask(claude: ClaudeCLI) -> dict:
    return claude.ask(model="haiku", system="Reply in JSON.", prompt="Is 2 greater than 1?", schema=SCHEMA)


def flag(argv: list[str], name: str) -> str:
    return argv[argv.index(name) + 1]


def test_ask_returns_the_structured_output():
    claude = ClaudeCLI(run=FakeRun(recorded("answer")))

    assert ask(claude) == {"answer": "yes"}


def test_ask_runs_a_lean_call_on_the_max_login(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-would-bill-the-api")
    run = FakeRun(recorded("answer"))

    ask(ClaudeCLI(run=run))

    [(argv, stdin, env)] = run.calls
    assert argv[:2] == ["claude", "-p"]
    assert stdin == "Is 2 greater than 1?"
    assert "ANTHROPIC_API_KEY" not in env
    assert flag(argv, "--model") == "haiku"
    assert flag(argv, "--system-prompt") == "Reply in JSON."
    assert flag(argv, "--setting-sources") == ""
    assert flag(argv, "--tools") == ""
    assert "--strict-mcp-config" in argv and "--mcp-config" not in argv
    assert "--no-session-persistence" in argv and "--disable-slash-commands" in argv
    assert flag(argv, "--json-schema") == '{"type": "object", "properties": {"answer": {"type": "string"}}}'
    assert flag(argv, "--output-format") == "stream-json" and "--verbose" in argv
    assert "--bare" not in argv  # bare mode ignores the Max login


def test_haiku_runs_at_low_effort_and_sonnet_essays_at_their_default():
    run = FakeRun(recorded("answer"), recorded("answer"))
    claude = ClaudeCLI(run=run)

    claude.ask(model="haiku", system="Review.", prompt="form", schema=SCHEMA)
    claude.ask(model="sonnet", system="Write essays.", prompt="questions", schema=SCHEMA)

    [(haiku, _, _), (sonnet, _, _)] = run.calls
    assert flag(haiku, "--effort") == "low"
    assert "--effort" not in sonnet


def test_a_call_loads_none_of_lisuls_own_claude_memory(monkeypatch, tmp_path):
    """Run from inside a repo, `claude -p` loads that project's auto-memory
    (measured: about 1.3k extra input tokens per call, and Lisul's private
    notes in every prompt). Calls run from an empty folder, memory off."""
    # The real folder is shared with any live `apply` run, whose calls make temp folders in it.
    monkeypatch.setattr(claude_cli, "NEUTRAL", tmp_path / "apply-claude")
    run = FakeRun(recorded("answer"))

    ask(ClaudeCLI(run=run))

    [(_, _, env)] = run.calls
    assert env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] == "1"
    folder = run_claude(["pwd"], "", {}).strip()
    assert folder.endswith("apply-claude")
    assert list(Path(folder).iterdir()) == []


def test_usage_comes_from_the_last_rate_limit_event():
    claude = ClaudeCLI(run=FakeRun(recorded("answer")), now=lambda: BEFORE_RESETS)

    ask(claude)

    reading = claude.reading()
    assert (reading.five_hour, reading.weekly) == (0.66, 0.64)
    assert (reading.five_hour_resets_at, reading.weekly_resets_at) == (FIVE_HOUR_RESET, WEEKLY_RESET)
    assert not reading.limited


def test_a_rejected_call_is_a_limit_hit_until_its_reset():
    claude = ClaudeCLI(run=FakeRun(recorded("limit-hit")), now=lambda: BEFORE_RESETS)

    with pytest.raises(UsageLimitHit) as hit:
        ask(claude)

    assert hit.value.resets_at == FIVE_HOUR_RESET
    reading = claude.reading()
    assert reading.limited and reading.resets_at == FIVE_HOUR_RESET
    assert (reading.five_hour, reading.weekly) == (1.0, 0.71)


def test_a_limit_message_without_an_event_is_still_a_limit_hit():
    result = '{"type":"result","is_error":true,"result":"You\'ve hit your weekly limit · resets Mon 12:00am"}\n'
    claude = ClaudeCLI(run=FakeRun(result))

    with pytest.raises(UsageLimitHit) as hit:
        ask(claude)

    assert hit.value.resets_at is None


def test_any_other_failure_is_an_error():
    result = '{"type":"result","is_error":true,"api_error_status":529,"result":"API Error: Overloaded"}\n'

    with pytest.raises(ClaudeError, match="Overloaded"):
        ask(ClaudeCLI(run=FakeRun(result)))
    with pytest.raises(ClaudeError, match="no result"):
        ask(ClaudeCLI(run=FakeRun("Error: claude not signed in\n")))


def test_reading_before_any_call_makes_one_tiny_call_to_learn_usage():
    run = FakeRun(recorded("answer"))
    claude = ClaudeCLI(run=run, now=lambda: BEFORE_RESETS)

    reading = claude.reading()
    claude.reading()

    assert reading.five_hour == 0.66
    [(argv, _, _)] = run.calls
    assert flag(argv, "--model") == "haiku"


def test_a_reading_past_its_reset_is_refreshed():
    run = FakeRun(recorded("limit-hit"), recorded("answer"))
    now = BEFORE_RESETS
    claude = ClaudeCLI(run=run, now=lambda: now)
    with pytest.raises(UsageLimitHit):
        ask(claude)

    now = FIVE_HOUR_RESET
    reading = claude.reading()

    assert not reading.limited and reading.five_hour == 0.66
    assert len(run.calls) == 2


# --- Driving a browser: Claude fill -------------------------


class FakeStream:
    """Stands in for running the claude binary as it streams: yields recorded
    lines one by one and notes how many were read before the stream was closed."""

    def __init__(self, lines: list[str]):
        self._lines = lines
        self.read = 0
        self.calls: list[tuple[list[str], str, dict, Path]] = []
        self.folder_files: list[str] = []

    def __call__(self, argv, stdin, env, cwd):
        self.calls.append((argv, stdin, env, cwd))
        self.folder_files = sorted(p.name for p in Path(cwd).iterdir())
        for line in self._lines:
            self.read += 1
            yield line


def turn(n: int, tokens: int) -> str:
    """One assistant turn that cost `tokens` tokens, most of them cache reads."""
    usage = {"input_tokens": 10, "cache_creation_input_tokens": 990, "cache_read_input_tokens": tokens - 1100,
             "output_tokens": 100}
    tool = {"type": "tool_use", "name": "mcp__playwright__browser_snapshot", "input": {}}
    return json.dumps({"type": "assistant", "message": {"id": f"msg_{n}", "usage": usage, "content": [tool]}})


DONE = json.dumps({"type": "result", "subtype": "success", "is_error": False, "num_turns": 3,
                   "structured_output": {"blocked": "", "questions": []}, "result": "{}"})


def drive(claude: ClaudeCLI, files=(), max_turns: int = 40, max_tokens: int = 100_000):
    return claude.drive(page="the Worker's page", model="haiku", system="Read the form.", prompt="<form_url>u</form_url>",
                        schema=SCHEMA, files=list(files), max_turns=max_turns, max_tokens=max_tokens)


def test_a_drive_works_the_workers_own_browser_through_playwright_mcp_alone(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-would-bill-the-api")
    resume = tmp_path / "one-pager.pdf"
    resume.write_bytes(b"%PDF")
    stream = FakeStream([turn(1, 20_000), turn(2, 25_000), DONE])
    claude = ClaudeCLI(stream=stream, endpoint={"the Worker's page": "http://127.0.0.1:9333"}.get)

    done = drive(claude, files=[resume])

    assert done == Drive({"blocked": "", "questions": []}, turns=2, tokens=45_000)
    [(argv, stdin, env, cwd)] = stream.calls
    assert stdin == "<form_url>u</form_url>" and "ANTHROPIC_API_KEY" not in env
    assert flag(argv, "--model") == "haiku" and flag(argv, "--tools") == ""
    [server] = json.loads(flag(argv, "--mcp-config"))["mcpServers"].values()
    assert server["args"][server["args"].index("--cdp-endpoint") + 1] == "http://127.0.0.1:9333"
    assert "--strict-mcp-config" in argv and "mcp__playwright__browser_run_code_unsafe" in flag(argv, "--disallowedTools")
    # Only the files to attach are in reach, by name; the folder is gone afterwards.
    assert stream.folder_files == ["one-pager.pdf"] and not Path(cwd).exists()


def test_a_drive_is_stopped_once_it_passes_its_token_cap():
    stream = FakeStream([turn(1, 30_000), turn(2, 30_000), turn(3, 30_000), DONE])
    claude = ClaudeCLI(stream=stream, endpoint=lambda page: "http://127.0.0.1:9333")

    done = drive(claude, max_tokens=50_000)

    assert done == Drive(None, turns=2, tokens=60_000, capped=True)
    assert stream.read == 2


def test_a_drive_is_stopped_once_it_passes_its_turn_cap():
    stream = FakeStream([turn(n, 1_000) for n in range(1, 10)] + [DONE])
    claude = ClaudeCLI(stream=stream, endpoint=lambda page: "http://127.0.0.1:9333")

    done = drive(claude, max_turns=3)

    assert (done.capped, done.turns, stream.read) == (True, 4, 4)


def test_a_drive_refused_at_the_max_limit_is_a_limit_hit():
    stream = FakeStream(recorded("limit-hit").splitlines())
    claude = ClaudeCLI(stream=stream, endpoint=lambda page: "http://127.0.0.1:9333", now=lambda: BEFORE_RESETS)

    with pytest.raises(UsageLimitHit):
        drive(claude)


def test_a_recorded_drive_gives_its_answer_and_counts_every_token_it_used():
    # A real Haiku session filling a BambooHR form through Playwright MCP
    # (CLI 2.1.300, @playwright/mcp 0.0.83, 2026-10-15), never submitted.
    claude = ClaudeCLI(stream=FakeStream(recorded("drive").splitlines()), endpoint=lambda page: "http://127.0.0.1:9333")

    done = drive(claude, max_tokens=400_000)

    assert done.output["submit_button"] == "Submit Application"
    # The result's totals, cache reads included: the streamed turns undercount output.
    assert (done.turns, done.tokens, done.capped) == (11, 152_412, False)


def test_spent_counts_the_tokens_of_every_call_made_on_this_thread():
    # Each recorded ask took 2 input + 1,139 cache-write + 53 output tokens.
    claude = ClaudeCLI(run=FakeRun(recorded("answer"), recorded("answer")),
                       stream=FakeStream(recorded("drive").splitlines()), endpoint=lambda page: "http://127.0.0.1:9333")
    elsewhere = []

    ask(claude)
    ask(claude)
    drive(claude, max_tokens=400_000)
    other = threading.Thread(target=lambda: elsewhere.append(claude.spent()))
    other.start()
    other.join()

    assert claude.spent() == 2 * 1_194 + 152_412
    assert elsewhere == [0]  # another Worker's Application spent none of it


def test_a_refused_group_kill_does_not_hide_how_a_stream_went(monkeypatch):
    # macOS answers EPERM to killpg when the group's leader is already exiting (seen live).
    def refuse(pgid, sig):
        raise PermissionError(1, "Operation not permitted")

    monkeypatch.setattr(claude_cli.os, "killpg", refuse)
    lines = claude_cli.stream_claude(["/bin/sh", "-c", "echo first; sleep 30"], "", dict(os.environ), Path("/"))

    assert next(lines) == "first\n"
    lines.close()  # the caller stops reading early: the process is stopped, nothing raised


def test_research_reads_the_web_with_nothing_else_in_reach(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-would-bill-the-api")
    stream = FakeStream([turn(1, 20_000), turn(2, 30_000), DONE])

    done = ClaudeCLI(stream=stream).research(model="sonnet", system="Research Cloudflare.", prompt="<company>Cloudflare</company>",
                                             schema=SCHEMA, max_turns=20, max_tokens=100_000)

    assert done == Drive({"blocked": "", "questions": []}, turns=2, tokens=50_000)
    [(argv, stdin, env, cwd)] = stream.calls
    assert stdin == "<company>Cloudflare</company>" and "ANTHROPIC_API_KEY" not in env
    assert flag(argv, "--system-prompt") == "Research Cloudflare."
    assert flag(argv, "--tools") == "WebSearch,WebFetch" and flag(argv, "--allowedTools") == "WebSearch,WebFetch"
    assert flag(argv, "--permission-mode") == "dontAsk" and "--mcp-config" not in argv
    assert stream.folder_files == [] and not Path(cwd).exists()


def test_research_is_stopped_once_it_passes_its_token_cap():
    stream = FakeStream([turn(1, 60_000), turn(2, 60_000), DONE])

    done = ClaudeCLI(stream=stream).research(model="sonnet", system="", prompt="", schema=SCHEMA,
                                             max_turns=20, max_tokens=100_000)

    assert done.capped and done.output is None


def test_a_coding_session_works_in_its_folder_with_only_the_tools_it_is_allowed(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-would-bill-the-api")
    monkeypatch.setenv("VIRTUAL_ENV", "/Users/test-person/work/apply/.venv")  # the checkout that started it
    (tmp_path / "planner.py").write_text("RULES = []\n")
    stream = FakeStream([turn(1, 20_000), DONE])
    claude = ClaudeCLI(stream=stream)

    done = claude.work(folder=tmp_path, model="sonnet", system="Repair Apply.", prompt="<request>...</request>",
                       schema=SCHEMA, tools=["Read", "Edit", "Bash"], allowed=["Read", "Edit", "Bash(uv run pytest:*)"],
                       max_turns=10, max_tokens=100_000, env={"APPLY_PROFILES": "/tmp/copies"})

    assert done == Drive({"blocked": "", "questions": []}, turns=1, tokens=20_000)
    [(argv, stdin, env, cwd)] = stream.calls
    assert cwd == tmp_path and stream.folder_files == ["planner.py"]
    assert stdin == "<request>...</request>" and "ANTHROPIC_API_KEY" not in env
    assert env["APPLY_PROFILES"] == "/tmp/copies"
    assert "VIRTUAL_ENV" not in env  # its `uv run pytest` tests the folder's code, not the caller's
    assert flag(argv, "--model") == "sonnet"
    # Claude Code's own coding prompt stays; the Repair's rules are added to it.
    assert flag(argv, "--append-system-prompt") == "Repair Apply." and "--system-prompt" not in argv
    assert flag(argv, "--tools") == "Read,Edit,Bash"
    assert flag(argv, "--allowedTools") == "Read,Edit,Bash(uv run pytest:*)"
    assert flag(argv, "--permission-mode") == "dontAsk"  # anything not allowed is refused, never asked
    assert flag(argv, "--setting-sources") == "" and "--strict-mcp-config" in argv and "--mcp-config" not in argv


def test_a_coding_session_is_refused_the_paths_it_is_denied():
    stream = FakeStream([turn(1, 20_000), DONE])

    ClaudeCLI(stream=stream).work(folder=Path("."), model="sonnet", system="", prompt="", schema=SCHEMA, tools=["Edit"],
                                  allowed=["Edit(//repo/**)"], denied=["Edit(//repo/**/conftest.py)"],
                                  max_turns=10, max_tokens=100_000)

    [(argv, *_)] = stream.calls
    assert flag(argv, "--allowedTools") == "Edit(//repo/**)"
    assert flag(argv, "--disallowedTools") == "Edit(//repo/**/conftest.py)"  # a deny rule wins over an allow rule


def test_a_coding_session_is_stopped_at_its_cap():
    stream = FakeStream([turn(n, 1_000) for n in range(1, 10)] + [DONE])

    done = ClaudeCLI(stream=stream).work(folder=Path("."), model="sonnet", system="", prompt="", schema=SCHEMA,
                                         tools=[], allowed=[], max_turns=3, max_tokens=100_000)

    assert (done.capped, done.turns, stream.read) == (True, 4, 4)


def test_a_claude_that_vanished_mid_update_is_run_once_more(tmp_path):
    # Live: "Superset: claude not found in PATH" (exit 127) while Claude Code updated itself.
    flag_file = tmp_path / "updated"
    script = f"if [ -f {flag_file} ]; then echo ok; else touch {flag_file}; echo missing >&2; exit 127; fi"

    assert run_claude(["/bin/sh", "-c", script], "", dict(os.environ), sleep=lambda s: None) == "ok\n"


def test_a_claude_mid_update_is_retried_with_backoff_until_it_is_back(tmp_path):
    # Live (Palantir rehearsal): "claude native binary not installed" for longer than one 5 s retry.
    count = tmp_path / "tries"
    script = (f"n=$(cat {count} 2>/dev/null || echo 0); echo $((n + 1)) > {count}; "
              "if [ $n -ge 3 ]; then echo ok; else echo 'Error: claude native binary not installed.' >&2; exit 1; fi")
    waits = []

    assert run_claude(["/bin/sh", "-c", script], "", dict(os.environ), sleep=waits.append) == "ok\n"
    assert len(waits) == 3 and waits == sorted(waits)


def test_a_claude_still_missing_after_about_two_minutes_gives_up():
    waits = []

    out = run_claude(["/bin/sh", "-c", "echo missing >&2; exit 127"], "", dict(os.environ), sleep=waits.append)

    assert out == "missing\n"
    assert 100 <= sum(waits) <= 150


@pytest.mark.parametrize("output", [
    '{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}\n',
    "Not logged in\n",
])
def test_claude_logged_out_is_a_setup_error_that_says_how_to_log_in(output):
    from apply.adapters import SetupError
    with pytest.raises(SetupError, match="claude auth login") as stopped:
        ask(ClaudeCLI(run=FakeRun(output)))
    assert "\n" not in str(stopped.value)


def test_no_claude_cli_on_the_path_is_a_setup_error(monkeypatch, tmp_path):
    from apply.adapters import SetupError
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(SetupError, match="isn't installed"):
        run_claude(["claude", "-p"], "", {"PATH": str(tmp_path)})
