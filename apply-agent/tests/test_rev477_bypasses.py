"""PR 477 (KAN-710) adversarial review's repros. Every test states the guard's contract (no application request
leaves), so a FAILURE is a confirmed bypass. Run one with -k; never the whole suite.

"press" pages are pressed by the real click paths; "click" pages by a trusted click with nothing armed (what Claude
fill's Playwright click is); "load" pages by no click at all."""

import pytest
from test_submit_guard_hostile import (
    FINAL,
    GREENHOUSE,
    HOST,
    PATHS,
    SAVE,
    START,
    _settle,
    cdp,
    plain,
)

from apply import claude_fill
from apply.model import Handoff

STEP2 = "/acme/jobs/123/step2"
STEP = "<title>Two</title><input name=next>"
NEXT_FORM = f'<form id=app method=post action="{STEP2}"><input name=first value=Test><button id=b>Next</button></form>'
SUBMIT_FORM = (f'<form id=app method=post action="{SAVE}"><input name=first value=Test>'
               '<button id=s name=submit value=1>Submit application</button></form>')
ON_NEXT = "<script>document.getElementById('b').addEventListener('click', () => {%s});</script>"
NEXT_BTN = "<button id=b type=button>Next</button>"

# name -> pages. Every one is pressed through plain code's Next and the account click.
PRESS = {
    # --- the press's own rules (submit_guard.py as this PR changes it)
    "inner frame arms itself": f"""<title>Apply</title><form method=post action="{STEP2}"><input name=first value=Test>
        <button id=b style="width:320px;height:140px;padding:0">Next<iframe style="border:0;width:300px;height:120px"
        srcdoc="<script>window.__applyAccountClick = true</script><form method=post action='{SAVE}' target=_top style='margin:0'>
        <input type=hidden name=submit value=1><button style='width:300px;height:120px'>Next</button></form>"></iframe></button></form>""",
    "sandboxed frame inside the Next (no guard runs there)": f"""<title>Apply</title><form method=post action="{STEP2}"><input name=first value=Test>
        <button id=b style="width:320px;height:140px;padding:0">Next<iframe sandbox="allow-forms allow-top-navigation" style="border:0;width:300px;height:120px"
        srcdoc="<form method=post action='{FINAL}' target=_top style='margin:0'>
        <input type=hidden name=first value=Test><button style='width:300px;height:120px'>Next</button></form>"></iframe></button></form>""",
    "another form, posted in the Next's handler": f"""<title>Apply</title><label>First <input name=first></label>{NEXT_BTN}
        <form id=f2 method=post action="{SAVE}"><input type=hidden name=submit value=1></form>"""
        + ON_NEXT % "HTMLFormElement.prototype.submit.call(document.getElementById('f2'));",
    "the Submit renamed in the Next's handler": f"""<title>Apply</title>{SUBMIT_FORM}{NEXT_BTN}"""
        + ON_NEXT % "const s = document.getElementById('s'); s.textContent = 'Go'; document.getElementById('app').requestSubmit(s);",
    "the Submit removed in the Next's handler": f"""<title>Apply</title>{SUBMIT_FORM}{NEXT_BTN}"""
        + ON_NEXT % """const f = document.getElementById('app'); document.getElementById('s').remove();
          f.insertAdjacentHTML('beforeend', '<input type=hidden name=submit value=1>'); HTMLFormElement.prototype.submit.call(f);""",
    "the action changed by the form's own submit handler": f"""<title>Apply</title>{NEXT_FORM}
        <script>document.getElementById('app').addEventListener('submit', (e) => {{ e.target.setAttribute('action', '{FINAL}'); }});</script>""",
    "submit=1 added by the formdata event": f"""<title>Apply</title><form id=app method=post action="{SAVE}"><input name=first value=Test><button id=b>Next</button></form>
        <script>document.getElementById('app').addEventListener('formdata', (e) => e.formData.append('submit', '1'));</script>""",
    "step 1 of 2, unseen": f"""<title>Apply</title><p style="font-size:0">Step 1 of 2</p>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Next</button></form>""",
    "a step list, unseen": f"""<title>Apply</title><ul style="height:0;overflow:hidden"><li aria-current=step>a</li><li>b</li></ul>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Next</button></form>""",
    # --- what the press's rule reads
    "base: final URL behind a query": f"""<title>Apply</title><base href="{HOST}{FINAL}">
        <form method=post action="?a=1"><input name=first value=Test><button id=b>Next</button></form>""",
    "base: Greenhouse behind a query": f"""<title>Apply</title><base href="{GREENHOUSE}/x">
        <form method=post action="../5442881008"><input name=first value=Test><button id=b>Next</button></form>""",
    "getAttribute polluted": f"""<title>Apply</title><script>const was = Element.prototype.getAttribute;
        Element.prototype.getAttribute = function (n) {{ return n === 'action' ? '{STEP2}' : was.call(this, n); }};</script>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Next</button></form>""",
    "regex polluted": f"""<title>Apply</title><script>RegExp.prototype.test = () => false;</script>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Next</button></form>""",
    "eventPhase polluted: a timer posts while armed": f"""<title>Apply</title><label>First <input name=first></label>{NEXT_BTN}
        <form id=f2 method=post action="{SAVE}"><input type=hidden name=submit value=1></form>
        <script>Object.defineProperty(Event.prototype, 'eventPhase', {{get: () => 1}});
        setInterval(() => HTMLFormElement.prototype.submit.call(document.getElementById('f2')), 100);</script>""",
    # --- the words of a form's button (formSends)
    "a Submit no words read: input with no value": f"""<title>Apply</title><form id=app method=post action="{SAVE}"><input name=first value=Test>
        <input type=hidden name=submit value=1><input id=s type=submit style="position:absolute;left:0"></form>{NEXT_BTN}"""
        + ON_NEXT % "document.getElementById('s').click();",
    "a Submit no words read: icon with a title": f"""<title>Apply</title><form id=app method=post action="{SAVE}"><input name=first value=Test>
        <button id=s name=submit value=1 title="Submit application"><img alt="Submit application" src="data:,"></button></form>{NEXT_BTN}"""
        + ON_NEXT % "document.getElementById('s').click();",
    "a Submit no words read: role=button": f"""<title>Apply</title><form id=app method=post action="{SAVE}"><input name=first value=Test>
        <input type=hidden name=submit value=1><div role=button id=s>Submit application</div></form>{NEXT_BTN}"""
        + ON_NEXT % "HTMLFormElement.prototype.submit.call(document.getElementById('app'));",
    "a form in a shadow root": f"""<title>Apply</title><div><template shadowrootmode=open>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Next</button></form></template></div>""",
    # Added at pointerdown: on the page from the start it breaks Playwright's own actionability check, so no click comes.
    "a field named getAttribute, added as the press lands": f"""<title>Apply</title><form id=app method=post action="{FINAL}"><input name=first value=Test>
        <button id=b>Next</button></form><script>document.getElementById('b').addEventListener('pointerdown', () =>
          document.getElementById('app').insertAdjacentHTML('beforeend', '<input type=hidden name=getAttribute value=x>'));</script>""",
    # --- a page's own flags
    "armed by itself: the Next has no element check": f"""<title>Apply</title><script>window.__applyAccountClick = true;
        Object.defineProperty(window, '__applyAccountClick', {{get: () => true, set() {{}}}});</script><label>First <input name=first></label>
        <form id=f2 method=post action="{SAVE}"><input type=hidden name=submit value=1></form>{NEXT_BTN}
        <script>document.getElementById('b').addEventListener('click', () => setTimeout(() =>
          HTMLFormElement.prototype.submit.call(document.getElementById('f2')), 3000));</script>""",
}

# A trusted click with nothing armed: what Claude fill's click on any button is.
CLICK = {
    "CONTROL not armed, a Claude click posts": f"""<title>Apply</title>{SUBMIT_FORM}{NEXT_BTN}"""
        + ON_NEXT % "const s = document.getElementById('s'); s.textContent = 'Go'; document.getElementById('app').requestSubmit(s);",
    "CONTROL a plain Next form to the final URL": f"""<title>Apply</title>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Next</button></form>""",
    "self-armed, a Claude click posts": f"""<title>Apply</title><script>window.__applyAccountClick = true;</script>{SUBMIT_FORM}{NEXT_BTN}"""
        + ON_NEXT % "const s = document.getElementById('s'); s.textContent = 'Go'; document.getElementById('app').requestSubmit(s);",
    "self-lifted": f"""<title>Apply</title><script>window.__applyRehearsalLifted = window.__applyDriveLifted = true;</script>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Next</button></form>""",
    "a form in a shadow root": f"""<title>Apply</title><div><template shadowrootmode=open>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Next</button></form></template></div>""",
    "a Submit in a shadow root": f"""<title>Apply</title><div><template shadowrootmode=open>
        <form method=post action="{FINAL}"><input name=first value=Test><button id=b>Submit application</button></form></template></div>""",
    "a ping in a shadow root": f"""<title>Apply</title><div><template shadowrootmode=open>
        <a id=b href="{STEP2}" ping="{FINAL}">Next</a></template></div>""",
    "a ping on a detached link": f"""<title>Apply</title>{NEXT_BTN}<script>document.getElementById('b').addEventListener('click', () => {{
        const d = document.createElement('div'); d.innerHTML = '<a href="{STEP2}" ping="{FINAL}">x</a>';
        d.firstChild.click(); }});</script>""",
}

# No click at all.
LOAD = {
    "upload flag set by the page, a file by DataTransfer": f"""<title>Apply</title>{SUBMIT_FORM}<script>
        window.__applyUploadPost = true; const f = document.getElementById('app'), i = document.createElement('input');
        i.type = 'file'; i.name = 'resume'; f.append(i); const d = new DataTransfer(); d.items.add(new File(['x'], 'r.pdf')); i.files = d.files;
        f.insertAdjacentHTML('beforeend', '<input type=hidden name=submit value=1>'); setTimeout(() => f.requestSubmit(), 200);</script>""",
    "relay in a frame, beside a page of fields": f"""<title>Apply</title><label>First <input name=first></label>
        <iframe srcdoc="<form id=f method=post action='{SAVE}' target=_top><input type=hidden name=submit value=1></form>
        <script>setTimeout(() => HTMLFormElement.prototype.submit.call(document.getElementById('f')), 300)</script>"></iframe>""",
    "relay before the fields parse": f"""<title>Apply</title><iframe name=x></iframe><form id=f method=post action="{SAVE}" target=x>
        <input type=hidden name=submit value=1></form><script>HTMLFormElement.prototype.submit.call(document.getElementById('f'));</script>
        <label>First <input name=first></label>""",
    "relay: checkVisibility polluted": f"""<title>Apply</title><label>First <input name=first></label><form id=f method=post action="{SAVE}">
        <input type=hidden name=submit value=1></form><script>Element.prototype.checkVisibility = () => false;
        setTimeout(() => HTMLFormElement.prototype.submit.call(document.getElementById('f')), 200);</script>""",
    "relay through base to the final URL": f"""<title>Apply</title><base href="{HOST}{FINAL}"><form id=f method=post action="?a=1">
        <input type=hidden name=first value=Test></form><script>setTimeout(() => document.getElementById('f').submit(), 200);</script>""",
    "self-lifted": f"""<title>Apply</title><script>window.__applyRehearsalLifted = window.__applyDriveLifted = true;</script>
        <form id=f method=post action="{FINAL}"><input name=first value=Test></form><script>setTimeout(() => document.getElementById('f').submit(), 200);</script>""",
    "sendBeacon from the prototype": f"""<title>Apply</title><script>Navigator.prototype.sendBeacon.call(navigator, '{FINAL}', 'first=Test');</script>""",
    "XHR's note overwritten": f"""<title>Apply</title><script>const x = new XMLHttpRequest(); x.open('POST', '{FINAL}');
        x.__applyRequest = ['GET', '/']; x.send('first=Test');</script>""",
    "fetch of a URL that says another thing second": f"""<title>Apply</title><script>let n = 0; fetch({{toString() {{ return n++ ? '{FINAL}' : '/ok'; }}}}, {{method: 'POST', body: 'x'}}).catch(() => {{}});</script>""",
    "fetch from a new frame's window": f"""<title>Apply</title><script>const i = document.createElement('iframe'); document.documentElement.append(i);
        i.contentWindow.fetch('{FINAL}', {{method: 'POST', body: 'x'}}).catch(() => {{}});</script>""",
    "regex polluted, fetch": f"""<title>Apply</title><script>RegExp.prototype.test = () => false; fetch('{FINAL}', {{method: 'POST', body: 'x'}}).catch(() => {{}});</script>""",
    "base, fetch": f"""<title>Apply</title><base href="{HOST}{FINAL}"><script>fetch('?a=1', {{method: 'POST', body: 'x'}}).catch(() => {{}});</script>""",
}

# On a page at the final URL: a Next whose empty formaction posts to the page's own URL (browser), which the guard
# reads as the form's action.
AT_FINAL = {FINAL: f"""<title>Apply</title><form method=post action="{STEP2}"><input name=first value=Test>
    <button id=b formaction="">Next</button></form>"""}

ALWAYS = {STEP2: STEP}


@pytest.fixture(autouse=True)
def quick_steps(monkeypatch):
    monkeypatch.setattr(claude_fill, "STEP_SHOWS_MS", 1500)


def _press(path, page, drive, name="Next"):
    try:
        PATHS[path](page, drive, name)
    except Handoff:
        pass


@pytest.mark.parametrize("path", ["plain code's Next", "the account click"])
@pytest.mark.parametrize("name", list(PRESS))
def test_press(name, path):
    with cdp({START: PRESS[name]} | ALWAYS) as (page, drive, site):
        _press(path, page, drive)
        _settle(page, 2500 if "armed by itself" not in name else 4000)
    assert site.applications() == []


@pytest.mark.parametrize("name", list(CLICK))
def test_click(name):
    with cdp({START: CLICK[name]} | ALWAYS) as (page, _, site):
        try:
            page.locator("#b").click(timeout=3000)
        except Exception:
            pass
        _settle(page, 1500)
    assert site.applications() == []


@pytest.mark.parametrize("name", list(LOAD))
def test_load(name):
    with cdp({START: LOAD[name]} | ALWAYS, first=True) as (page, _, site):  # guarded before it loads, as a rehearsal
        _settle(page, 1500)
    assert site.applications() == []


def test_empty_formaction_at_the_final_url():
    with cdp({START: "<title>x</title>", **AT_FINAL, **ALWAYS}) as (page, drive, site):
        page.goto(HOST + FINAL)
        _press("plain code's Next", page, drive)
        _settle(page, 2000)
    assert site.applications() == []


# The plain Worker: declarativeNetRequest stops final URLs there, so SAVE with submit=1 is what's left.
PLAIN = {
    "self-lifted": f"""<title>Apply</title><script>window.__applyRehearsalLifted = window.__applyDriveLifted = true;</script>{SUBMIT_FORM}<button id=b type=button>Next</button>
        <script>document.getElementById('b').addEventListener('click', () => document.getElementById('app').requestSubmit(document.getElementById('s')));</script>""",
    "Submit renamed in the Next's handler": PRESS["the Submit renamed in the Next's handler"],
    "formdata adds submit=1": PRESS["submit=1 added by the formdata event"],
    "forged touch and click in a frame, while armed": f"""<title>Apply</title><label>First <input name=first></label>{NEXT_BTN}
        <iframe srcdoc="<form id=f method=post action='{SAVE}' target=_top><input type=hidden name=submit value=1><button id=g>Go</button></form>
        <script>setInterval(() => {{ if (window.__applyAccountClick) {{ dispatchEvent(new Event('__apply_touch')); document.getElementById('g').click(); }} }}, 20)</script>"></iframe>
        <script>document.getElementById('b').addEventListener('click', () => {{}});</script>""",
    "relay in a frame": LOAD["relay in a frame, beside a page of fields"],
    "a form in a shadow root": f"""<title>Apply</title><div><template shadowrootmode=open>
        <form method=post action="{SAVE}"><input type=hidden name=submit value=1><button id=b>Next</button></form></template></div>""",
    "getAttribute clobbered": f"""<title>Apply</title><form id=app method=post action="{SAVE}"><input type=hidden name=submit value=1>
        <button id=b>Next</button></form><script>document.getElementById('b').addEventListener('pointerdown', () =>
          document.getElementById('app').insertAdjacentHTML('beforeend', '<input type=hidden name=getAttribute value=x>'));
        document.getElementById('b').addEventListener('click', () =>
          document.getElementById('app').insertAdjacentHTML('beforeend', '<input type=hidden name=getAttribute value=x>'), true);</script>""",
}


@pytest.mark.parametrize("name", list(PLAIN))
def test_plain(name):
    with plain({START: PLAIN[name]} | ALWAYS) as (page, drive, site):
        _press("plain code's Next", page, drive)
        _settle(page, 2500)
    assert site.applications() == []
