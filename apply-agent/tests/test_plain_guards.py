"""The submit and drive guards on a plain Worker (KAN-610): Chrome for Testing, no CDP, a fake job
system on 127.0.0.1 that records every POST it gets. A guarded rehearsal page never sends, by a
click, a form, or the page's own script (fetch from another realm, a worker, a beacon, a native
POST); a press relayed from the tile counts as Lisul's; once lifted, his Submit goes through.
Skips without Chrome for Testing (CI)."""

import http.server
import re
import tempfile
import threading
import time
from pathlib import Path

import pytest
from test_plain_reload import turn_on_developer_mode

from apply import submit_guard
from apply.plain import guards
from apply.plain.bridge import FEATURES, Bridge
from apply.plain.launcher import PlainWorkers, chrome_for_testing
from apply.plain.page import PortPage
from apply.submit_guard import (
    DriveGuard,
    applied_dismissed,
    guard,
    lift,
    rearm,
    renote,
    warn_applied,
)

try:
    chrome_for_testing()
    HAVE_CHROME = True
except FileNotFoundError:
    HAVE_CHROME = False

live = pytest.mark.skipif(not HAVE_CHROME, reason="needs Chrome for Testing (uv run playwright install chromium)")

FORM = """<!doctype html><title>Acme application</title>
<form id="form" method="post" action="/acme/j/42/apply">
  <label>First name <input name="first" value="Test"></label>
  <button type="button" id="next">Next</button>
  <button type="submit">Submit application</button>
</form>"""

# A page whose own script sends the application every way a page can, as it loads: each
# would reach the job system (the control test shows it), and none may from a guarded page.
SCRIPTED = """<!doctype html><title>Scripted</title>
<form id="form" method="post" action="/acme/j/5/apply"><input name="first" value="Test"><button>Next</button></form>
<script>
  const post = (path) => ({method: 'POST', body: 'first=Test'});
  // 1. the page's own fetch and XHR
  fetch('/acme/job/1/submitApplication', post()).catch(() => {});
  try { const x = new XMLHttpRequest(); x.open('POST', '/acme/job/2/submitApplication'); x.send('a'); } catch (e) {}
  // 2. a fresh realm's fetch and beacon, which the page's guard never wrapped
  const frame = document.createElement('iframe');
  document.documentElement.appendChild(frame);
  try { frame.contentWindow.fetch('/acme/job/3/submitApplication', post()).catch(() => {}); } catch (e) {}
  try { frame.contentWindow.navigator.sendBeacon('/acme/job/4/submitApplication', 'a'); } catch (e) {}
  // 3. a worker, where no page script runs
  new Worker(URL.createObjectURL(new Blob(["fetch('" + location.origin + "/acme/job/6/submitApplication', {method: 'POST', body: 'a'}).catch(() => {})"])));
  // 4. a script's requestSubmit, then the form's native POST through the fresh realm's submit
  setTimeout(() => { try { document.getElementById('form').requestSubmit(); } catch (e) {} }, 300);
  setTimeout(() => { try { frame.contentWindow.HTMLFormElement.prototype.submit.call(document.getElementById('form')); } catch (e) {} }, 1200);
</script>"""


# A step whose Next posts natively (TAL.net's), then a step with a Continue bound for a final URL.
NATIVE_STEP = """<!doctype html><title>One</title><form method="post" action="/step/two"><input name="first"><button>Next</button></form>"""
NATIVE_LAST = """<!doctype html><title>Two</title><form method="post" action="/acme/j/42/apply"><input name="why"><button>Continue</button></form>"""


class Site:
    def __init__(self):
        self.posts: list[str] = []
        site = self

        class Pages(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                page = (SCRIPTED if self.path.startswith("/scripted") else FORM if self.path.startswith("/form")
                        else NATIVE_STEP if self.path.startswith("/native") else "<p>other")
                self.wfile.write(page.encode())

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                site.posts.append(self.path)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(NATIVE_LAST.encode() if self.path == "/step/two" else b"<title>Thanks</title><p>Application received")

            def log_message(self, *_):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"


@pytest.fixture
def site():
    site = Site()
    yield site
    site.server.shutdown()


@pytest.fixture(scope="module")
def worker():
    """One plain Worker for the module, started in the background and stopped (by its PID) after."""
    if not HAVE_CHROME:
        pytest.skip("needs Chrome for Testing")
    folder = Path(tempfile.mkdtemp(prefix="apw-guards-", dir="/tmp"))
    workers = PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"))  # its own socket
    try:
        yield workers.launch(0).connection
    finally:
        workers.stop_all()


@pytest.fixture
def page(worker, site):
    """A new background tab on the fake form, with no guard left from another test."""
    guards.reset(worker)
    old = [t["tab"] for t in worker.call("tabs.query")]
    page = PortPage(worker, worker.call("tabs.create", url="about:blank", active=False)["tab"])
    for tab in old:
        worker.call("tabs.close", tab=tab)
    page.goto(f"{site.url}/form")
    return page


def _settle(page, seconds: float = 2.5) -> None:
    page.wait_for_timeout(seconds * 1000)


def _note(page) -> str:
    return page.evaluate("() => (document.getElementById('apply-rehearsal-blocked') || {}).textContent || ''")


# --- without a browser

def test_the_cdp_scripts_are_the_plain_ones_less_their_port_lines():
    for cdp, plain in [(submit_guard.SCRIPT, submit_guard.rehearsal_script(port=True)),
                       (submit_guard.drive_script(True, False), submit_guard.drive_script(True, False, port=True))]:
        name = "Apply rehearsal" if cdp is submit_guard.SCRIPT else "Apply drive guard"
        assert plain.replace(submit_guard.PORT_TOUCH, "").replace(submit_guard.PORT_SAID.replace("@NAME@", name), "") == cdp
        assert "__apply_touch" in plain and "__apply_touch" not in cdp


def test_the_plain_rules_block_every_url_the_cdp_route_aborts():
    urls = ["https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitMultipleFormsAction",
            "https://acme.bamboohr.com/careers/398/add", "https://apply.workable.com/api/v1/jobs/D309E69A5B/apply",
            "https://jobs.jobvite.com/tylertech/job/oAVOAfwD/submitApplication", "https://x.example/submit/123",
            "https://boards.greenhouse.io/arcboatcompany/jobs/5442881008",
            "https://jobs.lever.co/immuta/79fdda46-4ff5-42c7-b208-55f2084cdb8c/apply"]
    for url in urls:
        assert guards.PATTERN.search(url), url
        if submit_guard.ROUTED.search(url):
            assert any(re.search(r, url, re.IGNORECASE) for r in guards.RULES)
    assert not guards.PATTERN.search("https://jobs.lever.co/immuta/79fdda46-4ff5-42c7-b208-55f2084cdb8c")
    assert guards.alternatives(r"a(b|c)|[|]d|e\|f") == ["a(b|c)", "[|]d", r"e\|f"]


def test_add_init_script_knows_each_guard_script_by_its_file():
    assert guards.init_script(submit_guard.SCRIPT)["file"] == "vendor/guards/rehearsal.js"
    assert guards.init_script(submit_guard.drive_script(False, True))["file"] == "vendor/guards/drive-01.js"
    assert guards.init_script("window.x = 1") == {"id": guards._sha("window.x = 1")[:16], "code": "window.x = 1"}


# --- live, in a plain Worker

@live
def test_without_the_guard_the_scripted_page_reaches_the_job_system(page, site):
    page.goto(f"{site.url}/scripted")
    _settle(page)
    assert {p for p in site.posts if "submitApplication" in p} >= {f"/acme/job/{n}/submitApplication" for n in (1, 2, 3, 4, 6)}
    assert "/acme/j/5/apply" in site.posts


@live
def test_a_guarded_page_that_submits_by_script_sends_nothing(page, site):
    guard(page)  # on the form; the scripted page loads after, in the same tab
    page.goto(f"{site.url}/scripted")
    _settle(page)
    assert site.posts == []
    assert page.worker.call("guard.status", tab=page.tab)["rules"] == len(guards.RULES)


@live
def test_the_rules_alone_stop_what_the_page_s_script_sends(page, site):
    page.route(guards.PATTERN, submit_guard._refuse)  # no guard script: declarativeNetRequest only
    page.goto(f"{site.url}/scripted")
    _settle(page)
    assert site.posts == []
    page.unroute(guards.PATTERN, submit_guard._refuse)
    page.goto(f"{site.url}/scripted")
    _settle(page)
    assert "/acme/job/6/submitApplication" in site.posts


@live
def test_apply_s_click_on_submit_and_a_scripted_submit_send_nothing_and_the_note_shows(page, site):
    guard(page)
    page.get_by_role("button", name="Submit application").click()
    page.evaluate("() => document.getElementById('form').requestSubmit()")
    page.evaluate("() => document.getElementById('form').submit()")
    _settle(page, 1)
    assert site.posts == []
    assert "blocked" in _note(page)  # Apply's untrusted click counts as a touch, as a trusted one


@live
def test_a_tile_press_counts_as_lisuls(page, site):
    touched = []
    page.worker.on("guard.touched", touched.append)  # (the module's one Worker: this test's alone listens)
    guard(page)
    page.evaluate("() => document.querySelector('button[type=submit]').click()")  # the page's own script
    assert _note(page) == ""  # blocked, unshown: no press yet
    guards.touch(page)  # what S3's tile replay does before Lisul's press
    page.evaluate("() => document.querySelector('button[type=submit]').click()")
    _settle(page, 0.5)
    assert site.posts == []
    assert "blocked" in _note(page)
    assert [(t["tab"], t["by"]) for t in touched] == [(page.tab, "lisul")]
    page.worker.off("guard.touched", touched.append)


@live
def test_a_click_from_the_tile_counts_as_lisuls(page, site):
    touched = []
    page.worker.on("guard.touched", touched.append)
    guard(page)
    box = page.get_by_role("button", name="Submit application").bounding_box()
    at = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
    for kind in ("down", "up"):  # what apply.plain.tile sends for his click on the tile
        page.worker.call("tile.input", tab=page.tab, event={"type": kind, "button": "left", "clicks": 1, **at})
    _settle(page, 0.5)
    assert site.posts == []
    assert "blocked" in _note(page)
    assert [(t["tab"], t["by"]) for t in touched] == [(page.tab, "lisul")]  # once, for the press
    page.worker.off("guard.touched", touched.append)


@live
def test_once_lifted_lisul_s_submit_goes_through_and_apply_hears_it(page, site):
    pressed, again = [], []
    guard(page)
    lift(page, pressed=pressed.append, again=lambda: again.append(True), warning="Phone left blank", wrong=False)
    assert page.worker.call("guard.status", tab=page.tab)["rules"] == 0
    assert _note(page).startswith("Apply rehearsal: check before you submit. Phone left blank")
    page.get_by_role("button", name="Fill again").click()
    page.get_by_role("button", name="Next").click()  # a Next sends nothing, and isn't heard
    guards.touch(page)
    page.get_by_role("button", name="Submit application").click()  # his press, from the tile
    deadline = time.monotonic() + 5
    while (not pressed or not site.posts) and time.monotonic() < deadline:
        time.sleep(0.1)
    assert site.posts == ["/acme/j/42/apply"]
    assert pressed == ["Submit application"] and again == [True]


@live
def test_a_held_submit_is_blocked_until_lisul_dismisses_it(page, site):
    """KAN-629 on a plain page: held, Submit blocked under the red note; Dismiss; then Submit goes."""
    dismissed, pressed = [], []
    guard(page)
    lift(page, pressed=pressed.append, held="'Are you a US person?' reads No, but you are",
         dismiss=lambda: dismissed.append(True))
    assert _note(page).startswith("Apply rehearsal: Submit is held. Fix this answer, then press Dismiss: 'Are you")
    page.get_by_role("button", name="Next").click()  # a held page is his but for its Submit
    guards.touch(page)
    page.get_by_role("button", name="Submit application").click()
    _settle(page, 1)
    assert site.posts == []  # held: blocked
    assert "Submit is held" in _note(page)
    page.get_by_role("button", name="Dismiss").click()  # his press on the note, from the tile
    deadline = time.monotonic() + 5
    while not dismissed and time.monotonic() < deadline:
        time.sleep(0.1)
    assert dismissed == [True]
    assert renote(page, held="")  # what the hold loop does once nothing holds it
    assert _note(page).startswith("Apply rehearsal: Apply is done with this page")
    guards.touch(page)
    page.get_by_role("button", name="Submit application").click()
    deadline = time.monotonic() + 5
    while not site.posts and time.monotonic() < deadline:
        time.sleep(0.1)
    assert site.posts == ["/acme/j/42/apply"]


@live
def test_renote_leaves_a_page_lisul_already_applied_to_guarded_till_he_dismisses_its_note(page, site):
    """KAN-621 on a plain page: the red note, the guard still on; renote changes nothing; two presses."""
    dismissed = []
    guard(page)
    warn_applied(page, "2026-11-03", lambda: dismissed.append(True))
    applied = "() => (document.getElementById('apply-already-applied') || {}).textContent || ''"
    assert page.evaluate(applied).startswith("You already applied on 2026-11-03")
    assert renote(page, "Phone left blank") is False  # still guarded: no note of a lifted page
    assert page.worker.call("guard.status", tab=page.tab)["lifted"] is False
    guards.touch(page)
    page.get_by_role("button", name="Submit application").click(force=True)  # the note sits over it here
    _settle(page, 1)
    assert site.posts == []
    page.locator("#apply-already-applied button").click()  # the first press only asks
    assert dismissed == [] and "unblock this page" in page.evaluate(applied)
    page.locator("#apply-already-applied button").click()
    deadline = time.monotonic() + 5
    while not dismissed and time.monotonic() < deadline:
        time.sleep(0.1)
    assert dismissed == [True]
    applied_dismissed(page)
    page.reload()
    assert page.evaluate(applied) == ""  # no page shows it again


@live
def test_a_lifted_tab_stays_lisuls_on_reload_and_rearm_guards_it_again(page, site):
    again = []
    guard(page)
    lift(page, again=lambda: again.append(True))
    page.reload()
    page.get_by_role("button", name="Fill again").click()
    renote(page, "Postgrad Discipline(s) ticked", wrong=True)
    assert _note(page).startswith("Apply rehearsal: fix this before you submit. Postgrad")
    page.evaluate("() => { document.querySelector('input').value = 'Lisul typed'; }")
    rearm(page)  # Resume: no reload, so what he typed stays
    assert page.evaluate("() => document.querySelector('input').value") == "Lisul typed"
    assert _note(page) == ""
    page.get_by_role("button", name="Submit application").click()
    page.evaluate("() => fetch('/acme/job/9/submitApplication', {method: 'POST'}).catch(() => null)")
    _settle(page, 1)
    deadline = time.monotonic() + 3
    while not again and time.monotonic() < deadline:
        time.sleep(0.1)
    assert again == [True]
    assert site.posts == []


@live
def test_the_drive_guard_blocks_claudes_submit_until_lifted_for_its_own_click(page, site):
    drive = DriveGuard(page)
    assert isinstance(drive, guards.PlainDriveGuard)
    page.get_by_role("button", name="Submit application").click()
    assert drive.blocked() == ['the "Submit application" click']
    assert site.posts == []
    drive.lift()  # Claude fill's own submit click in a live run
    page.get_by_role("button", name="Submit application").click()
    deadline = time.monotonic() + 5
    while not site.posts and time.monotonic() < deadline:
        time.sleep(0.1)
    assert site.posts == ["/acme/j/42/apply"]


@live
def test_the_drive_guard_rests_and_arms_as_claude_fill_drives(page, site):
    drive = DriveGuard(page)
    drive.arm()
    drive.rest()  # Claude stopped driving (KAN-633: raised AttributeError on a plain page)
    drive.arm()
    page.get_by_role("button", name="Submit application").click()
    assert drive.blocked() == ['the "Submit application" click']
    assert site.posts == []




# --- a reload of the worker extension (KAN-657): chrome.runtime.reload() drops its registered scripts, its session
# rules and its memory, on a form's open tab. `extension.reload` must bring all of them back.


@pytest.fixture
def reloading():
    """A plain Worker of its own, with Developer mode on (Chrome disables a reloaded unpacked extension without it)."""
    if not HAVE_CHROME:
        pytest.skip("needs Chrome for Testing")
    folder = Path(tempfile.mkdtemp(prefix="apw-reload-", dir="/tmp"))
    bridge = Bridge(folder / "w.sock")
    workers = PlainWorkers(folder, kind="testing", bridge=bridge)
    turn_on_developer_mode(workers.profile(0))
    try:
        yield workers, bridge
    finally:
        workers.stop_all()


def _open_form(workers, site) -> PortPage:
    connection = workers.launch(0).connection
    page = PortPage(connection, connection.call("tabs.create", url="about:blank", active=False)["tab"])
    page.goto(f"{site.url}/form")
    return page


def _after_reload(page, connection) -> PortPage:
    """The same tab through the Worker's new port, and its document loaded again under what the reload left."""
    again = PortPage(connection, page.tab)
    again.reload()
    return again


def _blocks_every_way(page, site) -> None:
    """Submit's click, the form's native POST, and a POST from the page's script: nothing reaches the job system."""
    page.get_by_role("button", name="Submit application").click()
    page.evaluate("() => { document.getElementById('form').requestSubmit(); }")
    page.evaluate("() => fetch('/acme/job/9/submitApplication', {method: 'POST'}).catch(() => null)")
    _settle(page, 1)
    assert site.posts == []


@pytest.mark.parametrize("from_hello", [False, True], ids=["extension.reload", "the reload at hello"])
def test_the_guards_survive_a_reload_of_the_extension(reloading, site, from_hello):
    workers, bridge = reloading
    page = _open_form(workers, site)
    guard(page)
    assert page.worker.call("guard.status", tab=page.tab)["rules"]
    if from_hello:
        bridge.expects = FEATURES + 1  # the hello after it is older than Apply: reloaded again, before its welcome
    connection = bridge.reload(0)
    page = _after_reload(page, connection)
    status = connection.call("guard.status", tab=page.tab)
    assert status["rules"] and "apply-init-rehearsal" in status["scripts"] and "apply-relay" in status["scripts"]
    _blocks_every_way(page, site)


def test_the_rules_alone_survive_a_reload(reloading, site):
    workers, bridge = reloading
    page = _open_form(workers, site)
    guard(page)
    connection = bridge.reload(0)
    page = _after_reload(page, connection)
    connection.call("guard.flags", tab=page.tab, set={"__applyRehearsalLifted": True})  # the in-page guard off: the rule stops it
    page.evaluate("() => fetch('/acme/job/9/submitApplication', {method: 'POST'}).catch(() => null)")
    _settle(page, 1)
    assert site.posts == []


def test_a_held_pages_submit_stays_blocked_after_a_reload(reloading, site):
    workers, bridge = reloading
    page = _open_form(workers, site)
    guard(page)
    lift(page, held="the pronouns answer")
    page.get_by_role("button", name="Submit application").click()
    assert site.posts == []
    connection = bridge.reload(0)
    page = _after_reload(page, connection)
    _settle(page, 0.5)
    assert connection.call("guard.status", tab=page.tab)["lifted"] is True
    page.get_by_role("button", name="Submit application").click()
    _settle(page, 1)
    assert site.posts == []
    assert "Submit is held" in _note(page)


def test_a_page_already_lifted_stays_lisuls_after_a_reload(reloading, site):
    workers, bridge = reloading
    page = _open_form(workers, site)
    guard(page)
    lift(page)
    connection = bridge.reload(0)
    page = _after_reload(page, connection)
    _settle(page, 0.5)
    page.get_by_role("button", name="Submit application").click()
    deadline = time.monotonic() + 5
    while not site.posts and time.monotonic() < deadline:
        time.sleep(0.1)
    assert site.posts == ["/acme/j/42/apply"]


def test_what_the_guard_blocks_after_a_reload_reaches_apply(reloading, site):
    workers, bridge = reloading
    page = _open_form(workers, site)
    guard(page)
    connection = bridge.reload(0)
    page = PortPage(connection, page.tab)  # the document from before the reload, not loaded again
    said = []
    connection.on("guard.said", said.append)
    page.get_by_role("button", name="Submit application").click()
    connection.call("guard.sync", tab=page.tab)
    time.sleep(0.2)
    assert site.posts == [] and [m["text"] for m in said] == ['Apply rehearsal blocked the "Submit application" click']


def test_guard_reset_still_clears_everything_and_a_later_reload_brings_nothing_back(reloading, site):
    workers, bridge = reloading
    page = _open_form(workers, site)
    guard(page)
    guards.reset(page.worker)
    connection = bridge.reload(0)
    status = connection.call("guard.status", tab=page.tab)
    assert status["rules"] == 0 and status["scripts"] == [] and status["lifted"] is False


# --- Ask Claude on a plain Worker (KAN-638, the CDP path is test_rehearse -k ask_claude_on_a_held_page)

def _plain_ask(page, drive, act, tmp_path):
    """ask.ask on a plain page: the fake Claude acts through the plain tools, as `claude -p` does."""
    from types import SimpleNamespace

    from apply import ask
    from apply.adapters import Drive
    from apply.model import Posting
    from apply.plain.tools import Tools

    def go(**given):
        act(Tools(given["page"], tmp_path, given["hook"]))
        return Drive({"blocked": False, "why": "", "press": "", "reply": "Done.", "changed": [], "couldnt": [],
                      "waiting": [], "ticked": [], "remember": [], "apply_bug": []}, 2, 100)

    return ask.ask(SimpleNamespace(drive=go), page, "go back a step and press Enter", [],
                   ask.Form(Posting(id="1", company="A", title="B", url=page.url)), "", guard=drive)


@live
def test_ask_claude_on_a_plain_held_page_sends_nothing_and_his_submit_goes_after(page, site, tmp_path):
    from apply.plain.tools import ToolError

    drive = DriveGuard(page)
    guard(page)
    lift(page)  # held for Lisul
    rearm(page)  # hold(): both guards back on for the drive

    def act(tools):
        shot = tools.browser_snapshot()
        submit = re.search(r'button "Submit application" \[ref=(\w+)\]', shot)[1]
        field = re.search(r'textbox "First name[^"]*" \[ref=(\w+)\]', shot)[1]
        assert "Error" not in tools.browser_type(field, "Lisul", element="First name")
        with pytest.raises(ToolError, match="sends the application"):  # what it really is, not Claude's word
            tools.browser_click(submit, element="Next")
        tools.page.evaluate("() => document.getElementById('form').requestSubmit()")  # Enter's implicit submit
        tools.page.goto(f"{site.url}/form")  # a step that loads a new document
        tools.page.evaluate("() => document.getElementById('form').requestSubmit()")
        tools.page.evaluate("() => fetch('/acme/j/42/apply', {method: 'POST'}).catch(() => null)")
        _settle(tools.page, 1)

    _plain_ask(page, drive, act, tmp_path)
    assert site.posts == []
    assert page.worker.call("guard.status", tab=page.tab)["rules"]  # the rules are on through the drive
    lift(page, bound=True)  # hold(): his again after it
    page.get_by_role("button", name="Submit application").click()
    deadline = time.monotonic() + 5
    while not site.posts and time.monotonic() < deadline:
        time.sleep(0.1)
    assert site.posts == ["/acme/j/42/apply"]


@live
def test_ask_s_drive_on_a_plain_page_refuses_the_real_submit_whatever_claude_calls_it(page, site, tmp_path):
    from apply.plain.tools import ToolError, Tools

    guard(page)
    tools = Tools(page, tmp_path, ("--ask",))
    shot = tools.browser_snapshot()
    with pytest.raises(ToolError, match="sends the application"):
        tools.browser_click(re.search(r'button "Submit application" \[ref=(\w+)\]', shot)[1], element="Next")
    assert site.posts == []


@live
def test_ask_s_press_on_a_plain_worker_goes_through_a_native_post_step_but_never_to_a_final_url(page, site, monkeypatch):
    from types import SimpleNamespace

    from apply import ask, claude_fill
    from apply.adapters import Drive
    from apply.model import Posting

    monkeypatch.setattr(claude_fill, "STEP_SHOWS_MS", 1_000)
    page.goto(f"{site.url}/native")
    drive = DriveGuard(page)
    guard(page)
    lift(page)  # held for Lisul
    rearm(page)  # hold(): both guards back on for the drive
    empty = {"blocked": False, "why": "", "reply": "Done.", "changed": [], "couldnt": [], "waiting": [], "ticked": [],
             "remember": [], "apply_bug": []}
    page.get_by_role("button", name="Next").click()  # Claude's own click: blocked
    _settle(page, 0.5)
    assert site.posts == []
    turns = iter([{**empty, "press": "Next"}, {**empty, "press": "Continue"}])
    reply = ask.ask(SimpleNamespace(drive=lambda **given: Drive(next(turns), 2, 100)), page, "go on", [],
                    ask.Form(Posting(id="1", company="A", title="B", url=page.url)), "", guard=drive)
    assert site.posts == ["/step/two"] and page.title() == "Two"
    assert "didn't press 'Continue'" in reply.couldnt[0]
