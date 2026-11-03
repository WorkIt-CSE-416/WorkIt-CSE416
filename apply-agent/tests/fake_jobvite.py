"""A fake Jobvite apply page, hand-written after the live Tyler Technologies
form: the résumé's "Select" button opens a menu whose "File" label points at a
hidden `input[type=file]` that Jobvite keeps at the end of the page, far from
the "Add Resume" heading. Some tenants first ask for the country of residence
and an "I accept" of their privacy notice. Implements the JobSite adapter and
records what would have been submitted. Nothing here touches the network.

Like Jobvite's own form, it can come in steps (`steps`): each later step
shows after a "Next" button (`type="button"`, required fields checked first),
and "Send Application", the form's one submit button, shows on the last step
only. Any submit of the form (Enter in a field, a script) goes to the next
step until the last, where the application is sent as an XHR POST to
`.../job/<id>/submitApplication`, as Jobvite's ApplySvc does."""

import base64
import json
from contextlib import contextmanager

from fakes import Submission
from playwright.sync_api import Route, sync_playwright

URL = "https://jobs.jobvite.com/tylertech/job/oAVOAfwD/apply"
SEND_URL = "https://jobs.jobvite.com/tylertech/job/oAVOAfwD/submitApplication"

GATE = """
<div id="gate">
  <label for="jv-country-select">Please select your country of residence</label>
  <select id="jv-country-select" onchange="document.getElementById('accept').disabled = !this.value">
    <option value="">Select...</option>
    <option value="ca">California</option>
    <option value="eu">Europe</option>
    <option value="rest">All locations except California &amp; Europe</option>
  </select>
  <p>We process your data as our privacy notice says.</p>
  <button type="button" id="accept" disabled onclick="passGate()">I accept</button>
</div>
"""

# The résumé's uploader: "button" hides the file input behind Jobvite's menu; "native" is a
# plain file input, whose file name only the browser's own control shows; "none" has no file
# input at all (only a paste box), so Claude must attach the résumé its own way.
RESUME = {
    "button": """
  <h3 id="jv-resume-header">Add Resume*</h3>
  <div id="resume-name"></div>
  <button type="button" aria-labelledby="jv-resume-header" aria-haspopup="true" onclick="openMenu('menu-0')">Select</button>
""",
    "native": """
  <label for="resume">Add Resume*</label>
  <input id="resume" type="file" onchange="attached(this, 'resume', null, null)">
""",
    "none": """
  <label for="pasted">Add Resume*</label>
  <div id="resume-name"></div>
  <textarea id="pasted"></textarea>
""",
}
RESUME_MENU = """
<div id="menu-0" class="menu" style="display:none" role="dialog" aria-label="Attachment Options">
  <span role="button" tabindex="0">Dropbox</span>
  <label for="file-input-0"><span role="button" tabindex="0">File</span></label>
  <input id="file-input-0" type="file" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)"
         onchange="attached(this, 'resume', 'resume-name', 'menu-0')">
</div>
"""
COVER_MENU = """
<div id="menu-1" class="menu" style="display:none" role="dialog" aria-label="Attachment Options">
  <span role="button" tabindex="0">Dropbox</span>
  <label for="file-input-1"><span role="button" tabindex="0">File</span></label>
  <input id="file-input-1" type="file" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)"
         onchange="attached(this, 'cover', 'cover-name', 'menu-1')">
</div>
"""
PAGE = """<!doctype html>
<html><head><title>Tyler Technologies Careers - Software Development Intern, Summer 2027</title></head><body>
%(gate)s
<form id="form" style="display:%(form_display)s" onsubmit="submitApplication(event)" novalidate>
 <div class="step" id="step-1">
  %(resume)s
  <h3>Personal Information</h3>
  <label for="first">First Name*</label><input id="first" name="first" required>
  <label for="last">Last Name*</label><input id="last" name="last" required>
  <label for="email">Email*</label><input id="email" name="email" required>
  <h3>Additional Files (optional)</h3>
  <div id="cover-name"></div>
  <button type="button" onclick="openMenu('menu-1')">Add Cover Letter</button>
 </div>
  %(steps)s
  <p id="error" role="alert"></p>
  <span id="next-bar">%(beside_next)s<button type="button" id="next" onclick="nextStep()" aria-label="%(next)s">%(next)s &rarr;</button></span>
  <button type="submit" id="send" aria-label="Send Application">Send Application</button>
</form>
%(menus)s
<script>
const files = {};
function passGate() {
  document.getElementById('gate').remove();
  document.getElementById('form').style.display = 'block';
}
function openMenu(id) { document.getElementById(id).style.display = 'block'; }
function attached(input, key, shown, menu) {
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    files[key] = {name: file.name, data: reader.result.split(',')[1]};
    if (shown) document.getElementById(shown).textContent = file.name;
    if (menu) document.getElementById(menu).style.display = 'none';
  };
  reader.readAsDataURL(file);
}
let current = 1;
const last = document.querySelectorAll('#form .step').length;
function show() {
  document.querySelectorAll('#form .step').forEach((step, i) => step.style.display = i + 1 === current ? 'block' : 'none');
  document.getElementById('next-bar').style.display = current < last ? 'inline' : 'none';
  document.getElementById('send').style.display = current < last ? 'none' : 'inline';
}
function nextStep() {
  const blank = [...document.querySelectorAll('#step-' + current + ' [required]')].filter(el =>
    el.type === 'radio' ? !document.querySelector('input[name="' + el.name + '"]:checked') : !el.value);
  document.getElementById('error').textContent = blank.length ? 'Please complete all required fields.' : '';
  if (blank.length) return;
  current++;
  show();
}
function submitApplication(event) {  // ng-submit="submitApplication()"
  event.preventDefault();
  if (current < last) return nextStep();
  send();
}
function send() {
  const fields = {};
  for (const el of document.querySelectorAll('#form input:not([type=file]):not([type=radio]), #form textarea, #form select'))
    fields[el.name || el.id] = el.value;
  for (const el of document.querySelectorAll('#form input[type=radio]:checked')) fields[el.name] = el.value;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/tylertech/job/oAVOAfwD/submitApplication');
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = () => { document.body.innerHTML = '<h1>Thank you for applying</h1>'; };
  xhr.send(JSON.stringify({fields, files}));
}
show();
</script>
</body></html>
"""


class FakeJobviteServer:
    """Serves the fake Jobvite apply page at URL. `gate` puts the country of
    residence and privacy consent in front of the form; `steps` are the HTML
    of the form's later steps, each shown after Next. `next_label` names the button
    that goes on; `beside_next` are buttons shown beside it (before it on the
    page) on every step but the last, each of which sends the application, as
    a "Continue & Submit" would."""

    def __init__(self, gate: bool = False, resume: str = "button", steps: tuple[str, ...] = (),
                 next_label: str = "Next", beside_next: tuple[str, ...] = ()):
        self._page = PAGE % {
            "gate": GATE if gate else "",
            "next": next_label,
            "beside_next": "".join(f'<button type="button" onclick="window.send()">{label}</button>' for label in beside_next),
            "form_display": "none" if gate else "block",
            "resume": RESUME[resume],
            "steps": "".join(f'<div class="step" id="step-{n}">{html}</div>' for n, html in enumerate(steps, 2)),
            "menus": (RESUME_MENU if resume == "button" else "") + COVER_MENU,
        }
        self.submissions: list[Submission] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        raise LookupError(f"fake Jobvite has nothing to fetch at {url}")

    @contextmanager
    def open(self, url: str, worker: int = 0):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context()
            context.route("**/*", self._handle)
            try:
                page = context.new_page()
                page.goto(url)
                yield page
            finally:
                browser.close()

    def _handle(self, route: Route) -> None:
        request = route.request
        if request.url == SEND_URL and request.method == "POST":
            sent = json.loads(request.post_data)
            files = {key: base64.b64decode(f["data"]) for key, f in sent["files"].items()}
            self.submissions.append(Submission(url=request.url, application=sent["fields"], files=files))
            return route.fulfill(json={})
        if request.url != URL:
            return route.abort()
        route.fulfill(content_type="text/html", body=self._page)
