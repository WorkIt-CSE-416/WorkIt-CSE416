"""A fake careers site with no Filler whose form opens only to a signed-in
applicant, hand-written in the shape of SmartRecruiters' and iCIMS': the
posting's Apply Now leads to a sign-in page (an email and password, no Sign in
with Google, and a link to create an account); creating one (a POST form)
mails a code, from smartrecruiters.com, to a page that takes it; then the
form. Implements the JobSite adapter and records accounts, sign-ins, codes
and what would have been submitted. Nothing here touches the network.

`accounts` maps an email to the password of an account already there.
`mail` is "code" or "link": what a new account is verified by.
`captcha` puts a captcha challenge on the sign-in page; `invisible_captcha`, an
invisible hCaptcha that runs on its button (as on AMD's iCIMS email step), on it
and on the email step (EMAIL_STEP: an email box and Next, as iCIMS' login)."""

import json
from contextlib import contextmanager
from urllib.parse import parse_qs, urlsplit

from fakes import Submission
from playwright.sync_api import Route, sync_playwright

HOST = "https://jobs.smartrecruiters.com"
URL = f"{HOST}/Acme/7431-software-engineer-intern"
LOGIN = f"{HOST}/Acme/7431/login"
REGISTER = f"{HOST}/Acme/7431/register"
FORM = f"{HOST}/Acme/7431/form"
VERIFY = f"{HOST}/Acme/7431/verify"
EMAIL_STEP = f"{HOST}/Acme/7431/email"
SEARCH = "from:(smartrecruiters.com)"
CODE = "482915"

POSTING = """<!doctype html><html><head><title>Software Engineer Intern - Acme</title></head><body>
<h1>Software Engineer Intern</h1><p>Acme builds rockets. Summer 2027 internship in Denver.</p>
<a href="/Acme/7431/login">Apply Now</a></body></html>"""
SIGN_IN = """<!doctype html><html><body><h1>Sign in to apply</h1>
<div role="alert" id="error">%(error)s</div>%(captcha)s
<form id="login" onsubmit="signIn(event)">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="password">Password</label><input id="password" name="password" type="password">
  <button type="submit">Sign In</button>
</form>
<a href="/Acme/7431/register">Create an account</a>
<script>
function signIn(event) {
  event.preventDefault();
  fetch('/api/login', {method: 'POST', body: JSON.stringify({
    email: document.getElementById('email').value, password: document.getElementById('password').value})})
    .then(r => r.json()).then(r => {
      if (r.ok) location.href = '/Acme/7431/form';
      else document.getElementById('error').textContent = 'Incorrect email or password.';
    });
}
</script></body></html>"""
SIGN_UP = """<!doctype html><html><body><h1>Create your account</h1>
<div role="alert">%(error)s</div>
<form method="post" action="/Acme/7431/register">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="first">First name</label><input id="first" name="first">
  <label for="last">Last name</label><input id="last" name="last">
  <label for="password">Password</label><input id="password" name="password" type="password">
  <label for="confirm">Confirm password</label><input id="confirm" name="confirm" type="password">
  <button type="submit">Create Account</button>
</form></body></html>"""
CODE_PAGE = """<!doctype html><html><body><h1>Check your email</h1>
<p>We emailed a verification code to you.</p><div role="alert" id="error"></div>
<label for="code">Verification code</label><input id="code" name="code" autocomplete="one-time-code">
<button type="button" onclick="verify()">Verify</button>
<button type="button" onclick="fetch('/api/resend', {method: 'POST'})">Resend code</button>
<script>
function verify() {
  fetch('/api/verify', {method: 'POST', body: document.getElementById('code').value})
    .then(r => r.json()).then(r => {
      if (r.ok) location.href = '/Acme/7431/form';
      else document.getElementById('error').textContent = 'That code is incorrect.';
    });
}
</script></body></html>"""
LINK_SENT = """<!doctype html><html><body><h1>Check your email</h1>
<p>We emailed you a link to verify your account.</p></body></html>"""
VERIFIED = """<!doctype html><html><body><h1>Your email is verified</h1></body></html>"""
APPLICATION = """<!doctype html><html><body><h1>Software Engineer Intern - Application</h1>
<form id="form" onsubmit="send(event)">
  <label for="first">First Name</label><input id="first" name="first">
  <label for="last">Last Name</label><input id="last" name="last">
  <label for="phone">Phone</label><input id="phone" name="phone">
  <button type="submit">Submit Application</button>
</form>
<script>
function send(event) {
  event.preventDefault();
  const fields = {};
  for (const el of document.querySelectorAll('#form input')) fields[el.name] = el.value;
  fetch('/api/applications/submit', {method: 'POST', body: JSON.stringify(fields)})
    .then(() => { document.body.innerHTML = '<h1>Thank you for applying</h1>'; });
}
</script></body></html>"""
CAPTCHA = '<div class="g-recaptcha"><iframe title="reCAPTCHA"></iframe></div>'
INVISIBLE_CAPTCHA = ('<script src="https://js.hcaptcha.com/1/api.js" async defer></script>'
                     '<div class="h-captcha" data-sitekey="10000000-ffff-ffff-ffff-000000000001" data-size="invisible"></div>')
EMAIL_PAGE = """<!doctype html><html><body><h1>Enter your email</h1>%(captcha)s
<form id="email-step" onsubmit="next(event)">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <button type="submit">Next</button>
</form>
<script>
function next(event) {
  event.preventDefault();
  fetch('/api/email-step', {method: 'POST', body: document.getElementById('email').value});
}
</script></body></html>"""


class FakeAccountsSite:
    def __init__(self, mailbox=None, keychain=None, accounts: dict[str, str] | None = None, mail: str = "code",
                 captcha: bool = False, invisible_captcha: bool = False):
        self._mailbox = mailbox
        self._keychain = keychain
        self._mail = mail
        self._captcha = captcha
        self._invisible = INVISIBLE_CAPTCHA if invisible_captcha else ""
        self.email_steps: list[str] = []  # the emails sent by the email step's Next
        self.accounts = {email: {"password": p, "verified": True} for email, p in (accounts or {}).items()}
        self.created: list[dict] = []
        self.sign_ins: list[tuple[str, bool]] = []
        self.codes_tried: list[str] = []
        self.resends = 0
        self.submissions: list[Submission] = []
        self._signed_in = ""
        self._pending = ""  # the email whose code or link was mailed

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        raise LookupError(f"the fake site has nothing to fetch at {url}")

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

    def _html(self, route: Route, body: str) -> None:
        route.fulfill(content_type="text/html", body=body)

    def _handle(self, route: Route) -> None:
        request = route.request
        url, method = request.url.split("?")[0], request.method
        if url == URL:
            return self._html(route, POSTING)
        if url == LOGIN or (url == FORM and not self._signed_in):
            return self._html(route, SIGN_IN % {"error": "", "captcha": (CAPTCHA if self._captcha else "") + self._invisible})
        if url == EMAIL_STEP:
            return self._html(route, EMAIL_PAGE % {"captcha": self._invisible})
        if url == f"{HOST}/api/email-step":
            self.email_steps.append(request.post_data)
            return route.fulfill(json={})
        if url == FORM:
            return self._html(route, APPLICATION)
        if url == REGISTER and method == "GET":
            return self._html(route, SIGN_UP % {"error": ""})
        if url == REGISTER:
            return self._register(route, {k: v[0] for k, v in parse_qs(request.post_data or "").items()})
        if url == f"{HOST}/api/login":
            sent = json.loads(request.post_data)
            account = self.accounts.get(sent["email"])
            ok = bool(account) and account["password"] == sent["password"] and account["verified"]
            self.sign_ins.append((sent["email"], ok))
            self._signed_in = sent["email"] if ok else ""
            return route.fulfill(json={"ok": ok})
        if url == f"{HOST}/api/verify":
            self.codes_tried.append(request.post_data)
            ok = request.post_data == CODE
            if ok:
                self._verified()
            return route.fulfill(json={"ok": ok})
        if url == f"{HOST}/api/resend":
            self.resends += 1
            return route.fulfill(json={})
        if url == VERIFY:
            self._verified()
            return self._html(route, VERIFIED)
        if url == f"{HOST}/api/applications/submit":
            self.submissions.append(Submission(url=url, application=json.loads(request.post_data), files={}))
            return route.fulfill(json={})
        route.abort()

    def _register(self, route: Route, form: dict) -> None:
        if form.get("email") in self.accounts:
            return self._html(route, SIGN_UP % {"error": "An account already exists for this email address."})
        if not form.get("password") or form.get("password") != form.get("confirm"):
            return self._html(route, SIGN_UP % {"error": "The passwords don't match."})
        self.accounts[form["email"]] = {"password": form["password"], "verified": False}
        self.created.append(dict(form, keychain=self._keychain.password(urlsplit(HOST).hostname) if self._keychain else None))
        self._pending = form["email"]
        if self._mail == "link":
            self._mailbox.deliver(SEARCH, link=VERIFY)
            return self._html(route, LINK_SENT)
        self._mailbox.deliver(SEARCH, code=CODE)
        self._html(route, CODE_PAGE)

    def _verified(self) -> None:
        self.accounts[self._pending]["verified"] = True
        self._signed_in = self._pending
