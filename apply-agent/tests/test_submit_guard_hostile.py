"""The submit guard's shared hostile pages (KAN-666): every click path against every page built to trick it.

Each page is a fake job form whose application request is a POST to FINAL (or a known job system's final URL).
Each click path is the real code that presses a button through the guards: plain code's Next (press_step), the
profile pop-up's click, the account page's click, Ask Claude's press, and Fill again (a held page filled anew in a
fresh guarded page). Every pair must leave the job system with no application request. The control tests show
each page does send without the guard, so a pass means the guard stopped it.

A new click path joins PATHS, and a new trick joins PAGES, in the same PR (the root CLAUDE.md's review rule).
Fill again's case (KAN-682) opens its page in a real Worker browser. Three groups:
- no browser (CI's fast list): the rules each path reads before it presses;
- CDP: Playwright's Chromium, skipped where it isn't installed;
- plain: a plain Worker on Chrome for Testing, skipped where there is none (CI).
"""

import http.server
import sys
import threading
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest

from apply import ask, claude_fill, send_click, submit_guard
from apply.account_pages import AccountPages, _Click
from apply.adapters import Drive
from apply.claude_fill import ClaudeFill, press_step
from apply.model import Handoff, Posting
from apply.plain import guards as plain_guards
from apply.submit_guard import ROUTED, DriveGuard, guard, lift

HOST = "https://jobs.example.com"
FINAL = "/acme/jobs/123/apply"  # final by its name alone: a path ending in /apply
GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/5442881008"  # a known final URL
START = "/acme/jobs/123/start"
FORM = "/acme/jobs/123/form"

# What a page's script uses to send the application every way it can, once called.
SEND_ALL = """<script>
window.sendAll = () => {
  const body = 'first=Test';
  try { fetch('%(final)s', {method: 'POST', body}).catch(() => {}); } catch (e) {}
  try { const x = new XMLHttpRequest(); x.open('POST', '%(final)s'); x.send(body); } catch (e) {}
  try { navigator.sendBeacon('%(final)s', body); } catch (e) {}
  try { fetch('%(gh)s', {method: 'POST', body}).catch(() => {}); } catch (e) {}
};
</script>""" % {"final": FINAL, "gh": GREENHOUSE}

PAGES = {
    # The last step's button says only Next; it posts the form to the final URL, and its script sends too.
    "a Submit named Next": {START: f"""<title>Apply</title><form id=app method=post action="{FINAL}">
        <label>First name <input name=first value=Test></label><button id=b>Next</button></form>{SEND_ALL}
        <script>document.getElementById('b').addEventListener('click', () => sendAll());</script>"""},
    # Titled as a profile step, but it asks for the resume: it is the application.
    "a profile pop-up that is the application": {START: f"""<title>Jobs</title>
        <div role=dialog aria-modal=true aria-label="Create your profile"><form method=post action="{FINAL}">
        <label>First name <input name=first value=Test></label><label>Resume <input type=file name=resume></label>
        <button id=b>Submit</button></form></div>{SEND_ALL}
        <script>document.getElementById('b').addEventListener('click', () => sendAll());</script>"""},
    # Its fields grow into the application only after the profile check read it.
    "a profile pop-up that turns into the application": {START: f"""<title>Jobs</title>
        <div role=dialog aria-modal=true aria-label="Complete your profile"><form id=f method=post action="{FINAL}">
        <label>First name <input name=first value=Test></label><button id=b>Submit</button></form></div>{SEND_ALL}
        <script>const b = document.getElementById('b');
        b.addEventListener('pointerdown', () => document.getElementById('f').insertAdjacentHTML('beforeend',
          '<div><textarea name=why>Why us?</textarea></div>'), true);
        b.addEventListener('click', () => sendAll());</script>"""},
    # The whole application is one page in a modal, behind a Continue.
    "a one-page form in a modal": {START: f"""<title>Software Intern</title>
        <div role=dialog aria-modal=true><h2>Apply for Software Intern</h2><form method=post action="{FINAL}">
        <label>First name <input name=first value=Test></label><label>Email <input name=email value=t@example.com></label>
        <button id=b>Continue</button></form></div>{SEND_ALL}
        <script>document.getElementById('b').addEventListener('click', () => sendAll());</script>"""},
    # One page that makes an account as it applies: a password box, and a Continue that posts the application.
    "an application that makes an account": {START: f"""<title>Apply</title><form method=post action="{FINAL}">
        <label>Email <input name=email value=t@example.com></label><label>Password <input type=password name=pw value=x></label>
        <label>First name <input name=first value=Test></label><button id=b>Continue</button></form>"""},
    # A step's Next leads to a page whose one field sends the form on Enter, with no button at all.
    "Enter on a page loaded during the drive": {
        START: """<title>One</title><form method=post action="/acme/jobs/123/step2"><input name=first value=Test>
            <button id=b>Next</button></form>""",
        "/acme/jobs/123/step2": f"""<title>Two</title><form method=post action="{FINAL}"><input id=last name=last value=P></form>
            <form id=gh method=post action="{GREENHOUSE}"><input id=last2 name=last value=P></form>"""},
    # A Next whose own handler posts to the final URL by script (fetch, XHR, beacon).
    "a final-URL POST from a Next": {START: f"""<title>Step</title><form method=post action="/acme/jobs/123/step2">
        <input name=first value=Test><button id=b type=button>Next</button></form>{SEND_ALL}
        <script>document.getElementById('b').addEventListener('click', () => sendAll());</script>""",
        "/acme/jobs/123/step2": "<title>Two</title><input name=next>"},
    # The button reads Continue when it is checked, and Submit application when it is clicked.
    "a button whose words change after the check": {START: f"""<title>Apply</title>
        <form id=f method=post action="{FINAL}"><input name=first value=Test><button id=b>Continue</button></form>{SEND_ALL}
        <script>const b = document.getElementById('b');
        b.addEventListener('pointerdown', () => {{ b.textContent = 'Submit application'; }}, true);
        b.addEventListener('click', () => sendAll());</script>"""},
    # A click schedules the application by script, after the click's flags are gone.
    "a form sent by script after a delay": {START: f"""<title>Apply</title>
        <form id=f method=post action="{FINAL}"><input name=first value=Test><button id=b type=button>Next</button></form>
        {SEND_ALL}<script>document.getElementById('b').addEventListener('click', () => {{
          for (const ms of [50, 600, 2500]) setTimeout(() => {{
            sendAll();
            try {{ document.getElementById('f').requestSubmit(); }} catch (e) {{}}
            try {{ document.getElementById('f').submit(); }} catch (e) {{}}
          }}, ms);
        }});</script>"""},
    # A step list's link (TAL.net's Progress Tracker posts the page, KAN-692) whose script posts the application.
    "a step list's link that sends": {START: f"""<title>Apply</title><nav><ul><li><a id=b role=button href="#">Next</a></li>
        </ul></nav><form id=f method=post action="{FINAL}"><input name=first value=Test></form>{SEND_ALL}
        <script>document.getElementById('b').addEventListener('click', (e) => {{ e.preventDefault(); sendAll();
          document.getElementById('f').submit(); }});</script>"""},
    # A review page's Apply (KAN-725 lets a posting's Apply that only opens the form through): its answers ride
    # in hidden fields beside a token, in a fresh tab with no field shown.
    "a review page's Apply with its answers hidden": {START: f"""<title>Review</title><form method=post action="{FINAL}">
        <input type=hidden name=__vxXSRF_Token value=t><input type=hidden name=first value=Test>
        <input type=submit id=b value=Apply></form>"""},
}
BUTTON = {"a review page's Apply with its answers hidden": "Apply", "a profile pop-up that is the application": "Submit", "a profile pop-up that turns into the application": "Submit",
          "a one-page form in a modal": "Continue", "an application that makes an account": "Continue",
          "a button whose words change after the check": "Continue"}


def button(page_name: str) -> str:
    return BUTTON.get(page_name, "Next")


class Site:
    """The fake job system: each page by path, and every request that isn't a GET."""

    def __init__(self, pages: dict[str, str]):
        self.pages, self.sent = pages, []

    def handle(self, route) -> None:
        request = route.request
        path = request.url.split("example.com", 1)[-1].split("?")[0] if "example.com" in request.url else request.url
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            self.sent.append(path)
        body = self.pages.get(path, "<title>Thanks</title><p>Thank you for applying</p>")
        route.fulfill(body=body, content_type="text/html")

    def applications(self) -> list[str]:
        """The application requests that reached the job system."""
        return [p for p in self.sent if p in (FINAL, GREENHOUSE)]


# --- the click paths, each the real code that presses through the guards

def plain_next(page, drive, name):
    press_step(page, drive, name)


def profile_click(page, drive, name):
    filler = ClaudeFill(claude=None)
    filler._guard = drive
    found = claude_fill._profile_step(page, name)
    if found is None:
        raise Handoff("no profile step")
    filler._through_profile_step(page, found, name)


def account_click(page, drive, name):
    AccountPages(None, {})._click(page, name, "example.com", drive, _Click("sign in", "example.com", None))


def ask_press(page, drive, name):
    turns = iter([{"press": name}, {"reply": "Done."}])

    def act(**given):
        said = {"blocked": False, "why": "", "press": "", "reply": "", "changed": [], "couldnt": [], "waiting": [],
                "ticked": [], "remember": [], "apply_bug": []}
        return Drive(said | next(turns), 1, 10)

    ask.ask(SimpleNamespace(drive=act), page, "go on", [], ask.Form(Posting(id="1", company="A", title="B", url=HOST)),
            "", guard=drive)


def ask_press_listed(page, drive, name):
    """Ask Claude's press of a step in the form's list of steps (KAN-692): the name Claude gives, as ask.ask presses it."""
    press_step(page, drive, name, listed=True)


PATHS = {"plain code's Next": plain_next, "the profile click": profile_click, "the account click": account_click,
         "Ask Claude's press": ask_press, "Ask Claude's press of a listed step": ask_press_listed}


def _settle(page, ms=3000) -> None:
    try:
        page.wait_for_timeout(ms)
    except Exception:
        pass  # the page went on to another document


def _then(page, page_name) -> None:
    """What the page does after the path's press: Enter in the next page's field, by a trusted key."""
    if page_name == "Enter on a page loaded during the drive":
        for field in ("#last", "#last2"):
            try:
                page.wait_for_selector(field, timeout=3000)
                page.focus(field)
                page.keyboard.press("Enter")
            except Exception:
                pass


# --- no browser: what each path reads before it presses

@pytest.mark.parametrize("name", ["Submit application", "Send", "Finish", "Complete application", "Review and Submit"])
def test_claudes_own_click_on_a_button_that_sends_is_refused_by_the_hook(name):
    said = send_click.refusal({"tool_name": "mcp__playwright__browser_click", "tool_input": {"element": f"{name} button", "ref": "e1"}})
    assert "only Apply clicks it" in said["hookSpecificOutput"]["permissionDecisionReason"]


@pytest.mark.parametrize("url", [HOST + FINAL, GREENHOUSE, HOST + "/acme/job/1/submitApplication",
                                 "https://jobs.lever.co/acme/b9b21075-74a4-4b64-8f1b-f0be1fb0b24d/apply"])
def test_every_final_url_here_is_in_the_plain_rules(url):
    assert plain_guards.PATTERN.search(url)


def test_a_cdp_worker_routes_the_final_url_by_its_submit_name():
    assert ROUTED.match(HOST + "/acme/job/1/submitApplication")


def test_a_link_sent_in_never_joins_a_cdp_worker():
    from apply import rehearsal
    assert "isn't a running plain Worker" in Path(rehearsal.__file__).read_text()


# --- CDP: Playwright's Chromium, the rehearsal's guard and the drive guard on the page

@contextmanager
def cdp(pages: dict[str, str], guarded: bool = True):
    from playwright.sync_api import sync_playwright

    site = Site(pages)
    with sync_playwright() as playwright:
        if not Path(playwright.chromium.executable_path).exists():
            pytest.skip("no Playwright Chromium here")
        browser = playwright.chromium.launch()
        context = browser.new_context()
        context.route(lambda url: True, site.handle)  # every request: no real site is ever reached
        page = context.new_page()
        page.goto(HOST + START)
        drive = None
        if guarded:
            guard(page)
            drive = DriveGuard(page)
        try:
            yield page, drive, site
        finally:
            browser.close()


@pytest.fixture(autouse=True)
def quick_steps(monkeypatch):
    monkeypatch.setattr(claude_fill, "STEP_SHOWS_MS", 1500)


@pytest.mark.parametrize("path", list(PATHS))
@pytest.mark.parametrize("page_name", list(PAGES))
def test_no_click_path_sends_a_hostile_page_on_cdp(page_name, path):
    with cdp(PAGES[page_name]) as (page, drive, site):
        try:
            PATHS[path](page, drive, button(page_name))
        except Handoff:
            pass  # the path refused: nothing pressed
        _then(page, page_name)
        _settle(page)
    assert site.applications() == []


@pytest.mark.parametrize("page_name", list(PAGES))
def test_without_the_guard_each_hostile_page_sends(page_name):
    """The control: a plain click on the same button, unguarded, sends the application."""
    with cdp(PAGES[page_name], guarded=False) as (page, _, site):
        page.get_by_role("button", name=button(page_name)).click()
        _then(page, page_name)
        _settle(page)
    assert site.applications()


# Ask Claude's press of a listed step (KAN-692) against a TAL.net-like form, whose final Submit posts to the same
# save_page as each step's save: only the body (submit=1) tells them apart. The adversarial review's pages: none
# may send the form's own button.
SAVE = "/acme/jobs/123/save_page"
_FORM = f'<form id=f method=post action="{SAVE}"><input name=first value=Test>'
LISTED_SENDS = {
    "a Submit in another language": (f"<title>Declaration</title>{_FORM}<ul class=actions><li>"
                                     "<button name=submit value=1>Envoyer ma candidature</button></li></ul></form>",
                                     "Envoyer ma candidature"),
    "a Submit named Done": (f"<title>Declaration</title>{_FORM}<ul><li><button name=submit value=1>Done</button></li>"
                            "<li><button name=save value=1>Save</button></li></ul></form>", "Done"),
    "a tracker button beside the Submit": (f"<title>Declaration</title>{_FORM}<nav><ul><li><button name=goto value=2>"
                                           "Inclusion</button></li><li><a href='#'>Help</a></li></ul></nav>"
                                           "<button name=submit value=1>Submit</button></form>", "Inclusion"),
    "a label only CSS shows": ("<style>#b::before{content:'Submit application'}</style><span id=l hidden>Declaration</span>"
                               f"{_FORM}<ul><li><button id=b aria-labelledby=l name=submit value=1></button></li>"
                               "<li><a href='#'>Help</a></li></ul></form>", "Declaration"),
    "a name that starts as a step's": (f"{_FORM}<ul><li><button name=submit value=1>Declaration and lodge</button></li>"
                                       "<li><a href='#'>Help</a></li></ul></form>", "Declaration"),
    "a form in a list": (f"<ol><li>{_FORM}<button name=submit value=1>Save my application</button></form></li>"
                         "<li><a href='#'>Help</a></li></ol>", "Save my application"),
    "a link around a Submit": (f"{_FORM}<nav><ul><li><a href='#o'>Languages</a></li><li><a href='#'>"
                               "<button name=submit value=1>Inclusion</button></a></li></ul></nav></form>", "Inclusion"),
    "a link around a Submit's label": (f"{_FORM}<button id=s name=submit value=1 style='position:absolute;left:-9999px'>Go"
                                       "</button></form><nav><ul><li><a href='#o'>Languages</a></li><li><a href='#'>"
                                       "<label for=s>Inclusion</label></a></li></ul></nav>", "Inclusion"),
    "a link holding a frame's Submit": ("<nav><ul><li><a href='#o'>Languages</a></li><li><a href='#' aria-label='Inclusion'>"
                                        "<iframe style='border:0' srcdoc=\"<form method=post action='/acme/jobs/123/save_page' "
                                        "target=_top style='margin:0'><input type=hidden name=first value=Test><button name=submit "
                                        "value=1 style='width:300px;height:150px'>Inclusion</button></form>\"></iframe></a></li></ul></nav>",
                                        "Inclusion"),
    "a link in an aria-labelled Submit": (f"<nav><ul><li><a href='#' id=b aria-label='Submit application'>Inclusion</a></li>"
                                          f"<li><a href='#'>Help</a></li></ul></nav>{_FORM}</form><script>document.getElementById('b')"
                                          ".addEventListener('click', () => { const i = document.createElement('input'); i.name = 'submit';"
                                          " i.value = '1'; document.getElementById('f').append(i); document.getElementById('f').submit(); });"
                                          "</script>", "Inclusion"),
    # TAL.net names its tracker links by a heading and the step (KAN-729): a Submit named so is still no step.
    "a Submit named as a headed step": (f"{_FORM}<nav><ul><li><button name=submit value=1 aria-label='Section Header: Declaration'>"
                                        "Declaration</button></li><li><a href='#'>Help</a></li></ul></nav></form>", "Declaration"),
    "a headed step whose own name sends": ("<nav><ul><li><a href='#' id=b aria-label='Section Header: Inclusion and submit "
                                           f"application'>Inclusion</a></li><li><a href='#'>Help</a></li></ul></nav>{_FORM}</form>"
                                           "<script>document.getElementById('b').addEventListener('click', () => { const i = "
                                           "document.createElement('input'); i.name = 'submit'; i.value = '1'; "
                                           "document.getElementById('f').append(i); document.getElementById('f').submit(); });"
                                           "</script>", "Inclusion"),
}


@pytest.mark.parametrize("page_name", list(LISTED_SENDS))
def test_ask_claudes_listed_press_never_sends_a_tal_like_form(page_name):
    html, name = LISTED_SENDS[page_name]
    bodies = []
    with cdp({START: html}) as (page, drive, _):
        page.on("request", lambda r: r.method == "POST" and bodies.append(r.post_data or ""))
        try:
            ask_press_listed(page, drive, name)
        except Handoff:
            pass
        _settle(page, 1500)
    assert [b for b in bodies if "submit=1" in b] == []


HELD = {START: f"""<title>Apply</title><form id=f method=post action="{FINAL}"><input name=first value=Test>
    <button id=b>Submit application</button></form>{SEND_ALL}
    <script>document.getElementById('b').addEventListener('click', () => sendAll());
    setTimeout(() => {{ sendAll(); try {{ document.getElementById('f').submit(); }} catch (e) {{}} }}, 1500);</script>"""}


def test_a_held_submit_stays_held_through_a_reload_and_a_script_that_sends_after_it():
    with cdp(HELD) as (page, _, site):
        lift(page, held="The legal name is wrong.")
        page.reload()
        page.get_by_role("button", name="Submit application").click()  # Lisul's own click, held
        _settle(page)
    assert site.applications() == []


@pytest.mark.parametrize("path", list(PATHS))
def test_no_click_path_sends_a_held_page_after_a_reload(path):
    with cdp(HELD) as (page, drive, site):
        lift(page, held="The legal name is wrong.")
        page.reload()
        submit_guard.rearm(page)  # Apply drives the page again (Resume, an Ask message)
        try:
            PATHS[path](page, drive, "Submit application")
        except Handoff:
            pass
        _settle(page)
    assert site.applications() == []


# --- Fill again: the held page closes, and the form opens anew in a fresh Worker browser under the guard

LOADS_AND_SENDS = f"""<!doctype html><title>Apply</title><form id=f method=post action="{FINAL}"><input name=first value=Test>
<button type=button>Fill again</button></form>{SEND_ALL}<script>addEventListener('load', () => {{ sendAll(); document.getElementById('f').submit(); }});</script>"""


@contextmanager
def local_site(html: str):
    """The page on 127.0.0.1, for a real Worker browser that Playwright can't route before its first load."""
    sent = []

    class Pages(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            sent.append(self.path)
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            body = b"<title>Thanks</title>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_port}{START}", sent
    finally:
        server.shutdown()
        server.server_close()


def test_fill_again_opens_the_form_guarded_before_its_first_load(tmp_path):
    from playwright.sync_api import sync_playwright

    from apply.browsers import WorkerBrowsers
    from apply.rehearsal import _Kept

    with sync_playwright() as playwright:
        if not Path(playwright.chromium.executable_path).exists():
            pytest.skip("no Playwright Chromium here")
    class Bundled(WorkerBrowsers):  # Playwright's Chromium, headless; Linux CI runs it without Chrome's sandbox
        def launch_options(self, worker):
            return super().launch_options(worker) | {"chromium_sandbox": sys.platform == "darwin"}

    kept = _Kept(Bundled(tmp_path / "profiles", headless=True, channel=None), 0)
    again = []
    with local_site(LOADS_AND_SENDS) as (url, sent):
        try:
            with kept.open(url) as page:
                page.wait_for_timeout(800)
                lift(page, again=lambda: again.append(True))  # held for Lisul, as hold()'s hand_over does
                kept._lifted = kept._bound = True
                page.locator("#apply-rehearsal-blocked button", has_text="Fill again").click()
                page.wait_for_timeout(300)
            assert again == [True]
            with kept.open(url) as page:  # Fill again: a fresh, guarded page
                page.wait_for_timeout(1500)
        finally:
            kept.close()
        assert [p for p in sent if p.endswith("/apply") or "submit" in p] == []


# --- plain: a plain Worker on Chrome for Testing (no CDP), the same pages and paths

def _plain_or_skip():
    from plain_fakes import have_chrome_for_testing
    if not have_chrome_for_testing():
        pytest.skip("needs Chrome for Testing (uv run playwright install chromium)")


@contextmanager
def plain(pages: dict[str, str]):
    _plain_or_skip()
    from plain_fakes import fake_page

    site = Site(pages)
    with fake_page(site.handle, url=HOST + START) as page:
        guard(page)
        yield page, DriveGuard(page), site


@pytest.mark.parametrize("path", ["plain code's Next", "the profile click", "the account click",
                                  "Ask Claude's press of a listed step"])
@pytest.mark.parametrize("page_name", list(PAGES))
def test_no_click_path_sends_a_hostile_page_on_a_plain_worker(page_name, path):
    with plain(PAGES[page_name]) as (page, drive, site):
        try:
            PATHS[path](page, drive, button(page_name))
        except Handoff:
            pass
        _then(page, page_name)
        _settle(page)
    assert site.applications() == []


def test_a_second_form_sent_in_with_into_is_guarded_beside_a_held_one():
    """`apply rehearse --into`: a new tab in the same plain Worker, while the first form is held (lifted) for Lisul."""
    _plain_or_skip()
    from plain_fakes import fake_page

    site = Site(PAGES["a Submit named Next"])
    with fake_page(site.handle, url=HOST + START) as first:
        guard(first)
        lift(first)  # held for Lisul: his own Submit goes through there
        second = first.context.new_page()
        with submit_guard.guarding_on_open():
            submit_guard.on_open(second)
        second.goto(HOST + START)
        guard(second)
        drive = DriveGuard(second)
        try:
            press_step(second, drive, "Next")
        except Handoff:
            pass
        _settle(second)
    assert site.applications() == []
