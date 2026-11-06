"""The live Claude and Usage adapters: lean `claude -p` calls on Lisul's Max login.

Every call replaces the system prompt and loads no settings, plugins, MCP
servers or tools, so its fixed context is about 1k tokens instead of about
29k. `ANTHROPIC_API_KEY` is removed from the call's environment, because in
`-p` mode a key always wins over the Max login and would bill the API.
`--bare` is not used: it ignores the Max login. See
research/max-orchestrator.md on branch research/max-orchestrator.

Every call runs from an empty folder with auto-memory off. Run from inside
this repo, a call loaded the parent project's auto-memory: the one live
Pre-submit review (Haiku, CLI 2.1.300, 2026-10-15) took 2,461 input tokens,
against 1,139 for an earlier probe from an empty folder, and carried Lisul's
private notes into the prompt.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from datetime import datetime
from pathlib import Path

from apply import send_click, stuck, trace
from apply.adapters import Drive, SetupError, UsageLimitHit, UsageReading
from apply.browsers import cdp_endpoint
from apply.plain.page import PortPage
from apply.plain.tools import ToolServer

# Runs the claude binary: (argv, stdin, environment) -> stdout.
Run = Callable[[list[str], str, dict], str]
# Runs the claude binary in a folder, yielding its output line by line as it
# comes; closing the iterator stops it: (argv, stdin, environment, cwd) -> lines.
Stream = Callable[[list[str], str, dict, Path], Iterator[str]]

# Claude fill's browser tools: Playwright MCP, attached to the Worker's
# own browser. Pinned; npx caches it after the first call.
PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83"
BROWSER_TOOLS = [
    "browser_snapshot", "browser_find", "browser_click", "browser_type", "browser_fill_form", "browser_select_option",
    "browser_file_upload", "browser_press_key", "browser_hover", "browser_wait_for", "browser_handle_dialog",
    "browser_navigate", "browser_navigate_back", "browser_tabs",
]
# Never: arbitrary code, reading the page's network traffic, closing the Worker's page.
NO_BROWSER_TOOLS = [
    "browser_evaluate", "browser_run_code_unsafe", "browser_network_requests", "browser_network_request",
    "browser_console_messages", "browser_close", "browser_resize", "browser_emulate_media", "browser_take_screenshot",
    "browser_drag", "browser_drop",
]

# A Company brief's research tools: reading the web, nothing on the Mac.
WEB_TOOLS = ["WebSearch", "WebFetch"]

LIMIT_MESSAGE = re.compile(r"hit your (session|weekly) limit", re.IGNORECASE)
PROBE_SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}


class ClaudeError(Exception):
    """A `claude -p` call failed for a reason other than the usage limit."""


class LoggedOut(ClaudeError, SetupError):
    """`claude -p` failed because the claude CLI isn't logged in."""


# What the claude CLI says when it has no login (seen live: "Not logged in · Please run /login").
LOGGED_OUT = re.compile(r"not logged in|please run /login|invalid api key|not signed in", re.IGNORECASE)
LOG_IN = "run `claude auth login` (or `claude`, then /login) in a terminal, then try again"
INSTALL = ("the claude CLI isn't installed or isn't on PATH: install Claude Code (https://claude.com/claude-code), "
           "then run `claude auth login`")


def _logged_out(said: str) -> LoggedOut:
    return LoggedOut(f"Claude isn't logged in ({' '.join(said.split())[:120]}): {LOG_IN}")


# An empty folder to run calls from, so no project's CLAUDE.md or memory loads.
NEUTRAL = Path(tempfile.gettempdir()) / "apply-claude"


# A missing `claude` (exit 127, or the npm wrapper's "native binary not installed"):
# seen live while Claude Code updated itself in place, for longer than one short wait.
NOT_FOUND = 127
NOT_INSTALLED = "native binary not installed"
NOT_FOUND_RETRY_WAITS = (5, 10, 20, 40, 45)  # seconds: about two minutes in all


def run_claude(argv: list[str], stdin: str, env: dict, sleep: Callable[[float], None] = time.sleep) -> str:
    NEUTRAL.mkdir(exist_ok=True)
    try:
        done = _run_once(argv, stdin, env)
        for wait in NOT_FOUND_RETRY_WAITS:
            if done.returncode != NOT_FOUND and NOT_INSTALLED not in done.stderr:
                break
            sleep(wait)
            done = _run_once(argv, stdin, env)
    except FileNotFoundError:
        raise SetupError(INSTALL) from None
    return done.stdout or done.stderr


def _run_once(argv: list[str], stdin: str, env: dict) -> subprocess.CompletedProcess:
    """One run of claude, to its end; Lisul's Resume on the wait (apply.stuck) kills it and raises Stopped."""
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                               cwd=NEUTRAL, text=True)
    killed = _stopped_by_resume(process, process.kill)
    try:
        stdout, stderr = process.communicate(stdin)
    except BaseException:
        process.kill()
        process.wait()
        raise
    if killed():
        raise stuck.Stopped("you pressed Resume while Apply waited on Claude")
    return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)


def _stopped_by_resume(process: subprocess.Popen, kill: Callable[[], None]) -> Callable[[], bool]:
    """Kill `process` with `kill` once Lisul presses Resume on this wait (apply.stuck,
    read on the calling thread); returns whether it was killed so."""
    press, killed = stuck.presses(), threading.Event()
    if press is None:
        return killed.is_set

    def watch() -> None:
        while process.poll() is None:
            if press():
                killed.set()
                kill()
                return
            time.sleep(0.25)
    threading.Thread(target=watch, daemon=True, name="claude-resume").start()
    return killed.is_set


def stream_claude(argv: list[str], stdin: str, env: dict, cwd: Path) -> Iterator[str]:
    try:
        process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   env=env, cwd=cwd, text=True, start_new_session=True)
    except FileNotFoundError:
        raise SetupError(INSTALL) from None
    def kill() -> None:
        try:
            os.killpg(process.pid, 9)  # the cap: claude and its Playwright MCP server stop here
        except (PermissionError, ProcessLookupError):
            # macOS refuses a group whose leader is already exiting; that error
            # must not hide how the call went.
            process.kill()
    killed = _stopped_by_resume(process, kill)
    try:
        process.stdin.write(stdin)
        process.stdin.close()
        yield from process.stdout
        if killed():
            raise stuck.Stopped("you pressed Resume while Apply waited on Claude")
    finally:
        if process.poll() is None:
            kill()
        process.wait()


class ClaudeCLI:
    """Implements both the Claude and the Usage adapter: every call's
    rate_limit_event updates the usage reading."""

    def __init__(self, run: Run = run_claude, now: Callable[[], datetime] = datetime.now, stream: Stream = stream_claude,
                 endpoint: Callable = cdp_endpoint):
        """`endpoint(page)` is where Playwright MCP attaches to the browser of a
        page a Worker opened."""
        self._run = run
        self._stream = stream
        self._endpoint = endpoint
        self._now = now
        self._reading: UsageReading | None = None
        self._lock = threading.Lock()
        self._spent = threading.local()  # tokens used by each thread's calls

    def ask(self, *, model: str, system: str, prompt: str, schema: dict) -> dict:
        argv = _argv(model, system, schema)
        events = _events(self._run(argv, prompt, _env()))
        result = self._result(events)
        self._spend(sum((result.get("usage") or {}).get(k) or 0 for k in TOKENS))
        trace.event("claude", block="ask", model=model, answer=result["structured_output"])
        return result["structured_output"]

    def spent(self) -> int:
        return getattr(self._spent, "tokens", 0)

    def _spend(self, tokens: int) -> None:
        self._spent.tokens = self.spent() + tokens

    def drive(self, *, page, model: str, system: str, prompt: str, schema: dict, files: list[Path],
              max_turns: int, max_tokens: int, hook: tuple[str, ...] = ()) -> Drive:
        """Claude works the Worker's page with Playwright MCP as its only tools,
        attached to the Worker's own browser. It runs in an empty folder holding
        only `files`, which bounds what it can attach. Every turn's tokens
        (cache reads included) count toward `max_tokens`; past either cap,
        claude and its MCP server are stopped. A click Claude names as the
        button that sends is refused before it runs (apply.send_click), run
        with `hook`'s flags (Ask Claude's).

        On a plain Worker's page (a PortPage: no CDP), the `playwright` server
        is Apply's own (apply.plain.mcp), with Playwright MCP's tool names
        and inputs, run on the page through the Worker's port
        (apply.plain.tools)."""
        NEUTRAL.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=NEUTRAL) as folder, ExitStack() as stack:
            for file in files:
                shutil.copy(file, Path(folder) / file.name)
            if isinstance(page, PortPage):
                server = stack.enter_context(ToolServer(page, Path(folder), sys.executable, hook)).mcp_server()
            else:
                server = {"command": shutil.which("npx") or "npx", "args": [
                    "-y", PLAYWRIGHT_MCP, "--cdp-endpoint", self._endpoint(page), "--image-responses", "omit"]}
            argv = _argv(model, system, schema, extra=[
                "--mcp-config", json.dumps({"mcpServers": {"playwright": server}}),
                "--allowedTools", ",".join(f"mcp__playwright__{t}" for t in BROWSER_TOOLS),
                "--disallowedTools", ",".join(f"mcp__playwright__{t}" for t in NO_BROWSER_TOOLS),
                "--settings", send_click.settings(sys.executable, hook),  # a click on the button that sends is refused
            ])
            return self._session(argv, prompt, _env(), Path(folder), max_turns, max_tokens)

    def research(self, *, model: str, system: str, prompt: str, schema: dict, max_turns: int,
                 max_tokens: int) -> Drive:
        """Claude reads the web, with web search and fetch as its only tools,
        until it gives the structured answer. It runs in an empty folder.
        Capped as drive() is."""
        argv = _argv(model, system, schema, tools=WEB_TOOLS, extra=["--allowedTools", ",".join(WEB_TOOLS)])
        NEUTRAL.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=NEUTRAL) as folder:
            return self._session(argv, prompt, _env(), Path(folder), max_turns, max_tokens)

    def work(self, *, folder: Path, model: str, system: str, prompt: str, schema: dict, tools: list[str],
             allowed: list[str], max_turns: int, max_tokens: int, env: dict | None = None,
             denied: list[str] = ()) -> Drive:
        """A coding session in `folder`: Claude Code keeps its own system
        prompt, with `system` added, and has only `tools`, of which only the
        `allowed` permission rules run (anything else is refused, never
        asked) and never the `denied` ones. `env` is added to the call's
        environment. Capped as drive() is."""
        extra = ["--allowedTools", ",".join(allowed)] + (["--disallowedTools", ",".join(denied)] if denied else [])
        argv = _argv(model, system, schema, tools=tools, append=True, extra=extra)
        # Without the caller's virtualenv, `uv run` in `folder` uses the folder's own code (seen live:
        # a Repair's tests imported the checkout that started it).
        environment = {k: v for k, v in _env().items() if k != "VIRTUAL_ENV"} | (env or {})
        return self._session(argv, prompt, environment, folder, max_turns, max_tokens)

    def _session(self, argv: list[str], prompt: str, env: dict, folder: Path, max_turns: int, max_tokens: int) -> Drive:
        """Stream one call in `folder`; every turn's tokens (cache reads
        included) count toward `max_tokens`. Past either cap it is stopped."""
        usage: dict[str, int] = {}  # tokens by assistant message; a message can come in several events
        events = []
        lines = self._stream(argv, prompt, env, folder)
        try:
            for event in _events_of(lines):
                events.append(event)
                trace.claude(event)
                message = event.get("message") or {}
                if event.get("type") == "assistant" and message.get("id"):
                    usage[message["id"]] = sum((message.get("usage") or {}).get(k) or 0 for k in TOKENS)
                    if len(usage) > max_turns or sum(usage.values()) > max_tokens:
                        self._spend(sum(usage.values()))
                        return Drive(None, len(usage), sum(usage.values()), capped=True)
        finally:
            lines.close()
        result = self._result(events)
        totals = result.get("usage") or {}
        tokens = sum(totals.get(k) or 0 for k in TOKENS) if totals else sum(usage.values())
        self._spend(tokens)
        return Drive(result.get("structured_output"), len(usage), tokens)

    def _result(self, events: list[dict]) -> dict:
        """The result event of a call. Raises UsageLimitHit or ClaudeError."""
        result = None
        hit = False
        resets_at = None
        for event in events:
            if event.get("type") == "rate_limit_event":
                info = event.get("rate_limit_info") or {}
                self._note(info)
                if info.get("status") == "rejected":
                    hit, resets_at = True, _time(info.get("resetsAt"))
            elif event.get("type") == "assistant" and event.get("error") == "rate_limit":
                hit = True
            elif event.get("type") == "result":
                result = event

        if result is None and not hit:
            tail = _tail(events)
            if LOGGED_OUT.search(tail):
                raise _logged_out(f"claude -p gave no result: {tail}")
            raise ClaudeError("claude -p gave no result: " + tail)
        text = str((result or {}).get("result", ""))
        if hit or (result or {}).get("api_error_status") == 429 or LIMIT_MESSAGE.search(text):
            with self._lock:
                reading = self._reading or UsageReading()
                self._reading = UsageReading(**{**reading.__dict__, "limited": True, "resets_at": resets_at})
            raise UsageLimitHit(resets_at)
        if result.get("is_error"):
            if LOGGED_OUT.search(text):
                raise _logged_out(text)
            raise ClaudeError(f"claude -p failed: {text}")
        return result

    def reading(self) -> UsageReading:
        """The latest usage. With none yet, or one past a reset, it makes one
        tiny Haiku call to learn the current usage."""
        reading = self._reading
        resets = [t for t in (reading.resets_at, reading.five_hour_resets_at, reading.weekly_resets_at) if t] if reading else []
        if reading is None or any(self._now() >= t for t in resets):
            with self._lock:
                self._reading = None
            try:
                self.ask(model="haiku", system="Reply with ok: true.", prompt="ok", schema=PROBE_SCHEMA)
            except UsageLimitHit:
                pass
        return self._reading or UsageReading()

    def _note(self, info: dict) -> None:
        """Fold one rate_limit_event into the reading. `unifiedWindows` is on the
        wire but undocumented, so every field is read defensively."""
        windows = info.get("unifiedWindows") or {}
        kind = {"five_hour": "five_hour", "seven_day": "weekly"}.get(info.get("rateLimitType"))
        if kind and kind not in windows and "utilization" in info:
            windows = {**windows, info["rateLimitType"]: {"utilization": info["utilization"], "resetsAt": info.get("resetsAt")}}
        with self._lock:
            old = self._reading or UsageReading()
            five = windows.get("five_hour") or {}
            week = windows.get("seven_day") or {}
            self._reading = UsageReading(
                five_hour=float(five.get("utilization", old.five_hour)),
                weekly=float(week.get("utilization", old.weekly)),
                five_hour_resets_at=_time(five.get("resetsAt")) or old.five_hour_resets_at,
                weekly_resets_at=_time(week.get("resetsAt")) or old.weekly_resets_at,
                limited=info.get("status") == "rejected",
                resets_at=_time(info.get("resetsAt")),
            )


# What a turn's usage counts toward a drive's cap.
TOKENS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")


def _argv(model: str, system: str, schema: dict, extra: list[str] = (), tools: list[str] = (),
          append: bool = False) -> list[str]:
    """`append` keeps Claude Code's own system prompt and adds `system` to it."""
    return [
        "claude", "-p",
        "--model", model,
        *(["--effort", "low"] if model == "haiku" else []),  # Haiku's jobs are checks; Sonnet writes essays
        "--append-system-prompt" if append else "--system-prompt", system,
        "--setting-sources", "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--tools", ",".join(tools),
        *extra,
        "--permission-mode", "dontAsk",
        "--json-schema", json.dumps(schema),
        "--output-format", "stream-json",
        "--verbose",
    ]


def _env() -> dict:
    return {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"} | {"CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}


def _events(stdout: str) -> list[dict]:
    return list(_events_of(stdout.splitlines()))


def _events_of(lines) -> Iterator[dict]:
    for line in lines:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            event = {"type": "text", "text": line}
        yield event if isinstance(event, dict) else {"type": "text", "text": line}


def _tail(events: list[dict]) -> str:
    return " ".join(e.get("text", "") for e in events if e.get("type") == "text")[-500:] or "(no output)"


def _time(epoch) -> datetime | None:
    return datetime.fromtimestamp(epoch) if isinstance(epoch, (int, float)) else None
