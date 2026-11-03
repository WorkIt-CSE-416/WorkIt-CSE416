"""A fake Oracle Recruiting Cloud (Candidate Experience), a job system with
no Filler. Implements the JobSite adapter. Nothing here touches the network.

Up to the email step it is real Oracle: the saved posting
(tests/save_page.py <url> <out> "Apply Now") is served from its HAR, so
Oracle's own code renders the posting and its "Enter your email to get
started" step (email box, honeypot box, legal disclaimer, Next).

After the email step it is built from Oracle's documentation (Enable Email
Authentication and Email Reuse; 24A/24C release notes), since going on needs
an email Oracle would write to:
- A script on the saved page takes the click on Next and sends the email to
  the fake, which plays Oracle's server.
- A returning candidate first confirms their last name.
- A one-time code is mailed (into the FakeMailbox, under MAIL_SEARCH), or sent
  by text message where the site uses SMS; "Send New Code" sends another.
- Then the application form: a one-page form Claude fill fills.
"""

import base64
import html
import itertools
import threading
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fake_lever import _load_responses
from fakes import FakeMailbox, Submission
from playwright.sync_api import Route, sync_playwright

from apply.oracle import MAIL_SEARCH

# Put on the saved Oracle pages: sends the email step to the fake.
EMAIL_STEP_SCRIPT = r"""
(() => {
  if (!location.hostname.endsWith('oraclecloud.com') || location.pathname.startsWith('/__fake__')) return;
  document.addEventListener('click', (event) => {
    const next = event.target.closest && event.target.closest('button[type=submit].apply-flow-pagination__button');
    if (!next || !/\/apply\/email$/.test(location.pathname)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const email = document.querySelector('input[type=email]').value;
    const accepted = document.getElementById('legal-disclaimer-checkbox').checked;
    const honeypot = (document.querySelector('[id^=honey-pot]') || {}).value || '';
    fetch('/__fake__/email', {method: 'POST', body: JSON.stringify({email, accepted, honeypot, page: location.href})})
      .then(r => r.json()).then(r => { location.href = r.next; });
  }, true);
})();
"""

PAGE_SCRIPT = r"""
const post = (path, body) => fetch(path, {method: 'POST', body: JSON.stringify(body)}).then(r => r.json()).then(r => {
  if (r.next) location.href = r.next;
  if (r.error) { const e = document.getElementById('error'); e.hidden = false; e.textContent = r.error; }
});
const boxes = [...document.querySelectorAll('.pin-code-input')];
boxes.forEach((box, i) => box.addEventListener('input', () => { if (box.value && boxes[i + 1]) boxes[i + 1].focus(); }));
const on = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
on('verify', () => post('/__fake__/code', {code: boxes.map(b => b.value).join('')}));
on('resend', () => post('/__fake__/resend', {}));
on('identity-next', () => post('/__fake__/identity', {lastName: document.getElementById('last-name').value}));
const uploads = {};
for (const input of document.querySelectorAll('input[type=file]')) {
  input.onchange = () => {
    const reader = new FileReader();
    reader.onload = () => { uploads[input.id] = {name: input.files[0].name, b64: reader.result.split(',')[1]}; };
    reader.readAsDataURL(input.files[0]);
  };
}
on('submit-application', () => {
  const values = {};
  for (const input of document.querySelectorAll('form input:not([type=file])')) values[input.id] = input.value;
  post('/__fake__/submit', {values, files: uploads});
});
"""

FORM = """
<h2>Contact Information</h2>
<form onsubmit="return false">
  <label for="first-name">First Name</label><input id="first-name">
  <label for="last-name-field">Last Name</label><input id="last-name-field">
  <label for="phone">Phone Number</label><input id="phone">
  <label for="resume">Resume</label><input id="resume" type="file">
</form>
<button id="submit-application" type="button">Submit</button>
"""


class FakeOracleServer:
    """Serves a saved Oracle posting and plays Oracle's server after its email step.

    `verify`: how the candidate confirms their email: "email" (a code by
    mail), "sms" (a code by text message) or None (a first-time candidate goes
    straight to the form). `returning`: the email has a profile, so its last
    name is asked first. `codes_lost`: mailed codes never arrive."""

    def __init__(self, *forms: Path, mailbox: FakeMailbox | None = None, verify: str | None = "email",
                 returning: bool = False, codes_lost: bool = False, last_name: str = "Person"):
        self._responses: dict[str, tuple[int, str, bytes]] = {}
        for form in forms:
            self._responses.update(_load_responses(form))
        self._mailbox = mailbox
        self._verify = verify
        self._returning = returning
        self._codes_lost = codes_lost
        self._last_name = last_name
        self._codes = (f"{n:06d}" for n in itertools.count(482913, 7919))
        self._lock = threading.Lock()
        self._code = ""
        self.emails: list[dict] = []  # what each email step sent
        self.codes_sent: list[str] = []
        self.resends = 0
        self.tried_codes: list[str] = []
        self.submissions: list[Submission] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        if url in self._responses and body is None:
            return self._responses[url][2]
        raise LookupError(f"fake Oracle has nothing saved at {url}")

    @contextmanager
    def open(self, url: str, worker: int = 0):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(service_workers="block")
            context.add_init_script(EMAIL_STEP_SCRIPT)
            context.route("**/*", self._handle)
            try:
                page = context.new_page()
                page.goto(url)
                yield page
            finally:
                browser.close()

    def _handle(self, route: Route) -> None:
        request = route.request
        parts = urlsplit(request.url)
        if parts.path.startswith("/__fake__/") and (parts.hostname or "").endswith("oraclecloud.com"):
            return self._fake(route, parts.path.removeprefix("/__fake__/"))
        if request.method == "GET" and request.url in self._responses:
            status, mime, body = self._responses[request.url]
            return route.fulfill(status=status, content_type=mime, body=body)
        route.abort()

    def _fake(self, route: Route, path: str) -> None:
        if route.request.method == "POST":
            return self._post(route, path, route.request.post_data_json)
        pages = {
            "identity": (
                "<h2>Confirm Your Identity</h2><p>We found a profile for this email. To confirm it's you, enter your last name.</p>"
                '<label for="last-name">Last Name</label><input id="last-name">'
                '<button id="identity-next" type="button">Next</button>'
            ),
            "code": self._code_page(),
            "form": FORM,
            "done": "<h2>Thank you for applying.</h2>",
            "rejected": "<h2>Something went wrong.</h2>",
        }
        if path not in pages:
            return route.abort()
        route.fulfill(content_type="text/html", body=(
            f"<!doctype html><meta charset='utf-8'><body><div id='error' role='alert' hidden></div>{pages[path]}"
            f"<script>{PAGE_SCRIPT}</script></body>"
        ))

    def _post(self, route: Route, path: str, body: dict) -> None:
        if path == "email":
            self.emails.append(body)
            if not body["accepted"] or body["honeypot"]:
                return route.fulfill(json={"next": "/__fake__/rejected"})
            return route.fulfill(json={"next": "/__fake__/identity" if self._returning else self._after_identity()})
        if path == "identity":
            if body["lastName"].strip().casefold() != self._last_name.casefold():
                return route.fulfill(json={"error": "The information you entered doesn't match our records."})
            return route.fulfill(json={"next": self._after_identity()})
        if path == "resend":
            self.resends += 1
            self._send_code()
            return route.fulfill(json={})
        if path == "code":
            self.tried_codes.append(body["code"])
            if not self._code or body["code"] != self._code:
                return route.fulfill(json={"error": "The verification code is incorrect. Try again."})
            return route.fulfill(json={"next": "/__fake__/form"})
        if path == "submit":
            files = {k: base64.b64decode(v["b64"]) for k, v in body["files"].items()}
            self.submissions.append(Submission("oracle", {**body["values"], **{k: v["name"] for k, v in body["files"].items()}}, files))
            return route.fulfill(json={"next": "/__fake__/done"})
        route.abort()

    def _after_identity(self) -> str:
        if self._verify is None:
            return "/__fake__/form"
        self._send_code()
        return "/__fake__/code"

    def _send_code(self) -> None:
        with self._lock:
            self._code = next(self._codes)
            self.codes_sent.append(self._code)
        if self._verify == "email" and not self._codes_lost:
            self._mailbox.deliver(MAIL_SEARCH, code=self._code)

    def _code_page(self) -> str:
        sent = ("by text message to your phone number ending in 0199" if self._verify == "sms"
                else "to t***@example.com")
        boxes = "".join(f'<input class="pin-code-input" maxlength="1" aria-label="Verification code digit {n}">' for n in range(1, 7))
        return (
            f"<h2>Confirm Your Identity</h2><p>Enter the verification code we sent {html.escape(sent)}.</p>"
            f"<div>{boxes}</div><button id='verify' type='button'>Verify</button>"
            "<button id='resend' type='button'>Send New Code</button>"
        )
