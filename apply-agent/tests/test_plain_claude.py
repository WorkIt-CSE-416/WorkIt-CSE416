"""Claude fill and Rescue on a plain Worker (KAN-612): Playwright MCP's tools from Apply's own
MCP server (apply.plain.mcp + apply.plain.tools), run on a PortPage over the Worker's port.

The tool tests drive the real stdio server the way `claude -p` does, on a plain Chrome for
Testing (skipped without it, as in CI). The two Claude tests run real Haiku on the Max login
and are skipped unless APPLY_LIVE_CLAUDE=1. Every form here is a fake on 127.0.0.1 whose
server refuses and records any POST: nothing is ever sent.
"""

import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

import pytest

from apply import claude_fill, rescue
from apply.claude_cli import BROWSER_TOOLS, ClaudeCLI
from apply.model import FillError
from apply.plain.bridge import Bridge
from apply.plain.launcher import PlainWorkers, chrome_for_testing
from apply.plain.page import PortContext, PortPage
from apply.plain.tools import ToolServer

try:
    chrome_for_testing()
    HAVE_CHROME = True
except FileNotFoundError:
    HAVE_CHROME = False
needs_chrome = pytest.mark.skipif(not HAVE_CHROME, reason="needs Chrome for Testing (uv run playwright install chromium)")
live_claude = pytest.mark.skipif(os.environ.get("APPLY_LIVE_CLAUDE") != "1",
                                 reason="runs real Haiku on the Max login: set APPLY_LIVE_CLAUDE=1")

TOOLS_FORM = """<!doctype html><title>Fake form</title><h1>Apply to Acme</h1>
<label>First name <input id=first></label>
<label for=state>State</label><select id=state><option value="">Pick one</option><option>New York</option></select>
<label><input type=checkbox id=agree> I agree</label>
<button type=button onclick="document.getElementById('resume').click()">Upload resume</button>
<input type=file id=resume hidden>
<button type=button onclick="window.said = confirm('Withdraw your application?')">Withdraw</button>
<iframe srcdoc="<label>Inner field <input id=inner></label>"></iframe>
<script>document.getElementById('resume').addEventListener('change', e => window.picked = e.target.files[0].name)</script>"""

# reCAPTCHA's "I'm not a robot" box, in its frame (its path is reCAPTCHA's), beside a field of the form (KAN-617).
CAPTCHA_FORM = """<!doctype html><title>Apply</title><label>Full name <input id=name></label>
<div class=g-recaptcha><iframe title=reCAPTCHA src="/recaptcha/api2/anchor?k=fake"></iframe></div>"""
ANCHOR = """<!doctype html><label><input type=checkbox id=box onclick="window.ticked = this.checked"> I'm not a robot</label>"""

# A job system with no Filler: the posting, whose Apply shows the form. Its submit would POST.
POSTING = """<!doctype html><title>Ground Software Intern - Acme Robotics Careers</title>
<h1>Ground Software Intern</h1><p>Acme Robotics builds rovers. Summer 2027, in person.</p>
<button id=apply onclick="document.getElementById('form').hidden = false; this.hidden = true">Apply for this job</button>
<form id=form method=post action=/apply hidden>
  <label for=fn>First Name *</label><input id=fn name=fn required>
  <label for=ln>Last Name *</label><input id=ln name=ln required>
  <label for=em>Email *</label><input id=em name=em type=email required>
  <label for=school>School *</label>
  <select id=school name=school required><option value="">Select...</option><option>Stony Brook University</option><option>Other</option></select>
  <fieldset><legend>Are you authorized to work in the U.S.? *</legend>
    <label><input type=radio name=auth value=yes> Yes</label><label><input type=radio name=auth value=no> No</label></fieldset>
  <label for=why>Why Acme? *</label><textarea id=why name=why required></textarea>
  <button type=submit>Submit Application</button>
</form>"""

# A field a Filler's select_option can't drive: a listbox that opens on click.
RESCUE_FORM = """<!doctype html><title>Apply</title><h1>Your details</h1>
<label for=name>Full name</label><input id=name>
<div id=label-pronouns>Pronouns</div>
<div role=combobox id=pronouns tabindex=0 aria-labelledby=label-pronouns aria-expanded=false aria-controls=list
     onclick="document.getElementById('list').hidden = false; this.setAttribute('aria-expanded', 'true')">Select...</div>
<ul role=listbox id=list hidden>
  <li role=option onclick="pick(this)">he/him</li><li role=option onclick="pick(this)">she/her</li>
  <li role=option onclick="pick(this)">they/them</li></ul>
<button type=button onclick="window.next = true">Save and Continue</button>
<script>function pick(li) { const box = document.getElementById('pronouns'); box.textContent = li.textContent;
  box.setAttribute('aria-expanded', 'false'); document.getElementById('list').hidden = true; window.picked = li.textContent; }</script>"""


@pytest.fixture(scope="module")
def site():
    posted = []

    class Pages(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = {"/tools": TOOLS_FORM, "/posting": POSTING, "/rescue": RESCUE_FORM, "/captcha": CAPTCHA_FORM,
                    "/recaptcha/api2/anchor": ANCHOR, "/ask": ASK_FORM}.get(self.path.split("?")[0], "<p>no")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode())

        def do_POST(self):  # never taken: recorded, and refused
            posted.append(self.path)
            self.send_response(403)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    server.posted = posted
    server.url = f"http://127.0.0.1:{server.server_address[1]}"
    yield server
    server.shutdown()
    assert not posted, "a fake form was sent"


@pytest.fixture(scope="module")
def worker():
    folder = Path(tempfile.mkdtemp(prefix="apw-claude-", dir="/tmp"))
    workers = PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"))  # its own socket
    yield workers.launch(0)
    workers.stop_all()


@pytest.fixture
def page(worker, site) -> PortPage:
    page = PortPage.first(worker.connection)
    page.goto(f"{site.url}/tools")
    return page


class Client:
    """`claude -p`'s end of the stdio MCP server."""

    def __init__(self, server: dict):
        self._process = subprocess.Popen([server["command"], *server["args"]], stdin=subprocess.PIPE,
                                         stdout=subprocess.PIPE, text=True)
        self._id = 0
        assert self.rpc("initialize", {"protocolVersion": "2025-06-18"})["serverInfo"]["name"] == "Playwright"

    def rpc(self, method: str, params: dict | None = None):
        self._id += 1
        self._process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}) + "\n")
        self._process.stdin.flush()
        return json.loads(self._process.stdout.readline())["result"]

    def tool(self, name: str, **arguments) -> tuple[str, bool]:
        said = self.rpc("tools/call", {"name": name, "arguments": arguments})
        return said["content"][0]["text"], said.get("isError", False)

    def close(self):
        self._process.stdin.close()
        self._process.wait(5)


@contextmanager
def tools_on(page, folder: Path, hook: tuple[str, ...] = ()):
    with ToolServer(page, folder, sys.executable, hook) as server:
        client = Client(server.mcp_server())
        try:
            yield client
        finally:
            client.close()


def ref(snapshot: str, line_has: str) -> str:
    line = next(line for line in snapshot.splitlines() if line_has in line)
    return line.split("[ref=")[1].split("]")[0]


def test_the_server_lists_playwright_mcps_own_tools_by_the_same_names_and_inputs():
    listening = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    path = Path(tempfile.mkdtemp(dir="/tmp")) / "t.sock"
    listening.bind(str(path))
    listening.listen(1)
    client = Client({"command": sys.executable, "args": ["-I", "-m", "apply.plain.mcp", "--socket", str(path)]})
    try:
        tools = client.rpc("tools/list")["tools"]
    finally:
        client.close()
        listening.close()
    assert [t["name"] for t in tools] == BROWSER_TOOLS
    click = next(t for t in tools if t["name"] == "browser_click")
    assert click["inputSchema"]["required"] == ["target"] and "element" in click["inputSchema"]["properties"]
    assert not {"browser_evaluate", "browser_run_code_unsafe", "browser_take_screenshot"} & {t["name"] for t in tools}


def test_a_drive_on_a_plain_workers_page_gets_apply_s_server_under_playwright_s_name(monkeypatch, tmp_path):
    class Worker:
        def __init__(self):
            self.calls = []

        def call(self, op, **params):
            self.calls.append(op)

        def on(self, *_):
            pass

    seen = {}

    def stream(argv, stdin, env, cwd):
        seen["argv"] = argv
        yield json.dumps({"type": "result", "is_error": False, "structured_output": {"ok": True}, "result": "{}"})

    page = PortPage(Worker(), 7, PortContext(None))
    done = ClaudeCLI(stream=stream, endpoint=lambda p: pytest.fail("no CDP endpoint for a plain Worker")).drive(
        page=page, model="haiku", system="s", prompt="p", schema={}, files=[], max_turns=5, max_tokens=1000)

    assert done.output == {"ok": True} and page.worker.calls == ["mcp.arm"]
    argv = seen["argv"]
    [(name, server)] = json.loads(argv[argv.index("--mcp-config") + 1])["mcpServers"].items()
    assert name == "playwright" and server["command"] == sys.executable
    assert server["args"][:3] == ["-I", "-m", "apply.plain.mcp"] and not Path(server["args"][-1]).exists()  # closed after
    assert argv[argv.index("--allowedTools") + 1] == ",".join(f"mcp__playwright__{t}" for t in BROWSER_TOOLS)
    assert "mcp__playwright__browser_click" in argv[argv.index("--settings") + 1]  # the submit-click hook, unchanged


@needs_chrome
def test_snapshot_refs_drive_the_fields_in_the_page_and_its_frames(page, tmp_path):
    with tools_on(page, tmp_path) as tools:
        snapshot, _ = tools.tool("browser_snapshot")
        assert "```yaml" in snapshot and 'textbox "First name"' in snapshot and "# frame about:srcdoc" in snapshot
        inner = ref(snapshot, 'textbox "Inner field"')
        assert inner.startswith("f") and "e" in inner

        tools.tool("browser_type", target=ref(snapshot, 'textbox "First name"'), text="Testy", element="First name")
        said, error = tools.tool("browser_fill_form", fields=[
            {"target": ref(snapshot, 'combobox "State"'), "name": "State", "type": "combobox", "value": "New York"},
            {"target": ref(snapshot, 'checkbox "I agree"'), "name": "I agree", "type": "checkbox", "value": "true"}])
        assert not error and 'textbox "First name" [ref=' in said and ": Testy" in said  # a fresh snapshot after
        tools.tool("browser_type", target=inner, text="Deep")
        missing, error = tools.tool("browser_click", target="e999", element="Nothing")
        assert error and "Ref e999 not found" in missing
        found, _ = tools.tool("browser_find", text="inner field")
        assert "Inner field" in found

    assert page.input_value("#first") == "Testy" and page.input_value("#state") == "New York" and page.is_checked("#agree")
    assert page.evaluate("() => document.querySelector('iframe').contentDocument.getElementById('inner').value") == "Deep"


@needs_chrome
def test_typing_slowly_replaces_what_the_box_held_as_a_fill_does(page, tmp_path):
    # AMD's iCIMS search box (live, KAN-699): typed after its earlier text, it searched "New YorkNew York".
    with tools_on(page, tmp_path) as tools:
        snapshot, _ = tools.tool("browser_snapshot")
        box = ref(snapshot, 'textbox "First name"')
        tools.tool("browser_type", target=box, text="New York")
        said, error = tools.tool("browser_type", target=box, text="New", slowly=True)
        assert not error and "pressSequentially(\"New\")" in said
    assert page.input_value("#first") == "New"


@needs_chrome
def test_no_tool_clicks_types_or_keys_into_a_captcha_and_the_form_s_own_fields_still_take_answers(page, site, tmp_path):
    page.goto(f"{site.url}/captcha")
    with tools_on(page, tmp_path) as tools:
        snapshot, _ = tools.tool("browser_snapshot")
        box, frame = ref(snapshot, "I'm not a robot"), ref(snapshot, "iframe")
        assert box.startswith("f")
        for name, arguments in [
            ("browser_click", {"target": box, "element": "checkbox"}),  # named so the hook would let it by
            ("browser_click", {"target": frame, "element": "frame"}),
            ("browser_fill_form", {"fields": [{"target": box, "name": "box", "type": "checkbox", "value": "true"}]}),
            ("browser_hover", {"target": box}),
        ]:
            said, error = tools.tool(name, **arguments)
            assert error and "never touches" in said, name
        said, error = tools.tool("browser_type", target=ref(snapshot, 'textbox "Full name"'), text="Test Person")
        assert not error
    anchor = next(f for f in page.frames if "/recaptcha/" in f.url)
    assert anchor.evaluate("() => document.getElementById('box').checked") is False
    assert page.input_value("#name") == "Test Person"


@needs_chrome
def test_a_dialog_is_answered_at_once_reported_and_the_next_one_answered_as_claude_says(page, tmp_path):
    with tools_on(page, tmp_path) as tools:
        withdraw = ref(tools.tool("browser_snapshot")[0], 'button "Withdraw"')
        said, _ = tools.tool("browser_click", target=withdraw, element="Withdraw")
        assert '"confirm" dialog with message "Withdraw your application?": dismissed' in said
        assert page.evaluate("() => window.said") is False
        tools.tool("browser_handle_dialog", accept=True)
        tools.tool("browser_click", target=f'button "Withdraw" [ref={withdraw}]', element="Withdraw")  # as Haiku quotes refs
        assert page.evaluate("() => window.said") is True


@needs_chrome
def test_a_file_goes_only_to_the_chooser_a_click_opened_and_only_from_the_drives_folder(page, tmp_path):
    (tmp_path / "Test_Person_Resume.pdf").write_bytes(b"%PDF-1.4 test")
    with tools_on(page, tmp_path) as tools:
        upload = ref(tools.tool("browser_snapshot")[0], 'button "Upload resume"')
        said, error = tools.tool("browser_file_upload", paths=[str(tmp_path / "Test_Person_Resume.pdf")])
        assert error and "modal state" in said
        said, _ = tools.tool("browser_click", target=upload, element="Upload resume")
        assert "[File chooser]" in said
        said, error = tools.tool("browser_file_upload", paths=["/etc/hosts"])
        assert error and "outside the working folder" in said
        said, error = tools.tool("browser_file_upload", paths=[str(tmp_path / "Test_Person_Resume.pdf")])
        assert not error and "[File chooser]" not in said
    assert page.evaluate("() => window.picked") == "Test_Person_Resume.pdf"


@needs_chrome
def test_the_upload_works_with_the_tiles_chooser_hook_on_the_page_too(page, tmp_path):
    page.worker.call("chooser.watch", tab=page.tab)  # S3's hook first: it swallows input.click()
    (tmp_path / "Test_Person_Resume.pdf").write_bytes(b"%PDF-1.4 test")
    with tools_on(page, tmp_path) as tools:
        upload = ref(tools.tool("browser_snapshot")[0], 'button "Upload resume"')
        said, _ = tools.tool("browser_click", target=upload, element="Upload resume")
        assert "[File chooser]" in said
        said, error = tools.tool("browser_file_upload", paths=[str(tmp_path / "Test_Person_Resume.pdf")])
        assert not error
    assert page.evaluate("() => window.picked") == "Test_Person_Resume.pdf"
    assert page.evaluate("() => document.documentElement.getAttribute('data-apply-chooser')") is None


class PlainSite:
    """The JobSite a Claude fill opens its page through: the plain Worker's tab."""

    def __init__(self, page: PortPage):
        self._page = page

    @contextmanager
    def open(self, url: str):
        self._page.goto(url)
        yield self._page

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        raise AssertionError("no fetch")


@needs_chrome
@live_claude
def test_claude_fill_reads_and_fills_a_form_with_no_filler_on_a_plain_worker_and_sends_nothing(worker, site):
    page = PortPage.first(worker.connection)
    fill = claude_fill.ClaudeFill(ClaudeCLI())
    questions = fill.question_set(f"{site.url}/posting", PlainSite(page))
    by_label = {q.label.rstrip(" *"): q for q in questions}
    assert {"First Name", "Last Name", "Email", "School", "Why Acme?"} <= set(by_label), [q.label for q in questions]
    auth = next(q for q in questions if "authorized" in q.label)
    answers = {by_label["First Name"].name: "Testy", by_label["Last Name"].name: "McTestface",
               by_label["Email"].name: "testy@example.com", by_label["School"].name: "Stony Brook University",
               auth.name: "Yes", by_label["Why Acme?"].name: "I like rovers."}

    readback = fill.fill(page, questions, answers)

    assert page.input_value("#fn") == "Testy" and page.input_value("#ln") == "McTestface"
    assert page.input_value("#em") == "testy@example.com" and page.input_value("#school") == "Stony Brook University"
    assert page.is_checked("input[name=auth][value=yes]") and page.input_value("#why") == "I like rovers."
    # What Claude read back is ClaudeFill's, unchanged from the CDP path (Haiku sometimes names a
    # field by its label rather than q1..., and ClaudeFill then reads it as not filled): not asserted here.
    assert fill._submit_button.lower() == "submit application" and not site.posted
    print(fill.usage(), readback)


@needs_chrome
@live_claude
def test_a_rescue_fills_on_a_plain_worker_the_field_the_filler_could_not(worker, site):
    page = PortPage.first(worker.connection)
    page.goto(f"{site.url}/rescue")
    page.fill("#name", "Testy McTestface")
    with pytest.raises(Exception) as failed:  # the Filler's own try: a <select> call on a listbox
        page.get_by_role("combobox", name="Pronouns").select_option("they/them", timeout=1000)

    helped = rescue.Rescue(ClaudeCLI())
    done = helped.field(page, "Pronouns", "they/them", FillError(str(failed.value)))

    assert done and page.evaluate("() => window.picked") == "they/them"
    assert page.input_value("#name") == "Testy McTestface" and not page.evaluate("() => window.next")
    assert helped.notes and not site.posted


ASK_FORM = """<!doctype html><title>Step</title>
<label>GPA <input id=gpa></label><label>Secret <input id=pw type=password></label><input id=otp name=otp_code aria-label="Enter it">
<label><input id=native type=checkbox> I certify that my answers are true</label>
<div id=custom style="width:20px;height:20px" role=checkbox aria-checked=false tabindex=0 aria-label="I acknowledge the privacy notice"
  onclick="this.setAttribute('aria-checked', 'true')"></div>
<button type=button onclick="window.resent = true">Resend code</button><button type=button onclick="window.sent = true">Submit application</button>"""


@needs_chrome
def test_on_a_plain_worker_asks_tools_judge_the_real_element(page, site, tmp_path):
    page.goto(f"{site.url}/ask")
    with tools_on(page, tmp_path, ("--ask",)) as tools:
        shot, _ = tools.tool("browser_snapshot")
        for line, tool, given in (('textbox "Secret', "browser_type", {"text": "hunter2"}), ("Enter it", "browser_type", {"text": "123456"}),
                                  ('checkbox "I certify', "browser_click", {}), ("I acknowledge", "browser_click", {}),
                                  ("Resend code", "browser_click", {}), ("Submit application", "browser_click", {})):
            said, error = tools.tool(tool, target=ref(shot, line), element="GPA", **given)  # Claude's wording says GPA
            assert error, line
        said, error = tools.tool("browser_type", target=ref(shot, 'textbox "GPA'), text="3.7", element="GPA")
        assert not error, said
        page.evaluate("() => otp.focus()")  # focus on it: its key is refused too
        said, error = tools.tool("browser_press_key", key="1")
        assert error and "password or verification-code" in said
    assert page.evaluate("() => [gpa.value, pw.value, otp.value, native.checked, custom.getAttribute('aria-checked'), !!window.resent, !!window.sent]") == [
        "3.7", "", "", False, "false", False, False]


@needs_chrome
def test_on_a_plain_worker_a_box_his_message_names_goes_on(page, site, tmp_path):
    page.goto(f"{site.url}/ask")
    with tools_on(page, tmp_path, ("--ask", "--message=tick the box: I certify that my answers are true")) as tools:
        shot, _ = tools.tool("browser_snapshot")
        assert not tools.tool("browser_click", target=ref(shot, 'checkbox "I certify'))[1]
        assert tools.tool("browser_click", target=ref(shot, "I acknowledge"))[1]
    assert page.evaluate("() => [native.checked, custom.getAttribute('aria-checked')]") == [True, "false"]
