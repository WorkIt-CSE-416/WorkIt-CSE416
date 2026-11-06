"""A fake Workday, and the Google account chooser its Sign in with Google
goes to. Implements the JobSite adapter. Nothing here touches the network.

Up to the sign-in step it is real Workday: each saved posting
(tests/save_workday_form.py) is served from its HAR, so Workday's own code
renders the posting, the Apply popup and the Create Account / Sign In views
(or the Google button), exactly as the live tenant did on 2026-10-15.

From the sign-in on it is built from Workday's documented structure, since
those pages can't be saved without an account:
- The fake plays Workday's server for the auth forms: a script on the saved
  pages takes the click on Create Account / Sign In (the `click_filter`
  overlay Workday puts on each button), sends the form to the fake, and
  shows its answer as Workday shows errors. The Google button's real
  redirect (wd*-identity.myworkday.com) is answered with the fake chooser.
- A tenant that verifies email sends a link into the FakeMailbox, searched
  for as "from:(myworkday.com OR otp.workday.com)".
- Forgot your password? is Workday's own view; its Reset Password goes to
  the fake, which mails a reset link (as above) to a page that sets a new
  password, in the auth form's DOM shape.
- The application steps after sign-in (My Information, My Experience,
  Application Questions, Voluntary Disclosures, Self Identify, Review) are
  the fake's own pages, with Workday's progress bar, `formField-*` field
  containers, dropdown buttons, radio fieldsets, the multiselect prompt,
  the file uploader, the MM/YYYY date inputs, the repeating sections (Work
  Experience, Education: an Add button, numbered panels each with a Delete
  button) and the `pageFooterNextButton`. Each step is saved on Save and
  Continue, and Workday refuses to leave a step missing a required answer.
  Submit on Review records the Submission.
"""

import base64
import html
import json
import os
import re
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from pathlib import Path
from urllib.parse import parse_qs, quote, urljoin, urlsplit

from fakes import FakeMailbox, Submission
from playwright.sync_api import Route, sync_playwright

from apply.fill_engine import ENGINE_DIR

MAIL_SEARCH = "from:(myworkday.com OR otp.workday.com)"  # Workday mails from both
EMPTY = (None, "", [], False)
GOOGLE = "https://accounts.google.com"


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    kind: str  # text, textarea, dropdown, radio, checkbox, checkboxes, prompt, file, date
    required: bool = False
    options: tuple[str, ...] = ()
    chosen: tuple[str, ...] = ()  # a prompt's choices before the candidate picks any (Workday presets some)
    bare: bool = False  # a prompt whose search box has no automation id or type attribute (Snap's, live)
    # A long prompt (Snap's Field of Study, seen live): opening it lists only its first options (their
    # aria-setsize says how many there are), Escape doesn't close it, and Enter searches it for what
    # was typed, picking the one match itself.
    search: bool = False
    opens_empty: bool = False  # a searched prompt that lists only "No Items." when opened (AmFam's school, seen live)
    many: bool = False  # a searched prompt that holds many items (Workday's skills, seen live)
    slow: float = 0  # seconds a dropdown's list takes to open (NVIDIA's, with four browsers at once, seen live)
    lost: int = 0  # how many of its first searches find nothing, as when Workday is slow (Workday's skills, seen live)
    # A nested prompt (Workday's own How Did You Hear About Us?, seen live): opening it lists
    # categories, and clicking one lists its own options in their place. ((category, options), ...);
    # a category with no options of its own is one (Other).
    tree: tuple[tuple[str, tuple[str, ...]], ...] = ()
    format: str = "MM/YYYY"  # a date's sections: MM/YYYY, YYYY or MM/DD/YYYY
    group: str = ""  # the titled group it sits in, whose title says what a vague label doesn't
    shown_if: tuple[str, str] = ()  # (key, answer): shown, and asked, only once that field has that answer
    intro: str = ""  # the step's own text just before it, outside every field (a heading or an intro)


@dataclass(frozen=True)
class Section:
    """A repeating section (Work Experience, Education): numbered panels of
    `fields`, added with its Add button. `panels` empty ones show at first;
    a `required` section must keep at least one."""

    key: str
    title: str
    fields: tuple[Field, ...]
    required: bool = False
    panels: int = 0


YES_NO = ("Yes", "No")
STEPS: list[tuple[str, list[Field]]] = [
    ("My Information", [
        Field("source", "How Did You Hear About Us?", "prompt", True,
              ("Career Fair", "Company Website", "Job Board", "LinkedIn", "Referral", "Other")),
        Field("candidateIsPreviousWorker", "Have you previously worked for this company?", "radio", True, YES_NO),
        Field("country", "Country", "dropdown", True, ("Canada", "United States of America")),
        Field("legalName--firstName", "First Name", "text", True),
        Field("legalName--lastName", "Last Name", "text", True),
        Field("addressLine1", "Address Line 1", "text"),
        Field("city", "City", "text"),
        Field("countryRegion", "State", "dropdown", options=("Illinois", "Ohio", "Texas")),
        Field("postalCode", "Postal Code", "text"),
        Field("phoneType", "Phone Device Type", "dropdown", True, ("Home", "Mobile", "Work")),
        Field("phoneNumber", "Phone Number", "text", True),
    ]),
    ("My Experience", [
        Field("resumeAttachments", "Resume/CV", "file", True),
        Field("linkedinQuestion", "LinkedIn", "text"),
    ]),
    ("Application Questions", [
        Field("authorized", "Are you legally authorized to work in the United States?", "dropdown", True, YES_NO),
        Field("sponsorship", "Will you now or in the future require sponsorship for employment visa status?",
              "dropdown", True, YES_NO),
    ]),
    ("Voluntary Disclosures", [
        Field("gender", "Gender", "dropdown", True, ("Female", "Male", "I do not wish to answer")),
        Field("ethnicity", "Please select the ethnicity which most accurately describes how you identify yourself",
              "dropdown", True, ("Asian", "Black or African American", "Hispanic or Latino", "White",
                                 "I do not wish to answer")),
        Field("veteranStatus", "Veteran Status", "dropdown", True,
              ("I am a protected veteran", "I am not a protected veteran", "I do not wish to self-identify")),
        Field("acceptTermsAndAgreements", "Yes, I have read and consent to the terms and conditions", "checkbox", True),
    ]),
    ("Self Identify", [
        Field("selfIdentifiedDisabilityData--name", "Name", "text", True),
        Field("disabilityStatus", "Disability Status", "radio", True, (
            "Yes, I have a disability, or have had one in the past",
            "No, I do not have a disability and have not had one in the past",
            "I do not want to answer",
        )),
    ]),
]

# Snap's My Experience (seen live): required Work Experience and Education
# sections, each showing one empty panel, and the résumé.
FIELDS_OF_STUDY = ("Accounting", "Actuarial Science", "Advertising", "Applied Mathematics",
                   "Business Management Science and Computer System", "Computer and Information Science",  # AmFam's two (live)
                   "Computer Engineering", "Electrical Engineering", "Mathematics", "Statistics")
WORK_EXPERIENCE = Section("workExperience", "Work Experience", (
    Field("jobTitle", "Job Title", "text", True),
    Field("companyName", "Company", "text", True),
    Field("location", "Location", "text", True),
    Field("currentlyWorkHere", "I currently work here", "checkbox"),
    Field("startDate", "From", "date", True),
    Field("endDate", "To", "date", True),
    Field("roleDescription", "Role Description", "textarea"),
), required=True, panels=1)
EDUCATION = Section("education", "Education", (
    Field("schoolName", "School or University", "text", True),
    Field("degree", "Degree", "dropdown", True, ("GED", "HS", "A.A.", "B.A.", "B.S.", "M.A.", "M.S.", "MBA", "JD", "PhD")),
    Field("fieldOfStudy", "Field of Study", "prompt", True, FIELDS_OF_STUDY, search=True),
    Field("gradeAverage", "Overall Result (GPA)", "text", True),
    Field("firstYearAttended", "From", "date", True, format="YYYY"),
    Field("lastYearAttended", "To (Actual or Expected)", "date", True, format="YYYY"),
), required=True, panels=1)
WEBSITES = Section("websites", "Websites", (Field("url", "URL", "text", True),))
MY_EXPERIENCE = ("My Experience", [WORK_EXPERIENCE, EDUCATION, WEBSITES,
                                     Field("resumeAttachments", "Upload a file (5MB max)", "file", group="Resume/CV")])
EXPERIENCE_STEPS = [STEPS[0], MY_EXPERIENCE, *STEPS[2:]]

# Put on every saved Workday page: plays Workday's server for the sign-in forms.
AUTH_SCRIPT = r"""
(() => {
  if (!/myworkday(jobs|site)\.com$/.test(location.hostname) || location.pathname.startsWith('/__fake__')) return;
  const show = (text, kind) => {
    let box = document.getElementById('fake-auth-message');
    if (!box) { box = document.createElement('div'); box.id = 'fake-auth-message'; document.body.prepend(box); }
    box.innerHTML = '';
    const message = document.createElement('div');
    message.setAttribute('data-automation-id', {error: 'errorMessage', alert: 'alertMessage'}[kind] || 'verifyEmailNotice');
    message.setAttribute('role', 'alert');
    message.textContent = text;
    box.appendChild(message);
    if (kind === 'verify') {
      const resend = document.createElement('button');
      resend.setAttribute('data-automation-id', 'resendVerificationEmail');
      resend.textContent = 'Resend Account Verification';
      resend.onclick = () => fetch('/__fake__/resend', {method: 'POST', body: JSON.stringify({email: window.__fakeEmail})});
      box.appendChild(resend);
    }
  };
  document.addEventListener('click', (event) => {
    // Switching views clears the last answer, as Workday does.
    if (event.target.closest && event.target.closest('[data-automation-id$=Link]')) {
      const box = document.getElementById('fake-auth-message');
      if (box) box.innerHTML = '';
    }
    const button = event.target.closest && event.target.closest('[data-automation-id=click_filter],[data-automation-id=createAccountSubmitButton],[data-automation-id=signInSubmitButton]');
    if (!button) return;
    const form = button.closest('[data-automation-id=signInFormo]');
    if (!form) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    // A click Workday drops, sending nothing (Axiom's first Create Account, live).
    if (window.__fakeIgnoredClicks > 0) { window.__fakeIgnoredClicks--; return; }
    const value = (id) => { const el = form.querySelector(`[data-automation-id=${id}]`); return el ? el.value : null; };
    const box = form.querySelector('[data-automation-id=createAccountCheckbox]');
    const creating = !!form.querySelector('[data-automation-id=verifyPassword]');
    window.__fakeEmail = value('email');
    if (form.querySelector('[data-automation-id=resetPasswordButton]')) {  // Forgot Password
      fetch('/__fake__/forgot-password', {method: 'POST', body: JSON.stringify({email: value('email')})})
        .then(r => r.json()).then(r => show(r.error || r.notice, r.error ? 'error' : 'alert'));
      return;
    }
    fetch('/__fake__/' + (creating ? 'register' : 'sign-in'), {
      method: 'POST',
      body: JSON.stringify({email: value('email'), password: value('password'), verify: value('verifyPassword'),
                            accepted: box ? box.checked : null, page: location.href}),
    }).then(r => r.json()).then(r => {
      if (r.next) location.href = r.next;
      else if (r.signIn) document.querySelector('[data-automation-id=signInLink]').click();  // a bare Sign In view
      else if (!(creating && r.error && window.__fakeHidesErrors)) show(r.error || r.notice, r.error ? 'error' : 'verify');
    });
  }, true);
})();
"""

# The page a reset link opens: a new password, typed twice, in the auth form's DOM shape.
RESET_PAGE = r"""
<h3 id="authViewTitle">Reset Password</h3>
<form data-automation-id="signInFormo">
  <label>New Password<input type="password" data-automation-id="password"></label>
  <label>Verify New Password<input type="password" data-automation-id="verifyPassword"></label>
  <div role="button" aria-label="Reset Password" data-automation-id="click_filter" style="width:200px;height:40px"></div>
  <button type="submit" data-automation-id="resetPasswordButton" tabindex="-2" aria-hidden="true">Reset Password</button>
</form>
<div id="message"></div>
<script>
document.querySelector('[data-automation-id=click_filter]').onclick = () => {
  const value = (id) => document.querySelector(`[data-automation-id=${id}]`).value;
  fetch('/__fake__/reset-password', {method: 'POST', body: JSON.stringify({
    token: new URLSearchParams(location.search).get('token'), password: value('password'), verify: value('verifyPassword')})})
    .then(r => r.json()).then(r => {
      document.getElementById('message').innerHTML =
        `<div role="alert" data-automation-id="${r.error ? 'errorMessage' : 'alertMessage'}"></div>`;
      document.querySelector('#message [role=alert]').textContent = r.error || r.notice;
    });
};
</script>
"""

# The fake's own application step pages: widgets in Workday's DOM shapes. The
# Fill engine's fake Workday serves the same script, so it lives in its repo.
STEP_SCRIPT = (ENGINE_DIR / "test" / "fake-workday-step.js").read_text()

# Put on the saved posting pages when the Worker profile already started this
# application: Workday then offers Continue Application in place of Apply.
CONTINUE_SCRIPT = r"""
(() => {
  if (!/myworkday(jobs|site)\.com$/.test(location.hostname) || location.pathname.startsWith('/__fake__')
      || /\/apply(\/|$)/.test(location.pathname)) return;
  // Swapped as soon as Workday's code renders Apply, before anything can click it.
  const watch = new MutationObserver(() => {
    const apply = document.querySelector('[data-automation-id=adventureButton]');
    if (!apply) return;
    watch.disconnect();
    const go = document.createElement('a');
    go.setAttribute('data-automation-id', 'continueButton');
    go.setAttribute('role', 'button');
    go.href = '/__fake__/continue?posting=' + encodeURIComponent(location.href);
    go.textContent = 'Continue Application';
    apply.replaceWith(go);
  });
  watch.observe(document, {childList: true, subtree: true});
})();
"""

CHOOSER_SCRIPT = r"""
for (const account of document.querySelectorAll('[data-identifier]')) {
  account.onclick = () => { location.href = account.dataset.next; };
}
"""


@dataclass
class Tenant:
    """One Workday tenant's accounts and in-progress applications."""

    verify_email: bool = False
    accounts: dict[str, dict] = field(default_factory=dict)  # email -> {password, verified}
    saved: dict[tuple[str, str], dict] = field(default_factory=dict)  # (email, posting) -> {field key: value}
    signed_in: str | None = None
    posting: str = ""  # the Posting the signed-in candidate is applying to


class FakeWorkdayServer:
    """Serves saved Workday postings (folders from tests/save_workday_form.py)
    and plays Workday's server from the sign-in on.

    `keychain`: what Keychain holds is noted as each account is made (`created`).
    `mailbox`: where verification links go. `verify_email`: tenant hosts that
    verify a new account's email; `links_lost` makes those mails never come.
    `accounts`: {(tenant host, email): password} made before the test.
    `google`: what Google does once Sign in with Google is clicked: "pick"
    (lists Lisul's account to pick), "auto" (goes straight back, signed in,
    as for a Worker profile that used it before), "password" (asks for his password), "passkey" (asks for his passkey), or
    "rejected" (refuses the browser after the pick: "This browser or app may not be secure").
    `steps`: the application steps after sign-in. `google_delay`: seconds
    Workday takes to come back signed in from Google. `in_progress`: the
    Worker profile is still signed in with Google and started this
    application before, so the posting offers Continue Application.
    `review`: the last step's title (a tenant may call it other than Review).
    `step_name_delay`: seconds each step's progress bar takes to show its
    steps, as when Workday re-renders the page. `ignored_clicks`: how many
    clicks on an auth form's button each page drops without sending it.
    `went_wrong`: how many times the first step shows Workday's "Something
    went wrong" page in place of its fields (Salesforce's, live).
    `flashes_error`: Save and Continue shows an error a moment before the next
    step (Adobe's, live).
    `drops_untouched`: a repeating section keeps only the entries changed on
    the step's visit (NVIDIA's, live).
    `dropped_saves`: how many clicks on Save and Continue each step loses, as
    when one lands while Workday disables the button a moment (Applied
    Materials', live). A click it takes disables the button while it saves.
    `review_delay`: seconds the Review step shows only a placeholder, and its
    Submit button, before its answers (NVIDIA's, live).
    `box_wiring`: seconds after a step shows before its checkboxes take a click.
    `to_sign_in`: Create Account makes the account and goes to a bare Sign
    In view, with no notice, as Workday's own code does on a success that
    says isLoginRedirect (Visa's, Northrop's, live). A tenant that verifies
    email goes there by way of its `/login/warning` page (Zillow's, Sonos's,
    live), which the Sign In view never shows. Create Account is answered in
    Workday's shape: `{"widget": "root"}` for an account made, `{"type":
    "ERROR", "message": ...}` for a refusal.
    `exists_quietly`: Create Account for an email that has an account goes
    to the bare Sign In view, with no error (ASML's, live). `hides_errors`:
    Create Account's refusal is in Workday's answer only, never on the page.
    `plain`: open each page in a plain Worker (Chrome for Testing driven by the worker
    extension, no CDP: tests/plain_fakes.py) in place of Playwright's Chromium; by default
    when $APPLY_TEST_PLAIN is set, so the same tests run on either."""

    def __init__(self, *forms: Path, keychain=None, mailbox: FakeMailbox | None = None,
                 verify_email: tuple[str, ...] = (), links_lost: bool = False,
                 accounts: dict[tuple[str, str], str] | None = None, google: str = "pick",
                 google_account: str = "test.person@example.com", steps=STEPS, google_delay: float = 0,
                 in_progress: bool = False, review: str = "Review", step_name_delay: float = 0,
                 ignored_clicks: int = 0, went_wrong: int = 0, review_delay: float = 0,
                 drops_untouched: bool = False, flashes_error: bool = False,
                 dropped_saves: int = 0, box_wiring: float = 0, to_sign_in: bool = False,
                 lost_picks: int = 0, exists_quietly: bool = False, hides_errors: bool = False,
                 plain: bool | None = None):
        self.plain = bool(os.environ.get("APPLY_TEST_PLAIN")) if plain is None else plain
        self._responses: dict[str, tuple[int, str, bytes]] = {}
        redirects: dict[str, str] = {}
        for form in forms:
            for entry in json.loads((form / "page.har").read_text())["log"]["entries"]:
                url, response = entry["request"]["url"], entry["response"]
                if response.get("redirectURL"):
                    redirects[url] = urljoin(url, response["redirectURL"])
                    continue
                content = response["content"]
                text = content.get("text", "")
                body = base64.b64decode(text) if content.get("encoding") == "base64" else text.encode()
                self._responses.setdefault(url, (response["status"], content.get("mimeType", ""), body))
        # A redirect is answered with where it leads.
        for url, target in redirects.items():
            if target in self._responses:
                self._responses.setdefault(url, self._responses[target])
        self._keychain = keychain
        self._mailbox = mailbox
        self._links_lost = links_lost
        self._google = google
        self._google_account = google_account
        self._google_delay = google_delay
        self._steps = steps
        self._in_progress = in_progress
        self._review = review
        self._step_name_delay = step_name_delay
        self._ignored_clicks = ignored_clicks
        self._went_wrong = went_wrong
        self._review_delay = review_delay
        self._drops_untouched = drops_untouched
        self._flashes_error = flashes_error
        self._dropped_saves = dropped_saves
        self._box_wiring = box_wiring
        self._to_sign_in = to_sign_in
        self._exists_quietly = exists_quietly
        self._hides_errors = hides_errors
        # How many of the first saves hold none of the step's dropdown picks, though the page shows them
        # (ASML's Application Questions, live): the step is refused as missing them.
        self._lost_picks = lost_picks
        self._lock = threading.Lock()
        self._tenants: dict[str, Tenant] = {}
        for host in verify_email:
            self._tenant(host).verify_email = True
        for (host, email), password in (accounts or {}).items():
            self._tenant(host).accounts[email] = {"password": password, "verified": True}
        self.created: list[dict] = []  # each account made: host, email, password, and what Keychain held then
        self.sign_ins: list[tuple[str, str, bool]] = []  # (host, email, accepted)
        self.resends = 0  # verification emails asked for again
        self.resets: list[dict] = []  # each password reset asked for: host, email, and what Keychain held then
        self._reset_links: dict[str, tuple[str, str]] = {}  # token -> (host, email)
        self.submissions: list[Submission] = []
        self.opened: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        if url in self._responses and body is None:
            return self._responses[url][2]
        raise LookupError(f"fake Workday has nothing saved at {url}")

    def _init_scripts(self) -> list[str]:
        """What every page runs first: the fake's settings and its stand-in for Workday's server."""
        return [f"window.__fakeIgnoredClicks = {self._ignored_clicks}",
                f"window.__fakeDropsUntouched = {str(self._drops_untouched).lower()}",
                f"window.__fakeFlashesError = {str(self._flashes_error).lower()}",
                f"window.__fakeDroppedSaves = {self._dropped_saves}",
                f"window.__fakeBoxWiring = {self._box_wiring}",
                f"window.__fakeHidesErrors = {str(self._hides_errors).lower()}",
                AUTH_SCRIPT, *([CONTINUE_SCRIPT] if self._in_progress else [])]

    @contextmanager
    def open(self, url: str, worker: int = 0):
        self.opened.append(url)
        if self.plain:
            from plain_fakes import fake_page

            with fake_page(self._handle, self._init_scripts(), url) as page:
                yield page
            return
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(service_workers="block")
            for script in self._init_scripts():
                context.add_init_script(script)
            context.route("**/*", self._handle)
            try:
                page = context.new_page()
                page.goto(url)
                yield page
            finally:
                browser.close()

    def saved(self, host: str) -> dict:
        """What the tenant at `host` saved of the application in progress, by field key."""
        tenant = self._tenant(host)
        return dict(tenant.saved.get((tenant.signed_in, tenant.posting), {}))

    def account(self, host: str, email: str) -> dict | None:
        return self._tenant(host).accounts.get(email)

    # --- Requests -----------------------------------------------------------------

    def _tenant(self, host: str) -> Tenant:
        with self._lock:
            return self._tenants.setdefault(host, Tenant())

    def _handle(self, route: Route) -> None:
        request = route.request
        # `copy=N` makes several Postings out of one saved posting; Workday's
        # code also passes the page's URL, encoded, inside its API queries.
        url = re.sub(r"([?&]|%3F|%26)copy(=|%3D)\d+", "", request.url)
        parts = urlsplit(url)
        host = parts.hostname or ""
        if parts.path.startswith("/__fake__/") and host.endswith(("myworkdayjobs.com", "myworkdaysite.com")):
            return self._fake(route, host, parts.path.removeprefix("/__fake__/"), parse_qs(parts.query))
        if re.match(r"wd\d+-identity\.myworkday\.com$", host) and "/authorize" in parts.path:
            # Workday's redirect to Google, as the Google button sends it.
            tenant = parse_qs(parts.query)["redirect_uri"][0]
            back = f"https://{urlsplit(tenant).hostname}/__fake__/sso?posting={quote(_posting(request.headers.get('referer', '')))}"
            return _page(route, f"<script>location.replace({json.dumps(f'{GOOGLE}/v3/signin/accountchooser?continue=' + quote(back))})</script>")
        if url.startswith(GOOGLE):
            return self._google_page(route, parts)
        if request.method == "GET" and url in self._responses:
            status, mime, body = self._responses[url]
            return route.fulfill(status=status, content_type=mime, body=body)
        route.abort()

    def _fake(self, route: Route, host: str, path: str, query: dict) -> None:
        tenant = self._tenant(host)
        body = route.request.post_data_json if route.request.method == "POST" else None
        if path == "register":
            made = self._create_account(host, tenant, body)
            if self._to_sign_in and "notice" in made:
                return route.fulfill(status=302, headers={"Location": f"https://{host}/__fake__/login/warning"})
            # Workday's shape: a refusal is a message of type ERROR; anything else is a root widget.
            shape = {"type": "ERROR", "message": made["error"]} if "error" in made else {"widget": "root"}
            return route.fulfill(json=made | shape)
        if path == "sign-in":
            return route.fulfill(json=self._sign_in(host, tenant, body))
        if path == "login/warning":
            return route.fulfill(json={"signIn": True})
        if path == "resend":
            self.resends += 1
            if not self._links_lost:
                self._send_link(host, body["email"])
            return route.fulfill(json={})
        if path == "forgot-password":
            return route.fulfill(json=self._forgot_password(host, body["email"]))
        if path == "reset":
            return _page(route, RESET_PAGE)
        if path == "reset-password":
            return route.fulfill(json=self._reset_password(host, body))
        if path == "verify":
            email = query["email"][0]
            tenant.accounts[email]["verified"] = True
            return _page(route, "<h2>Your account has been verified.</h2><p>Sign in to continue your application.</p>")
        if path == "continue":
            tenant.signed_in, tenant.posting = self._google_account, _posting(query["posting"][0])
            return _page(route, "<script>location.replace('/__fake__/apply/1')</script>")
        if path == "sso":
            tenant.signed_in, tenant.posting = self._google_account, query["posting"][0]
            # Workday takes its time to come back from Google (25 s seen live on Snap's tenant).
            return _page(route, f"<script>setTimeout(() => location.replace('/__fake__/apply/1'), {self._google_delay * 1000})</script>")
        if m := re.fullmatch(r"apply/(\d+)", path):
            step = int(m[1])
            if not tenant.signed_in:
                return _page(route, "<h2>Your session has expired. Sign in again.</h2>")
            if route.request.method == "POST":
                return route.fulfill(json=self._save_step(host, tenant, step, body))
            return _page(route, self._step_page(tenant, step))
        if path == "done":
            return _page(route, "<h2>Application Submitted</h2><p>Congratulations! Your application has been submitted.</p>")
        route.abort()

    def _create_account(self, host: str, tenant: Tenant, form: dict) -> dict:
        email, password = form["email"], form["password"]
        if not (email and password):
            return {"error": "Email Address and Password are required."}
        if form["accepted"] is False:
            return {"error": "Accept: You must accept the terms."}
        if password != form["verify"]:
            return {"error": "The passwords do not match."}
        if email in tenant.accounts:
            if self._exists_quietly:
                return {"signIn": True}  # back to Sign In, and no word of the account it has
            return {"error": "An account with this email address already exists."}
        kept = self._keychain.password(host) if self._keychain else None
        self.created.append({"host": host, "email": email, "password": password, "keychain": kept})
        tenant.accounts[email] = {"password": password, "verified": not tenant.verify_email}
        if tenant.verify_email:
            if not self._links_lost:
                self._send_link(host, email)
            return {"notice": f"A verification email was sent to {email}. Click the link in it to verify your account."}
        if self._to_sign_in:
            return {"signIn": True}  # made, and back to Sign In to sign in with it
        tenant.signed_in, tenant.posting = email, _posting(form["page"])
        return {"next": "/__fake__/apply/1"}

    def _sign_in(self, host: str, tenant: Tenant, form: dict) -> dict:
        email, password = form["email"], form["password"]
        if not (email and password):  # Workday's own form checks this before sending
            return {"error": "Email Address and Password are required."}
        account = tenant.accounts.get(email)
        accepted = bool(account) and account["password"] == password
        self.sign_ins.append((host, email, accepted))
        if not accepted:
            return {"error": "Wrong email address or password. Please try again."}
        if not account["verified"]:
            return {"error": "Your account has not been verified. Check your email for the verification link."}
        tenant.signed_in, tenant.posting = email, _posting(form["page"])
        return {"next": "/__fake__/apply/1"}

    def _forgot_password(self, host: str, email: str) -> dict:
        kept = self._keychain.password(host) if self._keychain else None
        self.resets.append({"host": host, "email": email, "keychain": kept})
        if email in self._tenant(host).accounts and not self._links_lost:
            token = f"t{len(self._reset_links) + 1}"
            self._reset_links[token] = (host, email)
            self._mailbox.deliver(MAIL_SEARCH, link=f"https://{host}/__fake__/reset?token={token}")
        return {"notice": "If an account exists for this email address, we've sent an email with a link to reset the password."}

    def _reset_password(self, host: str, form: dict) -> dict:
        if self._reset_links.get(form["token"], ("", ""))[0] != host:
            return {"error": "This link has expired. Request a new one."}
        if not form["password"] or form["password"] != form["verify"]:
            return {"error": "The passwords do not match."}
        _, email = self._reset_links.pop(form["token"])
        self._tenant(host).accounts[email]["password"] = form["password"]
        return {"notice": "Your password has been reset. Sign in with your new password."}

    def _send_link(self, host: str, email: str) -> None:
        self._mailbox.deliver(MAIL_SEARCH, link=f"https://{host}/__fake__/verify?email={quote(email)}")

    def _save_step(self, host: str, tenant: Tenant, step: int, values: dict) -> dict:
        """Step n (from 1) is self._steps[n - 1]; the one after the last is Review."""
        saved = tenant.saved.setdefault((tenant.signed_in, tenant.posting), {})
        if step > len(self._steps):  # Review: Submit
            application = {k: (v["name"] if isinstance(v, dict) else v) for k, v in saved.items()}
            files = {k: base64.b64decode(v["b64"]) for k, v in saved.items() if isinstance(v, dict)}
            self.submissions.append(Submission(tenant.posting, application, files))
            return {"next": "/__fake__/done"}
        _, fields = self._steps[step - 1]
        for f in fields:  # a file attached on an earlier visit stays attached
            if isinstance(f, Field) and f.kind == "file" and values.get(f.key) is None and saved.get(f.key):
                values[f.key] = saved[f.key]
        if self._lost_picks:
            self._lost_picks -= 1
            values = {k: ("" if any(isinstance(f, Field) and f.key == k and f.kind == "dropdown" for f in fields) else v)
                      for k, v in values.items()}
        missing = []
        for f in fields:
            if isinstance(f, Section):
                panels = values.get(f.key) or []
                missing += [f.title] if f.required and not panels else []
                missing += [f"{f.title} {n}: {g.label}" for n, panel in enumerate(panels, 1)
                            for g in f.fields if g.required and panel.get(g.key) in EMPTY]
            elif f.required and values.get(f.key) in EMPTY and (not f.shown_if or values.get(f.shown_if[0]) == f.shown_if[1]):
                missing.append(f.label)
        if missing:
            return {"errors": [f"{label}: The field {label} is required and must have a value." for label in missing]}
        saved.update(values)
        return {"next": f"/__fake__/apply/{step + 1}"}

    # --- Pages --------------------------------------------------------------------

    def _step_page(self, tenant: Tenant, step: int) -> str:
        titles = ["Create Account/Sign In"] + [title for title, _ in self._steps] + [self._review]
        bar = "".join(
            f'<li data-automation-id="progressBar{"Active" if n == step + 1 else "Completed" if n < step + 1 else "Inactive"}Step">'
            f"<label>{'current ' if n == step + 1 else ''}step {n} of {len(titles)}</label><label>{html.escape(t)}</label></li>"
            for n, t in enumerate(titles, 1)
        )
        saved = tenant.saved.get((tenant.signed_in, tenant.posting), {})
        if step == 1 and self._went_wrong:
            self._went_wrong -= 1
            # The auth form's email box lingers, hidden, above the error (seen live).
            return (f'<ol data-automation-id="progressBar">{bar}</ol>'
                    '<div data-automation-id="formField-email" hidden><input type="text"></div>'
                    "<h2>Something went wrong</h2><p>Please refresh the page and then try again.</p>")
        if step > len(self._steps):
            fields_html = "".join(
                f"<p><b>{html.escape(label)}</b> {html.escape(str(_shown(value)))}</p>"
                for _, fields in self._steps for f in fields for label, value in _review_rows(f, saved.get(f.key))
            )
            footer = "Submit"
        else:
            fields_html = "".join(_field_html(f, saved.get(f.key)) for f in self._steps[step - 1][1])
            footer = "Save and Continue"
        return (
            '<div data-automation-id="applyFlowPage"><h2 data-automation-id="jobTitleHeading">Application</h2>'
            + (f'<ol data-automation-id="progressBar">{bar}</ol>' if not self._step_name_delay else
               f'<ol data-automation-id="progressBar"></ol><template id="bar">{bar}</template>'
               "<script>setTimeout(() => document.querySelector('[data-automation-id=progressBar]')"
               f".append(document.getElementById('bar').content), {self._step_name_delay * 1000})</script>")
            + '<div data-automation-id="errorHeading" hidden></div>'
            + f"<h2>{html.escape(titles[step])}</h2>"
            + (_later(f'<div data-automation-id="applyFlowReviewPage">{fields_html}</div>', self._review_delay)
               if step > len(self._steps) else f"<form onsubmit='return false'>{fields_html}</form>")
            + '<div data-automation-id="pageFooter"><button data-automation-id="pageFooterBackButton">Back</button>'
            f'<button type="button" data-automation-id="pageFooterNextButton">{footer}</button></div>'
            f"</div><script>{STEP_SCRIPT}</script>"
            # Back goes to the step before, as it saved it (none before the first)
            + (f"<script>document.querySelector('[data-automation-id=pageFooterBackButton]').addEventListener('click', "
               f"() => {{ location.href = '/__fake__/apply/{step - 1}'; }})</script>" if step > 1 else "")
        )

    def _google_page(self, route: Route, parts) -> None:
        query = parse_qs(parts.query)
        if parts.path == "/v3/signin/accountchooser":
            if self._google == "auto":  # one signed-in account that consented before: straight back
                return _page(route, f"<script>location.replace({json.dumps(query['continue'][0])})</script>")
            if self._google == "password":
                after = f"{GOOGLE}/v3/signin/challenge/pwd"
            elif self._google == "passkey":
                after = f"{GOOGLE}/v3/signin/challenge/pk"
            elif self._google == "rejected":
                after = f"{GOOGLE}/v3/signin/rejected"
            else:
                after = query["continue"][0]
            account = html.escape(self._google_account)
            return _page(route, (
                "<h1>Choose an account</h1><ul>"
                f'<li><div role="link" tabindex="0" data-identifier="{account}" data-next="{html.escape(after)}">'
                f"<div>Test Person</div><div>{account}</div></div></li>"
                '<li><div role="link">Use another account</div></li></ul>'
                f"<script>{CHOOSER_SCRIPT}</script>"
            ))
        if parts.path == "/v3/signin/rejected":  # seen live (KLA, 2026-11-03)
            return _page(route, "<h1>Couldn't sign you in</h1><p>This browser or app may not be secure.</p>"
                                '<button type="button">Try again</button>')
        if parts.path == "/v3/signin/challenge/pk":  # seen live (KLA, 2026-11-03): no box to type in
            return _page(route, "<h1>Welcome</h1><p>Verifying it's you...</p><p>Complete sign-in using your passkey</p>"
                                '<button type="button">Try another way</button>')
        if parts.path == "/v3/signin/challenge/pwd":
            return _page(route, '<h1>Welcome</h1><form><input type="password" name="Passwd" aria-label="Enter your password"></form>')
        route.abort()


def _posting(page: str) -> str:
    """The Posting an apply-flow page belongs to: its URL up to /apply, and its copy number."""
    parts = urlsplit(page)
    copy = re.search(r"copy=\d+", parts.query)
    return re.sub(r"/apply(/.*)?$", "", parts._replace(query="", fragment="").geturl()) + (f"?{copy[0]}" if copy else "")


def _shown(value) -> str:
    if isinstance(value, dict):
        return value["name"]
    if isinstance(value, list):
        return ", ".join(value)
    if value is True:
        return "Yes"
    return value or ""


def _later(content: str, delay: float) -> str:
    """`content`, shown `delay` seconds after the page loads (at once if 0)."""
    if not delay:
        return content
    return (f'<div id="later"></div><template id="content">{content}</template>'
            "<script>setTimeout(() => document.getElementById('later')"
            f".replaceWith(document.getElementById('content').content), {delay * 1000})</script>")


def _review_rows(f: "Field | Section", value) -> list[tuple[str, object]]:
    if isinstance(f, Field):
        return [(f.label, value)]
    return [(f"{f.title} {n} {g.label}", panel.get(g.key)) for n, panel in enumerate(value or [], 1) for g in f.fields]


def _section_html(s: Section, panels: list[dict] | None) -> str:
    def panel(n: str, number: int, values: dict) -> str:
        return (f'<div role="group" aria-labelledby="{s.key}-{n}-panel" data-fake-panel>'
                f'<h4 id="{s.key}-{n}-panel">{html.escape(s.title)} {number}</h4>'
                '<button type="button" data-automation-id="panel-set-delete-button">Delete</button>'
                + "".join(_field_html(f, values.get(f.key), f"{s.key}-{n}--") for f in s.fields) + "</div>")

    shown = panels if panels is not None else [{}] * s.panels
    return (f'<div role="group" aria-labelledby="{s.key}-section" data-fake-section="{s.key}">'
            f'<h3 id="{s.key}-section">{html.escape(s.title)}</h3>'
            f'<div data-fake-panels>{"".join(panel(str(n), n, v) for n, v in enumerate(shown, 1))}</div>'
            f"<template>{panel('__N__', 0, {})}</template>"
            f'<button type="button" data-automation-id="add-button">{"Add Another" if shown else "Add"}</button></div>')


def _field_html(f: "Field | Section", value, prefix: str = "") -> str:
    if isinstance(f, Section):
        return _section_html(f, value)
    if f.intro:
        return (f'<div data-automation-id="richText"><p>{html.escape(f.intro)}</p></div>'
                + _field_html(replace(f, intro=""), value, prefix))
    if f.group:
        heading = f"{prefix}{f.key}-group"
        return (f'<div role="group" aria-labelledby="{heading}"><h4 id="{heading}">{html.escape(f.group)}</h4>'
                f"{_field_html(replace(f, group=''), value, prefix)}</div>")
    star = '<abbr title="required">*</abbr>' if f.required else ""
    key = prefix + f.key  # the element ids; the formField-* container keeps the field's own key
    label = f'<label for="{key}">{html.escape(f.label)}{star}</label>'
    attrs = f'data-automation-id="formField-{f.key}" data-kind="{f.kind}"' + (
        f" data-shown-if='{html.escape(json.dumps(f.shown_if))}' style='display:none'" if f.shown_if else "")
    esc = html.escape
    if f.kind in ("text", "textarea"):
        tag = (f'<textarea id="{key}">{esc(value or "")}</textarea>' if f.kind == "textarea"
               else f'<input type="text" id="{key}" aria-required="{str(f.required).lower()}" value="{esc(value or "")}">')
        return f"<div {attrs}>{label}<div>{tag}</div></div>"
    if f.kind == "dropdown":
        return (f"<div {attrs}>{label}<div><button type='button' id='{key}' aria-haspopup='listbox' "
                f"value='{esc(value or '')}' data-options='{esc(json.dumps(f.options))}' data-slow='{f.slow}'>"
                f"{esc(value or 'Select One')}</button></div></div>")
    if f.kind in ("radio", "checkboxes"):
        kind = "radio" if f.kind == "radio" else "checkbox"
        chosen = value if isinstance(value, list) else [value]
        boxes = "".join(
            f'<div><input type="{kind}" id="{key}-{i}" name="{key}" value="{esc(o)}"{" checked" if o in chosen else ""}'
            + (f' aria-checked="{str(o in chosen).lower()}">' if kind == "checkbox" else ">")
            +
            f'<label for="{key}-{i}">{esc(o)}</label></div>'
            for i, o in enumerate(f.options)
        )
        return f"<div {attrs}><fieldset><legend><label>{esc(f.label)}{star}</label></legend>{boxes}</fieldset></div>"
    if f.kind == "checkbox":
        return (f'<div {attrs}><div><input type="checkbox" id="{key}"{" checked" if value else ""} aria-checked="{str(bool(value)).lower()}">'
                f'{label}</div></div>')
    if f.kind == "prompt":
        return (f"<div {attrs}>{label}<div data-automation-id='multiselectInputContainer'>"
                "<ul role='listbox' aria-label='items selected' data-automation-id='selectedItemList'></ul>"
                + (f"<input id='{key}' data-prompt='1' placeholder='Search' " if f.bare else
                   f"<input type='text' id='{key}' data-automation-id='searchBox' placeholder='Search' ")
                + ("data-search='1' " if f.search else "") + ("data-opens-empty='1' " if f.opens_empty else "")
                + ("data-many='1' " if f.many else "") + (f"data-lost='{f.lost}' " if f.lost else "")
                + (f"data-tree='{esc(json.dumps(f.tree))}' " if f.tree else "") +
                f"data-options='{esc(json.dumps(f.options))}' data-selected='{esc(json.dumps(value or list(f.chosen)))}'></div></div>")
    if f.kind == "file":
        shown = (f'<div data-automation-id="file-upload-item"><div data-automation-id="file-upload-item-name">{esc(value["name"])}</div></div>'
                 if value else "")
        return (f"<div {attrs}>{label}<div data-automation-id='attachments-FileUpload'>"
                f"<input type='file' id='{key}' data-automation-id='file-upload-input-ref' multiple>"
                f"<div data-automation-id='file-upload-item-list'>{shown}</div></div></div>")
    if f.kind == "date":
        parts = dict(zip(f.format.split("/"), (value or "").split("/"))) if value else {}
        names = {"MM": ("Month", "dateSectionMonth"), "DD": ("Day", "dateSectionDay"), "YYYY": ("Year", "dateSectionYear")}
        inputs = "".join(
            f'<input type="text" role="spinbutton" id="{key}{"" if i == 0 else f"-{part}"}" data-automation-id="{names[part][1]}-input" '
            f'aria-label="{names[part][0]}" placeholder="{part}" value="{esc(parts.get(part, ""))}" '
            f'data-held="{esc(parts.get(part, ""))}">'
            for i, part in enumerate(f.format.split("/")))
        return f"<div {attrs}>{label}<div data-automation-id='dateInputWrapper'>{inputs}</div></div>"
    raise ValueError(f.kind)


def _page(route: Route, body: str) -> None:
    route.fulfill(content_type="text/html", body=f"<!doctype html><meta charset='utf-8'><body>{body}</body>")
