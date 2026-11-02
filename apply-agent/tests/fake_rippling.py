"""A fake Rippling: answers the public job API from saved responses and serves
a form built like Rippling's own (checked live 2026-10-16: the same
data-testid hooks, dropdowns, radios, checkboxes, phone and location widgets,
and the text-message consent under every form's questions)
to a headless browser. A field the page rejects shows "This field is required"
under its box, as Rippling's does (its input aria-invalid). Attaching a résumé asks the fake's parser, which fills
the contact fields the way Rippling's does, a moment later. Nothing here
touches the network. Implements the JobSite adapter."""

import json
import re
from contextlib import contextmanager
from pathlib import Path

from fakes import Submission
from playwright.sync_api import Route, sync_playwright

API = re.compile(r"https://ats\.rippling\.com/api/v1/board/([^/]+)/jobs/([0-9a-f-]{36})")
# What the fake parser reads from any résumé.
PARSED = {"first_name": "Parsed", "last_name": "Person", "email": "parsed@example.com",
          "phone_number": "5550001111", "linkedin_link": "https://linkedin.com/in/parsed",
          "website_link": "https://parsed.example.com", "current_company": "Parsed Co", "location": ""}
# The fake geocoder's cities.
PLACES = ["Woodbury, NY, USA", "Woodbury, MN, USA", "Woodbury, NJ, USA", "Stony Brook, NY, USA"]
EEOC = {
    "eeoc.gender": ("Gender", ["Male", "Female", "Non-binary", "Choose not to disclose"], False),
    "eeoc.race": ("Please identify your race", [
        "American Indian or Alaskan Native", "Asian", "Black or African American", "Middle Eastern or North African",
        "White", "Native Hawaiian or other Pacific Islander", "Two or more races", "Choose not to disclose"], True),
    "eeoc.hispanicOrLatino": ("Are you Hispanic/Latino?", ["Yes", "No", "Choose not to disclose"], False),
    "eeoc.veteranStatus": ("Veteran Status", [
        "I am not a protected veteran", "I identify as one or more of the classifications of a protected veteran",
        "Choose not to disclose"], False),
}
PRONOUNS = ["She/her/hers", "He/him/his", "They/them/theirs", "She/her/hers, they/them/theirs",
            "He/him/his, they/them/theirs", "Just use my name", "Enter my pronouns"]

LANDING = """<!doctype html><html><body><h1>%(title)s</h1>
<button onclick="location.href = location.pathname + '/apply?step=application'">Apply now</button></body></html>"""

FORM = """<!doctype html><html><head><meta charset="utf-8"><style>
[role=listbox] { border: 1px solid #ccc } [role=option] { padding: 2px }
</style></head><body><h1>Application: %(title)s</h1><form id="form"></form>
<button data-testid="Apply" type="submit" form="form">Apply</button>
<script>
const PARSE_DELAY = %(parse_delay)d, PARSE_SETTLES = %(parse_settles)d, REJECTS = %(rejects)s, TURNSTILE = %(turnstile)s, JOB = %(job)s, PARSED = %(parsed)s, PLACES = %(places)s, EEOC = %(eeoc)s, PRONOUNS = %(pronouns)s;
const form = document.getElementById('form');
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let ids = 0;
function field(label, inner) {
  const f = el(`<div data-testid="field"><span id="f${++ids}-label">${esc(label)}</span><div></div></div>`);
  f.lastChild.appendChild(inner);
  form.appendChild(f);
  return inner;
}
function listbox(anchor, options, pick) {
  document.querySelectorAll('[role=listbox]').forEach(l => l.remove());
  const list = el('<div role="listbox"></div>');
  for (const o of options) {
    const opt = el(`<div role="option">${esc(o)}</div>`);
    opt.addEventListener('click', () => { pick(o); list.remove(); });
    list.appendChild(opt);
  }
  anchor.after(list);
}
function dropdown(key, label, options) {  // a div combobox showing its pick
  const box = field(label, el(`<div data-testid="${key}"><div data-testid="select-controller">`
    + `<div role="combobox" tabindex="0" aria-label="Select"><p>Select</p></div></div></div>`));
  const cb = box.querySelector('[role=combobox]');
  cb.addEventListener('click', () => listbox(cb, options, o => { cb.textContent = o; }));
}
function searchable(key, label, options) {  // an input combobox: the pick shows as its value
  const box = field(label, el(`<div data-testid="${key}"><div data-testid="select-controller">`
    + `<input role="combobox" data-input="select-search-input" placeholder="Select..."></div></div>`));
  const cb = box.querySelector('input');
  cb.addEventListener('click', () => listbox(cb, options, o => { cb.value = o; }));
}
function choices(key, label, options, role) {
  const group = field(label, el(`<div data-testid="${key}" role="${role === 'radio' ? 'radiogroup' : 'group'}"></div>`));
  for (const o of options) {
    const c = el(`<div role="${role}" data-value="${esc(o)}" aria-checked="false" tabindex="0"><p>${esc(o)}</p></div>`);
    c.addEventListener('click', () => {
      if (role === 'radio') group.querySelectorAll('[role=radio]').forEach(r => r.setAttribute('aria-checked', 'false'));
      c.setAttribute('aria-checked', role === 'radio' || c.getAttribute('aria-checked') === 'false' ? 'true' : 'false');
    });
    group.appendChild(c);
  }
}
function upload(key, label, parses) {
  const box = field(label, el(`<label data-testid="${key}"><input type="file" data-testid="input-${key}"><div class="shown"></div></label>`));
  box.querySelector('input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const shown = box.querySelector('.shown');
    shown.innerHTML = `<div data-testid="chip">${esc(file.name.slice(0, 15))}...pdf</div>`
      + `<div data-testid="screen-reader-only" role="status">File ${esc(file.name)} uploaded successfully</div>`;
    if (!parses) return;
    await new Promise(r => setTimeout(r, PARSE_DELAY));  // the upload, then the parse
    const parsed = await (await fetch(location.pathname.replace(/^\\/([^/]+)\\/jobs\\/([^/]+).*/,
      '/api/v1/board/$1/jobs/$2/parse_resume'), {method: 'POST', body: JSON.stringify({name: file.name})})).json();
    await new Promise(r => setTimeout(r, PARSE_SETTLES));  // the parsed answers into the fields
    for (const [k, v] of Object.entries(parsed)) {
      const input = document.querySelector(`[data-input="${k}"]`);
      if (input) input.value = k === 'phone_number' ? formatPhone(v) : v;
      if (k === 'location' && !v) {  // Rippling's parse empties Location (seen live 2026-10-16)
        document.querySelector('[data-testid="location"] input').value = '';
        reject('location');
      }
    }
    document.body.appendChild(el('<div role="status"><p>Résumé parsing was successful.</p></div>'));
  });
}
function reject(key) {  // as Rippling marks a required field it holds no value for
  const box = document.querySelector(`[data-testid="${key}"]`);
  box.querySelector('input').setAttribute('aria-invalid', 'true');
  box.closest('[data-testid=field]').lastChild.appendChild(el('<span>This field is required</span>'));
}
function accept(key) {
  const box = document.querySelector(`[data-testid="${key}"]`);
  box.querySelector('input').removeAttribute('aria-invalid');
  box.closest('[data-testid=field]').querySelectorAll('span').forEach(s => { if (s.textContent === 'This field is required') s.remove(); });
}
const formatPhone = (v) => { const d = v.replace(/\\D/g, ''); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d; };
const app = JOB.activeJobApplication;
for (const q of app.basicQuestions) {
  if (q.fieldType === 'FILE') upload(q.oid, q.title, q.oid === 'resume');
  else if (q.fieldType === 'PRONOUN') searchable('pronouns_strategy', 'Pronouns', PRONOUNS);
  else if (q.fieldType === 'PHONE_NUMBER') {
    field('', el('<div data-testid="phone_number-code"><div role="combobox">+1 US</div></div>'));
    const input = field(q.title, el('<div data-testid="phone_number"><input data-input="phone_number" inputmode="tel"></div>')).querySelector('input');
    input.addEventListener('blur', () => { input.value = formatPhone(input.value); });
  } else if (q.oid === 'location') {
    const input = field('Location', el('<div data-testid="location"><input aria-autocomplete="list" aria-haspopup="listbox"></div>')).querySelector('input');
    input.addEventListener('input', () => {
      const city = input.value.split(',')[0].trim().toLowerCase();
      setTimeout(() => listbox(input, PLACES.filter(p => city && p.toLowerCase().startsWith(city)), p => {
        input.value = p;
        if (REJECTS.includes('location')) reject('location'); else accept('location');
      }), 300);
    });
  } else field(q.title, el(`<div data-testid="${q.oid}"><input data-input="${q.oid}"></div>`));
}
for (const section of app.additionalQuestions) for (const q of section.form.questions) {
  const key = `customQuestions.${section.id}.${q.uniqueKey}`;
  if (q.questionType === 'KNOCKOUT') dropdown(key, q.title, q.strChoices);
  else if (q.questionType === 'SINGLE_SELECT_RADIO') choices(key, q.title, q.strChoices, 'radio');
  else if (q.questionType === 'MULTI_SELECT_CHECKBOX') choices(key, q.title, q.strChoices, 'checkbox');
  else if (q.questionType === 'LONG_ANSWER') field(q.title, el(`<div data-testid="${key}"><textarea></textarea></div>`));
  else if (q.questionType === 'DOCUMENT_UPLOAD') upload(key, q.title, false);
  else field(q.title, el(`<div data-testid="${key}"><input data-input="${key}"></div>`));
}
if (JOB.eeocQuestionnaireEnabled) for (const [key, [label, options, search]] of Object.entries(EEOC))
  (search ? searchable : dropdown)(key, label, options);
{  // the text-message consent under every form's questions; its radios' values are booleans
  const group = field(`Check Yes or No to indicate your agreement to receive text message updates from ${JOB.companyName} regarding your job application.`,
                      el('<div data-testid="sms_opt_in" role="radiogroup"></div>'));
  for (const [value, label] of [['true', 'Yes - I consent to receiving text messages'], ['false', 'No - I do not consent to receiving text messages']]) {
    const c = el(`<div data-testid="radio-label-sms_opt_in" role="radio" data-value="${value}" aria-checked="false" tabindex="-1"><p>${label}</p></div>`);
    c.addEventListener('click', () => {
      group.querySelectorAll('[role=radio]').forEach(r => r.setAttribute('aria-checked', 'false'));
      c.setAttribute('aria-checked', 'true');
    });
    group.appendChild(c);
  }
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (TURNSTILE) {  // Cloudflare can't tell: it asks the visitor to prove they're human
    form.after(el('<div data-testid="TurnstileContainer"><iframe src="about:blank" title="Widget containing a Cloudflare security challenge"></iframe></div>'));
    return;
  }
  const values = {};
  form.querySelectorAll('input:not([type=file]), textarea').forEach((i, n) => { values[i.closest('[data-testid]:not([data-testid=select-controller])')?.dataset.testid ?? n] = i.value; });
  form.querySelectorAll('[role=combobox]:not(input)').forEach(c => { values[c.closest('[data-testid]:not([data-testid=select-controller])').dataset.testid] = c.textContent; });
  form.querySelectorAll('[aria-checked=true]').forEach(c => { values[c.parentElement.dataset.testid] = c.dataset.value; });
  await fetch(location.pathname.replace(/\\/apply$/, '').replace(/^\\/([^/]+)\\/jobs\\/([^/]+)/, '/api/v1/board/$1/jobs/$2/apply'),
              {method: 'POST', body: JSON.stringify(values)});
  location.href = location.pathname + '?step=confirmation';
});
</script></body></html>"""

CONFIRMATION = "<!doctype html><html><body><h1>You have successfully applied to %(title)s</h1></body></html>"


class FakeRipplingServer:
    """Serves saved Rippling Postings (each folder holds the job API's job.json).
    Every request it has no answer for is refused. `parse_delay` is how long
    the résumé parser takes, in ms, and `parse_settles` how long the page then
    takes to put in what it parsed; `rejects` names fields the page marks
    required however they are filled; `turnstile` makes Cloudflare's Turnstile
    challenge the visitor at the submit click."""

    def __init__(self, *forms: Path, parse_delay: int = 1500, parse_settles: int = 0, turnstile: bool = False,
                 rejects: tuple[str, ...] = ()):
        self._jobs: dict[str, dict] = {}
        for form in forms:
            job = json.loads((form / "job.json").read_text())
            self._jobs[job["url"]] = job
        self._parse_delay = parse_delay
        self._parse_settles = parse_settles
        self._turnstile = turnstile
        self._rejects = list(rejects)
        self.parsed: list[str] = []  # the name of every résumé parsed
        self.submissions: list[Submission] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        m = API.fullmatch(url)
        job = m and self._jobs.get(f"https://ats.rippling.com/{m[1]}/jobs/{m[2]}")
        if body is None and job:
            return json.dumps(job).encode()
        raise LookupError(f"fake Rippling has nothing saved at {url}")

    @contextmanager
    def open(self, url: str, worker: int = 0):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(service_workers="block")
            context.route("**/*", self._handle)
            try:
                page = context.new_page()
                page.goto(url)
                yield page
            finally:
                browser.close()

    def _handle(self, route: Route) -> None:
        request = route.request
        url = request.url.split("?")[0]
        if m := re.fullmatch(API.pattern + r"/(parse_resume|apply)", url):
            if request.method != "POST":
                return route.abort()
            if m[3] == "parse_resume":
                self.parsed.append(json.loads(request.post_data)["name"])
                return route.fulfill(json=PARSED)
            self.submissions.append(Submission(url=url, application=json.loads(request.post_data)))
            return route.fulfill(status=204)
        job = next((j for u, j in self._jobs.items() if url == u or url.startswith(u + "/apply")), None)
        if request.method != "GET" or not job:
            return route.abort()
        if "step=confirmation" in request.url:
            return route.fulfill(content_type="text/html", body=CONFIRMATION % {"title": job["name"]})
        if url == job["url"]:
            return route.fulfill(content_type="text/html", body=LANDING % {"title": job["name"]})
        return route.fulfill(content_type="text/html", body=FORM % {
            "title": job["name"], "parse_delay": self._parse_delay, "parse_settles": self._parse_settles, "rejects": json.dumps(self._rejects), "turnstile": json.dumps(self._turnstile), "job": json.dumps(job), "parsed": json.dumps(PARSED), "places": json.dumps(PLACES),
            "eeoc": json.dumps(EEOC), "pronouns": json.dumps(PRONOUNS)})
