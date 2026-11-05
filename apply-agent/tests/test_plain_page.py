"""PortPage live: Playwright's Page/Locator subset over a plain Worker (Chrome for Testing, no CDP).
Skips without Chrome for Testing (CI)."""

import http.server
import tempfile
import threading
from pathlib import Path

import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

from apply import fill_engine
from apply.plain import demo
from apply.plain.bridge import Bridge, PortTimeoutError
from apply.plain.launcher import PlainWorkers, chrome_for_testing
from apply.plain.page import PortPage

try:
    chrome_for_testing()
    HAVE_CHROME = True
except FileNotFoundError:
    HAVE_CHROME = False

pytestmark = pytest.mark.skipif(not HAVE_CHROME, reason="needs Chrome for Testing (uv run playwright install chromium)")

FORM = """<!doctype html><title>Fake form</title>
<h1>Apply to Acme</h1>
<form id="form" onsubmit="event.preventDefault(); document.body.dataset.submitted = 'yes'">
  <label for="first">First name</label><input id="first" name="first">
  <label>Last name <input id="last" name="last"></label>
  <label for="email">Email</label><input id="email" type="email" placeholder="you@example.com">
  <label for="state">State</label>
  <select id="state"><option value="">Pick one</option><option value="IL">Illinois</option><option value="NY">New York</option></select>
  <label><input type="checkbox" id="agree"> I agree</label>
  <fieldset><legend>Work authorization</legend>
    <label><input type="radio" name="auth" value="yes"> Yes</label>
    <label><input type="radio" name="auth" value="no"> No</label>
  </fieldset>
  <label for="why">Why Acme?</label><textarea id="why"></textarea>
  <label for="resume">Resume</label><input id="resume" type="file">
  <p class="note">Note one</p><p class="note">Note two</p><p class="note" hidden>Hidden note</p>
  <div role="button" tabindex="0" id="fake">Fake button</div>
  <button type="button" id="late" hidden>Appears later</button>
  <button type="submit" data-testid="go">Submit application</button>
  <a id="terms" href="/form" target="_blank">Terms</a>
</form>
<script>
  window.events = [];
  for (const id of ["first", "last", "email", "why"]) document.getElementById(id).addEventListener("input", (e) => events.push(id + ":" + e.target.value));
  document.getElementById("state").addEventListener("change", (e) => events.push("state:" + e.target.value));
  document.getElementById("resume").addEventListener("change", async (e) => {
    const f = e.target.files[0]; const bytes = new Uint8Array(await f.arrayBuffer());
    window.picked = {name: f.name, size: f.size, type: f.type, last: bytes[bytes.length - 1]};
  });
  document.getElementById("fake").addEventListener("click", (e) => { window.fakeClicked = e.isTrusted; });
  setTimeout(() => { document.getElementById("late").hidden = false; }, 1500);
  document.getElementById("late").addEventListener("click", () => { window.lateClicked = true; });
</script>"""

# Queries whose matches PortPage and Playwright must agree on.
QUERIES = [
    ("locator", ("input",), {}), ("locator", ("p.note",), {}), ("get_by_role", ("button",), {}),
    ("get_by_role", ("button",), {"name": "Submit application"}), ("get_by_role", ("textbox",), {}),
    ("get_by_role", ("radio",), {"name": "Yes"}), ("get_by_role", ("checkbox",), {"name": "I agree"}),
    ("get_by_role", ("combobox",), {"name": "State"}), ("get_by_role", ("group",), {"name": "Work authorization"}),
    ("get_by_text", ("Note",), {}), ("get_by_text", ("Note one",), {"exact": True}), ("get_by_label", ("Last name",), {}),
    ("get_by_label", ("Email",), {}), ("get_by_placeholder", ("you@example.com",), {}), ("get_by_test_id", ("go",), {}),
    ("get_by_role", ("heading",), {"level": 1}),
]


@pytest.fixture(scope="module")
def site():
    class Pages(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write((FORM if self.path.startswith("/form") else "<title>Other</title><p>other").encode())

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture(scope="module")
def worker():
    folder = Path(tempfile.mkdtemp(prefix="apw-profiles-", dir="/tmp"))
    workers = PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"))  # its own socket: the demo test has one too
    yield workers.launch(0)
    workers.stop_all()


@pytest.fixture
def page(worker, site) -> PortPage:
    page = PortPage.first(worker.connection)
    page.goto(f"{site}/form")
    return page


def test_locators_match_what_playwrights_match(page, site):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            theirs = browser.new_page()
            theirs.goto(f"{site}/form")
            for method, args, options in QUERIES:
                ours = getattr(page, method)(*args, **options).count()
                assert ours == getattr(theirs, method)(*args, **options).count(), (method, args, options)
            assert page.locator("p.note").filter(has_text="two").count() == theirs.locator("p.note").filter(has_text="two").count()
            assert page.locator("form").get_by_role("button").nth(1).inner_text() == \
                theirs.locator("form").get_by_role("button").nth(1).inner_text()
        finally:
            browser.close()


def test_fill_type_check_and_select_reach_the_page(page):
    page.get_by_label("First name").fill("Testy")
    page.fill("#last", "McTestface")
    page.locator("#email").type("t@example.com")
    page.get_by_role("checkbox", name="I agree").check()
    page.get_by_role("radio", name="No").check()
    assert page.select_option("#state", "New York") == ["NY"]
    page.locator("#why").fill("Line one")
    page.locator("#why").press("Enter")

    assert page.input_value("#first") == "Testy" and page.locator("#last").input_value() == "McTestface"
    assert page.locator("#email").input_value() == "t@example.com"
    assert page.is_checked("#agree") and page.get_by_role("radio", name="No").is_checked()
    assert page.locator("#state").input_value() == "NY"
    events = page.evaluate("() => events")
    assert "first:Testy" in events and "state:NY" in events and "email:t@example.com" in events
    assert page.locator("#why").input_value() == "Line one\n"
    page.get_by_role("checkbox", name="I agree").uncheck()
    assert not page.locator("#agree").is_checked()


def test_reads_and_visibility(page):
    assert page.title() == "Fake form" and page.url.endswith("/form")
    assert page.locator("p.note").all_inner_texts() == ["Note one", "Note two", "Hidden note"]  # as Playwright's
    assert page.locator("p.note").first.is_visible() and page.locator("p.note").last.is_hidden()
    assert [n.inner_text() for n in page.locator("p.note").all()][:2] == ["Note one", "Note two"]
    assert page.get_by_test_id("go").get_attribute("type") == "submit"
    with pytest.raises(PlaywrightError, match="strict mode violation"):
        page.locator("p.note").is_visible()


def test_click_waits_for_its_element_and_times_out_like_playwright(page):
    page.locator("#late").click(timeout=5000)
    assert page.evaluate("() => window.lateClicked") is True
    page.get_by_role("button", name="Fake button").click()
    assert page.evaluate("() => window.fakeClicked") is False  # synthetic, as any extension's
    page.reload()
    with pytest.raises(PortTimeoutError, match="Timeout 300ms exceeded"):
        page.locator("#nothing-here").click(timeout=300)


def test_a_file_bigger_than_one_message_reaches_the_input(page, tmp_path):
    resume = tmp_path / "Test_Resume.pdf"
    resume.write_bytes(b"%PDF-1.4\n" + bytes(range(256)) * 6000 + b"\x2a")  # about 1.5 MB: several chunks
    page.set_input_files("#resume", resume)
    page.wait_for_function("() => window.picked")
    picked = page.evaluate("() => window.picked")
    assert picked == {"name": "Test_Resume.pdf", "size": resume.stat().st_size, "type": "application/pdf", "last": 42}


def test_evaluate_takes_an_argument_and_awaits(page):
    assert page.evaluate("([a, b]) => a + b", [2, 3]) == 5
    assert page.evaluate("async () => { await new Promise(r => setTimeout(r, 50)); return 'later'; }") == "later"
    assert page.evaluate("document.title") == "Fake form"
    assert page.evaluate("() => undefined") is None
    assert page.locator("#first").evaluate("(e, suffix) => e.id + suffix", "!") == "first!"
    assert page.eval_on_selector_all("p.note", "(notes) => notes.length") == 3
    with pytest.raises(PlaywrightError, match="boom"):
        page.evaluate("() => { throw new Error('boom'); }")


def test_keyboard_enter_submits_the_form(page):
    page.locator("#first").focus()
    page.keyboard.press("Enter")
    assert page.evaluate("() => document.body.dataset.submitted") == "yes"


def test_the_caret_keys_move_the_caret_as_a_keyboard_does(page):
    page.locator("#first").focus()
    page.keyboard.type("BC")
    page.keyboard.press("ArrowLeft")
    page.keyboard.type("x")
    page.keyboard.press("Home")
    page.keyboard.type("A")
    page.keyboard.press("End")
    page.keyboard.press("Shift+ArrowLeft")
    page.keyboard.type("D")
    assert page.input_value("#first") == "ABxD"


def test_screenshot_is_a_png(page, tmp_path):
    data = page.screenshot(path=tmp_path / "shot.png")
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and (tmp_path / "shot.png").read_bytes() == data


def test_navigation_and_popups(page, site):
    page.goto(f"{site}/other")
    assert page.title() == "Other"
    page.go_back()
    assert page.title() == "Fake form"
    popups = []
    page.on("popup", popups.append)
    page.goto(f"{site}/form")
    # A synthetic click on a target=_blank link opens its tab; window.open from a synthetic click
    # is blocked by Chrome's pop-up blocker (no user activation), so pages that open one that way can't.
    page.locator("#terms").click()
    for _ in range(50):
        if popups:
            break
        page.wait_for_timeout(100)
    assert popups and isinstance(popups[0], PortPage)
    popups[0].wait_for_load_state()
    assert popups[0].title() == "Fake form"
    popups[0].close()
    assert popups[0].is_closed()


def test_the_engine_reads_and_fills_a_saved_form_through_the_port(page):
    with demo.replay(demo.SAVED_FORMS / "lever-immuta") as (url, _real):
        page.goto(url)
        questions = fill_engine.parse_questions("lever", page.evaluate("() => document.documentElement.outerHTML"))
        named = {q.label: q for q in questions}
        answers = {named["Full name"].name: "Testy McTestface", named["Email"].name: "testy@example.com"}
        readback = fill_engine.fill(page, "lever", questions, answers)
        assert readback[named["Full name"].name] == "Testy McTestface"
        assert page.get_by_label("Email").first.input_value() == "testy@example.com" or \
            readback[named["Email"].name] == "testy@example.com"


def test_the_fill_demo_fills_test_person_and_sends_nothing(monkeypatch):
    monkeypatch.setenv("APPLY_PROFILES", tempfile.mkdtemp(prefix="apw-profiles-", dir="/tmp"))
    lines = demo.fill("lever-immuta", "testing")
    assert "0 read-back problems" in lines[0] and "Nothing was sent" in lines[0]
    assert any("Resume/CV: 'Test_Person_Resume.pdf'" in line for line in lines)
