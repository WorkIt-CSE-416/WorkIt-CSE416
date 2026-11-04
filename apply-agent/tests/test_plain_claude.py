"""Claude fill and Rescue on a plain Worker (KAN-612): Playwright MCP's tools from Apply's own
MCP server (apply.plain.mcp + apply.plain.tools), run on a PortPage over the Worker's port.

The tool tests drive the real stdio server the way `claude -p` does, on a plain Chrome for
Testing (skipped without it, as in CI). The two Claude tests run real Haiku on the Max login
and are skipped unless APPLY_LIVE_CLAUDE=1. Every form here is a fake on 127.0.0.1 whose
server refuses and records any POST: nothing is ever sent.
"""

import http.server
import json
import socket
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

import pytest

from apply.claude_cli import BROWSER_TOOLS
from apply.plain.bridge import Bridge
from apply.plain.launcher import PlainWorkers, chrome_for_testing
from apply.plain.page import PortPage
from apply.plain.tools import ToolServer

try:
    chrome_for_testing()
    HAVE_CHROME = True
except FileNotFoundError:
    HAVE_CHROME = False
needs_chrome = pytest.mark.skipif(not HAVE_CHROME, reason="needs Chrome for Testing (uv run playwright install chromium)")

TOOLS_FORM = """<!doctype html><title>Fake form</title><h1>Apply to Acme</h1>
<label>First name <input id=first></label>
<label for=state>State</label><select id=state><option value="">Pick one</option><option>New York</option></select>
<label><input type=checkbox id=agree> I agree</label>
<button type=button onclick="document.getElementById('resume').click()">Upload resume</button>
<input type=file id=resume hidden>
<button type=button onclick="window.said = confirm('Withdraw your application?')">Withdraw</button>
<iframe srcdoc="<label>Inner field <input id=inner></label>"></iframe>
<script>document.getElementById('resume').addEventListener('change', e => window.picked = e.target.files[0].name)</script>"""

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
            body = {"/tools": TOOLS_FORM, "/posting": POSTING, "/rescue": RESCUE_FORM}.get(self.path.split("?")[0], "<p>no")
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
def tools_on(page, folder: Path):
    with ToolServer(page, folder, sys.executable) as server:
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
