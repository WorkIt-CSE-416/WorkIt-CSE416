"""A fake Paylocity apply page, hand-written after the live North Atlantic
Industries form (2026-10-16): on load an "Apply with resume" pop-up, over a
backdrop that covers the whole page, asks for the résumé, and every click on
the form behind it lands on the pop-up instead. Its "Upload Resume" button
fronts a hidden file input; a file given to it closes the pop-up and shows in
the form's own Resume section. A file given to the form's own Resume input
leaves the pop-up where it is (live, the pop-up outlasted the attach). Implements the JobSite adapter and records what
would have been submitted. Nothing here touches the network.

`pop_up` is what the pop-up offers: "resume" (live), "close" (no upload, a ×
that closes it) or "stuck" (neither: nothing closes it). `reply` is what the
page does once Submit is clicked: "thanks" (sends, then thanks in place of the
form), "moves" (sends, then goes on to a page of its own that thanks no one),
"gone" (sends, and the form goes, with no word of thanks), "blank" (sends,
and the page goes blank: it may yet bring the form back) or "bounce" (a
validation error over the form, which stays: nothing sent)."""

import base64
import json
from contextlib import contextmanager

from fakes import Submission
from playwright.sync_api import Route, sync_playwright

URL = "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4450421"
SEND_URL = "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4450421/Send"
DONE_URL = "https://recruiting.paylocity.com/Recruiting/Jobs/Applied/4450421"
# After a "moves" send: no thanks, and a form of its own (job search).
DONE = """<!doctype html><html><body><h1>Your applications</h1>
<form><label for="q">Search jobs</label><input id="q" name="q"></form></body></html>"""
REPLY = {
    "thanks": "document.body.innerHTML = '<h1>Thank you for applying</h1>';",
    "moves": "location.href = '/Recruiting/Jobs/Applied/4450421';",
    "gone": "document.getElementById('form').remove(); document.body.insertAdjacentHTML('beforeend', '<p>We will be in touch.</p>');",
    "blank": "document.body.innerHTML = '';",
    "bounce": "",
}
HOW_HEARD = ["Department of Labor", "College Job Board", "Company Website"]

POP_UP = {
    "resume": """
      <input accept=".pdf" id="btn-forceResume" type="file" style="display:none" onchange="uploaded(this)">
      <button type="button" onclick="document.getElementById('btn-forceResume').click()">Upload Resume</button>""",
    "close": """
      <button type="button" aria-label="Close" onclick="closePopUp()">&times;</button>""",
    "stuck": "",
}
PAGE = """<!doctype html>
<html><head><title>North Atlantic Industries, Inc - Intern - Full Stack Software Engineer (Summer 2027) Application</title>
<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 500; }
  .modal { position: fixed; inset: 0; display: table; width: 100%%; height: 100%%; z-index: 505; }
  .modal-dialog { display: table-cell; vertical-align: middle; text-align: center; }
  .modal-content { display: inline-block; background: #fff; padding: 20px; }
</style></head><body>
<div id="pop-up">
  <div class="backdrop"></div>
  <div class="modal" role="dialog" aria-hidden="false"><div class="modal-dialog"><div class="modal-content">
    <h2>Apply with resume</h2>
    <p>Upload your resume and we'll automatically fill out your application</p>
    %(pop_up)s
  </div></div></div>
</div>
<form id="form" onsubmit="send(event)">
  <h3>Resume</h3>
  <div id="resume-name"></div>
  <input accept=".pdf" id="btn-resume" type="file" style="display:none" onchange="uploaded(this)">
  <button type="button" onclick="document.getElementById('btn-resume').click()">Select Resume to Upload</button>
  <h3>Information</h3>
  <label for="first">First Name (required)</label><input id="first" name="first">
  <label for="last">Last Name (required)</label><input id="last" name="last">
  <label for="email">Email Address (required)</label><input id="email" name="email">
  <fieldset role="radiogroup" aria-label="How did you hear about us?"><legend>How did you hear about us?</legend>
    %(how_heard)s
  </fieldset>
  <button type="submit">Submit Application</button>
</form>
<script>
let resume = null;
function closePopUp() { document.getElementById('pop-up').remove(); }
function uploaded(input) {
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    resume = {name: file.name, data: reader.result.split(',')[1]};
    document.getElementById('resume-name').textContent = file.name;
    if (input.id === 'btn-forceResume') closePopUp();
  };
  reader.readAsDataURL(file);
}
function send(event) {
  event.preventDefault();
  if (%(bounces)s) {
    document.getElementById('form').insertAdjacentHTML('afterbegin', '<p role="alert">Please correct the errors below.</p>');
    return;
  }
  const fields = {};
  for (const el of document.querySelectorAll('#form input[type=text], #form input:not([type])')) fields[el.name] = el.value;
  const heard = document.querySelector('input[name=heard]:checked');
  fields.heard = heard ? heard.value : '';
  fetch('/Recruiting/Jobs/Apply/4450421/Send', {method: 'POST', body: JSON.stringify({fields, resume})})
    .then(() => { %(reply)s });
}
</script>
</body></html>
"""


class FakePaylocityServer:
    def __init__(self, pop_up: str = "resume", reply: str = "thanks"):
        self._page = PAGE % {
            "pop_up": POP_UP[pop_up],
            "bounces": json.dumps(reply == "bounce"),
            "reply": REPLY[reply],
            "how_heard": "".join(f'<label><input type="radio" name="heard" value="{o}">{o}</label>' for o in HOW_HEARD),
        }
        self.submissions: list[Submission] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        raise LookupError(f"fake Paylocity has nothing to fetch at {url}")

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
            resume = sent["resume"]
            files = {"resume": base64.b64decode(resume["data"])} if resume else {}
            self.submissions.append(Submission(url=request.url, application=sent["fields"], files=files))
            return route.fulfill(json={})
        if request.url == DONE_URL:
            return route.fulfill(content_type="text/html", body=DONE)
        if request.url != URL:
            return route.abort()
        route.fulfill(content_type="text/html", body=self._page)
