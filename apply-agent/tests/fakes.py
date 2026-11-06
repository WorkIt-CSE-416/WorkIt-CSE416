"""Fakes for every outside system, used by both test seams. Nothing here touches the network."""

import base64
import http.server
import json
import re
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from email.parser import BytesParser
from email.policy import default as email_policy
from pathlib import Path

from playwright.sync_api import Route, sync_playwright

from apply import answering, fill_engine, gates
from apply.adapters import Drive, UsageReading
from apply.gmail import MailedCode, on_hosts
from apply.model import Question

# Greenhouse loads reCAPTCHA Enterprise and asks it for a token at submit.
# Ashby's GraphQL endpoint, and the query its page (and the engine) reads a Question set with.
ASHBY_GRAPHQL = "https://jobs.ashbyhq.com/api/non-user-graphql"
ASHBY_QUESTION_SET_URL = f"{ASHBY_GRAPHQL}?op=ApiJobPosting"
RECAPTCHA_STUB = (
    "window.grecaptcha={enterprise:{ready:function(cb){cb()},"
    "execute:function(){return Promise.resolve('fake-recaptcha-token')},"
    "render:function(){return 0},reset:function(){}}};"
)
# The same, when reCAPTCHA doubts the browser: asked for a token, it shows its
# picture challenge and never answers.
RECAPTCHA_CHALLENGE_STUB = (
    "window.grecaptcha={enterprise:{ready:function(cb){cb()},"
    "execute:function(){var f=document.createElement('iframe');"
    "f.src='https://www.google.com/recaptcha/enterprise/bframe?k=fake';f.title='recaptcha challenge expires in two minutes';"
    "f.style.cssText='width:400px;height:580px';document.body.appendChild(f);return new Promise(function(){})},"
    "render:function(){return 0},reset:function(){}}};"
)
# The same challenge, solved 1.5 s after it shows (as when Lisul does it): then reCAPTCHA gives its token.
RECAPTCHA_SOLVED_STUB = (
    "window.grecaptcha={enterprise:{ready:function(cb){cb()},"
    "execute:function(){var f=document.createElement('iframe');"
    "f.src='https://www.google.com/recaptcha/enterprise/bframe?k=fake';"
    "f.style.cssText='width:400px;height:580px';document.body.appendChild(f);"
    "return new Promise(function(done){setTimeout(function(){f.remove();done('fake-recaptcha-token')},1500)})},"
    "render:function(){return 0},reset:function(){}}};"
)
CONFIRMATION = "<!doctype html><title>Thank you</title><h1>Thank you for applying.</h1>"

# Drops the last character typed into one field, the way a flaky widget
# silently loses input.
GARBLE = """
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id !== %s || el.dataset.garbled) return;
  el.dataset.garbled = '1';
  setTimeout(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, el.value.slice(0, -1));
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }, 0);
}, true);
"""


class Killed(BaseException):
    """The run's process dying, as when the Mac shuts down or Apply crashes."""


@dataclass
class Submission:
    """What a job system would have received when an Application was submitted."""

    url: str
    application: dict
    files: dict[str, bytes] = field(default_factory=dict)


@dataclass
class _Form:
    url: str
    submit_url: str
    questions_url: str
    questions: bytes
    responses: dict[str, tuple[int, str, bytes]]


@dataclass
class _AshbyForm:
    """A saved Ashby form. Ashby saves each answer on its server as it is typed
    (ApiSetFormValue), and the submit only names the forms to submit."""

    job_id: str
    questions: bytes
    responses: dict[tuple[str, str], tuple[int, str, bytes]]  # (url, variables) -> response
    renders: dict[str, dict]  # FormRender id -> the saved FormRender
    values: dict[str, dict] = field(default_factory=dict)  # FormRender id -> {path: value}

    def render(self, render_id: str) -> dict:
        """The FormRender with every saved answer in it, as Ashby returns it after a save."""
        render = json.loads(json.dumps(self.renders[render_id]))
        values = self.values.get(render_id, {})
        for section in render["sections"]:
            for entry in section["fieldEntries"]:
                if entry["field"]["path"] in values:
                    entry["fieldValue"] = values[entry["field"]["path"]]
        return render


def _query_key(url: str, body: dict) -> tuple[str, str]:
    return url, json.dumps(body.get("variables"), sort_keys=True)


def _load_form(folder: Path) -> "_Form | _AshbyForm":
    har = json.loads((folder / "page.har").read_text())
    if "ashbyhq.com" in har["log"]["entries"][0]["request"]["url"]:
        return _load_ashby_form(folder, har)
    responses = {}
    for entry in har["log"]["entries"]:
        content = entry["response"]["content"]
        text = content.get("text", "")
        body = base64.b64decode(text) if content.get("encoding") == "base64" else text.encode()
        responses.setdefault(entry["request"]["url"], (entry["response"]["status"], content["mimeType"], body))
    url = har["log"]["entries"][0]["request"]["url"]
    job_of = fill_engine.job_of(url)  # a hosted page, or the embedded form
    board, job = job_of["board"], job_of["job"]
    return _Form(
        url=url,
        submit_url=f"https://boards.greenhouse.io/{board}/jobs/{job}",
        questions_url=f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job}?questions=true",
        questions=(folder / "questions.json").read_bytes(),
        responses=responses,
    )


def _load_ashby_form(folder: Path, har: dict) -> _AshbyForm:
    responses, renders = {}, {}
    for entry in har["log"]["entries"]:
        request, content = entry["request"], entry["response"]["content"]
        body = content.get("text", "")
        body = base64.b64decode(body) if content.get("encoding") == "base64" else body.encode()
        if request["method"] == "POST":
            query = json.loads(request["postData"]["text"])
            key = _query_key(request["url"], query)
            if query["operationName"] == "ApiJobPosting":
                posting = json.loads(body)["data"]["jobPosting"]
                for render in [posting["applicationForm"], *posting["surveyForms"]]:
                    renders[render["id"]] = render
        else:
            key = (request["url"], "")
        responses.setdefault(key, (entry["response"]["status"], content["mimeType"], body))
    return _AshbyForm(
        job_id=json.loads((folder / "questions.json").read_text())["data"]["jobPosting"]["id"],
        questions=(folder / "questions.json").read_bytes(),
        responses=responses,
        renders=renders,
    )


class _UploadStore(http.server.ThreadingHTTPServer):
    """Stands in for the S3 bucket Greenhouse uploads files to. Playwright can't
    see file bytes in intercepted multipart requests, so uploads go to a real
    local server instead. `delay` seconds pass before each upload is answered."""

    def __init__(self, delay: float = 0):
        super().__init__(("127.0.0.1", 0), _UploadHandler)
        self.delay = delay
        self.files: dict[str, tuple[str, bytes]] = {}  # url -> (filename, bytes)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


class _UploadHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        time.sleep(self.server.delay)
        head = f"Content-Type: {self.headers['Content-Type']}\r\n\r\n".encode()
        parts = {
            p.get_param("name", header="content-disposition"): p
            for p in BytesParser(policy=email_policy).parsebytes(head + body).iter_parts()
        }
        key = parts["key"].get_content()
        upload = parts["file"]
        self.server.files[f"{self.server.url}/{key}"] = (upload.get_filename(), upload.get_payload(decode=True))
        self.send_response(201)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def log_message(self, *args):
        pass


class FakeJobServer:
    """Serves saved job-system forms to a headless browser and records what
    would have been submitted. Every other request is refused, so a test can
    never reach a live site. Implements the JobSite adapter.

    Each open() starts its own browser on the calling thread (Playwright's sync
    API is bound to one thread), so Workers on several threads can each open a
    form at once."""

    def __init__(
        self,
        *forms: Path,
        garble: str | None = None,
        question_api_down: bool = False,
        together: int = 1,
        kill: str | None = None,
        challenge: bool | str = False,
        upload_delay: float = 0,
        failed_file_saves: int = 0,
        dropped_file_saves: int = 0,
        refuse: str | None = None,
        block: str | None = None,
        unlisted: tuple[str, ...] = (),
        unavailable: bool = False,
        lost_saves: tuple[str, ...] = (),
    ):
        """`garble` names a field whose input the form silently corrupts.
        `question_api_down` makes every Question set request fail while the
        forms themselves still load.
        `together` makes every open() wait until that many forms are open at
        once (it fails after 30 s), which proves Workers fill in parallel.
        `kill` kills the run once: "open" right after a form opens, "submit"
        right after the form is submitted, before Apply can record it.
        `challenge` makes reCAPTCHA show its picture challenge at submit;
        "solved": one that goes away 1.5 s later, as when Lisul does it.
        `upload_delay` slows every upload by that many seconds, as a busy network does.
        `failed_file_saves`: Ashby answers that many file saves with an error, and
        the page drops the file (as seen live once on Skydio).
        `dropped_file_saves`: that many file saves never get an answer from Ashby.
        `refuse`: Ashby refuses the submit with this message, as it does when
        reCAPTCHA scores the browser as a bot. `block`: Ashby takes the submit
        but shows this employer's block message (HTML) in place of its success page.
        `unlisted` names Ashby fields the Question set query leaves out, though
        the page still asks them. `unavailable`: Ashby's page gets no form from its
        own query and says "Application submission is unavailable at this time"
        in its place (seen live on Base Power and Cohere, 2026-10-19).
        `lost_saves` names Ashby fields whose saves Ashby answers but its saved
        form drops, as a save racing another did (seen live on Whatnot, 2026-10-20)."""
        loaded = [_load_form(f) for f in forms]
        self._forms = [f for f in loaded if isinstance(f, _Form)]
        self._ashby_forms = [f for f in loaded if isinstance(f, _AshbyForm)]
        self._garble = garble
        self._question_api_down = question_api_down
        self._kill = kill
        self._challenge = challenge
        self._upload_delay = upload_delay
        self._failed_file_saves = failed_file_saves
        self._dropped_file_saves = dropped_file_saves
        self._refuse = refuse
        self._block = block
        self._unlisted = set(unlisted)
        self._lost_saves = set(lost_saves)
        self._unavailable = unavailable
        self._together = threading.Barrier(together, timeout=30)
        self.submissions: list[Submission] = []
        self.workers: list[int] = []  # the Worker that opened each form

    def __enter__(self):
        self._uploads = _UploadStore(self._upload_delay)
        threading.Thread(target=self._uploads.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self._uploads.shutdown()
        self._uploads.server_close()

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        if self._question_api_down:
            raise ConnectionError(f"fake job server: {url} is down")
        for form in self._forms:
            if url == form.questions_url and body is None:
                return form.questions
            if url in form.responses and body is None:
                return form.responses[url][2]
        for form in self._ashby_forms:
            if url == ASHBY_QUESTION_SET_URL and body and json.loads(body)["variables"]["jobPostingId"] == form.job_id:
                return self._listed(form.questions)
            key = _query_key(url, json.loads(body)) if body else (url, "")
            if key in form.responses:  # a query the page itself made, saved
                return form.responses[key][2]
        raise LookupError(f"fake job server has nothing saved at {url}")

    def _listed(self, questions: bytes) -> bytes:
        if not self._unlisted:
            return questions
        posting = json.loads(questions)
        job = posting["data"]["jobPosting"]
        for form in [job["applicationForm"], *(job.get("surveyForms") or [])]:
            for section in form["sections"]:
                section["fieldEntries"] = [e for e in section["fieldEntries"]
                                           if e.get("field", {}).get("path") not in self._unlisted]
        return json.dumps(posting).encode()

    @contextmanager
    def open(self, url: str, worker: int = 0):
        self.workers.append(worker)
        with sync_playwright() as playwright:
            # Chromium blocks a public page from posting to 127.0.0.1 unless told not to.
            browser = playwright.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks"])
            context = browser.new_context(service_workers="block")
            if self._garble:
                context.add_init_script(GARBLE % json.dumps(self._garble))
            context.route("**/*", self._handle)
            try:
                page = context.new_page()
                page.goto(url)
                self._together.wait()
                if self._kill == "open":
                    self._kill = None
                    raise Killed()
                submitted = len(self.submissions)
                yield page
                if self._kill == "submit" and len(self.submissions) > submitted:
                    self._kill = None
                    raise Killed()
            finally:
                browser.close()

    def _handle(self, route: Route) -> None:
        request = route.request
        # `copy=N` makes several Postings out of one saved form.
        url = re.sub(r"[?&]copy=\d+$", "", request.url)
        if url.startswith(self._uploads.url):
            return route.continue_()
        if "recaptcha/enterprise.js" in url:
            # Ashby names a callback to run once reCAPTCHA has loaded.
            onload = re.search(r"[?&]onload=(\w+)", url)
            call = f"window.{onload[1]}&&window.{onload[1]}();" if onload else ""
            stub = (RECAPTCHA_SOLVED_STUB if self._challenge == "solved" else
                    RECAPTCHA_CHALLENGE_STUB if self._challenge else RECAPTCHA_STUB)
            return route.fulfill(content_type="text/javascript", body=stub + call)
        if any(self._handle_ashby(route, form) for form in self._ashby_forms):
            return
        if "/uncacheable_attributes/presigned_fields" in url:
            return route.fulfill(json=self._presigned_fields())
        for form in self._forms:
            if request.method == "GET" and url in form.responses:
                status, mime, body = form.responses[url]
                return route.fulfill(status=status, content_type=mime, body=body)
            if request.method == "POST" and url == form.submit_url:
                self.submissions.append(self._submission(url, request.post_data_json))
                return route.fulfill(json={})
            if request.method == "GET" and url == f"{form.url}/confirmation":
                return route.fulfill(content_type="text/html", body=CONFIRMATION)
        route.abort()

    def _handle_ashby(self, route: Route, form: _AshbyForm) -> bool:
        """Serve one saved Ashby form and play Ashby's server for it. False if
        the request isn't this form's."""
        request = route.request
        if request.method == "GET" and (request.url, "") in form.responses:
            status, mime, body = form.responses[(request.url, "")]
            route.fulfill(status=status, content_type=mime, body=body)
            return True
        if request.method != "POST" or not request.url.startswith(ASHBY_GRAPHQL):
            return False
        query = request.post_data_json
        op, variables = query["operationName"], query["variables"]
        if _query_key(request.url, query) in form.responses:
            status, mime, body = form.responses[_query_key(request.url, query)]
            if op == "ApiJobPosting" and self._unavailable:
                refused = json.loads(body)
                refused["data"]["jobPosting"]["applicationForm"] = None
                body = json.dumps(refused).encode()
            route.fulfill(status=status, content_type=mime, body=body)
        elif op == "ApiCreateFileUploadHandle":
            handle = str(uuid.uuid4())
            upload = {"handle": handle, "url": self._uploads.url, "fields": {"key": handle}, "__typename": "FileUploadHandle"}
            route.fulfill(json={"data": {"fileUploadHandle": upload}})
        elif op in ("ApiSetFormValue", "ApiSetFormValueToFile") and variables["formRenderIdentifier"] in form.renders:
            render_id = variables["formRenderIdentifier"]
            if op == "ApiSetFormValue":
                value = {"__typename": "JSONBox", "value": variables["value"]}
            else:
                handle = variables["fileHandle"]
                filename = self._uploads.files[f"{self._uploads.url}/{handle}"][0]
                value = {"__typename": "File", "id": handle, "filename": filename}
            if op == "ApiSetFormValueToFile" and self._dropped_file_saves:
                self._dropped_file_saves -= 1
                route.abort()
                return True
            if op == "ApiSetFormValueToFile" and self._failed_file_saves:
                self._failed_file_saves -= 1
                route.fulfill(json={"errors": [{"message": "Internal server error"}], "data": None})
                return True
            if variables["path"] not in self._lost_saves:
                form.values.setdefault(render_id, {})[variables["path"]] = value
            field = "setFormValue" if op == "ApiSetFormValue" else "setFormValueToFile"
            route.fulfill(json={"data": {field: form.render(render_id)}})
        elif op == "ApiSubmitMultipleFormsAction" and variables["jobPostingId"] == form.job_id and self._refuse:
            route.fulfill(json={"data": None, "errors": [{"message": self._refuse, "extensions": {
                "ashbyErrorType": "RECAPTCHA_SCORE_BELOW_THRESHOLD", "message": self._refuse}}]})
        elif op == "ApiSubmitMultipleFormsAction" and variables["jobPostingId"] == form.job_id:
            render_ids = [variables["applicationFormRenderIdentifier"]]
            render_ids += [s["formRenderId"] for s in variables["surveyIdentifiers"]]
            self.submissions.append(self._ashby_submission(request.url, form, render_ids))
            success = {"__typename": "FormSubmitSuccess", "_": None}
            route.fulfill(json={"data": {"submitMultipleFormsAction": {
                "applicationFormResult": success,
                "surveyFormResults": [success for _ in variables["surveyIdentifiers"]],
                "messages": {"blockMessageForCandidateHtml": self._block, "__typename": "SubmitMultipleFormsActionMessages"},
                "__typename": "SubmitMultipleFormsActionResult",
            }}})
        else:
            return False
        return True

    def _ashby_submission(self, url: str, form: _AshbyForm, render_ids: list[str]) -> Submission:
        application, files = {}, {}
        for render_id in render_ids:
            for path, value in form.values.get(render_id, {}).items():
                if value["__typename"] == "File":
                    application[path] = value["filename"]
                    files[path] = self._uploads.files[f"{self._uploads.url}/{value['id']}"][1]
                else:
                    application[path] = value["value"]
        return Submission(url=url, application=application, files=files)

    def _presigned_fields(self) -> dict:
        fields = {"fields": {"success_action_status": "201"}}
        return {
            "url": self._uploads.url,
            "resume": {**fields, "key": "resumes/{timestamp}-{unique_id}"},
            "cover_letter": {**fields, "key": "cover_letters/{timestamp}-{unique_id}"},
        }

    def _submission(self, url: str, body: dict) -> Submission:
        application = body["job_application"]
        # Uploaded files are sent as e.g. "resume_url": "<upload store>/<key>".
        files = {
            key.removesuffix("_url"): self._uploads.files[value][1]
            for key, value in application.items()
            if key.endswith("_url") and value in self._uploads.files
        }
        return Submission(url=url, application=application, files=files)


# The Story bank headings a default essay plan leads with, one per essay in order: from the
# tests' Story bank, which conftest.data_folder() puts in the data folder.
PLAN_STORIES = tuple(line.lstrip("# ") for line in (Path(__file__).parent / "fixtures" / "story-bank.md").read_text().splitlines()
                     if line.startswith(("## Cloud Data Pro", "## Clever Devices", "## Micromouse", "## WorkIt")))


class FakeClaude:
    """Plays Claude writing a form's essays and reviewing a filled form before
    submit. It tells the calls apart by their structured-output schema, as the
    real one would read it: an essay call has one property per essay, described
    by the essay's question; a review returns `problems`.

    `essays` maps the start of an essay question to the answer to give (or
    a list of answers, one per call, the last kept); any other essay gets a
    plain draft. `drafts` does the same for the one-off
    questions the same call drafts for the Answer bank; any other gets its
    first option, or a short plain answer. `needs_lisul` holds the starts of
    essay and one-off questions Claude says its sources can't answer. `reviews` are the
    problems each review finds, in order (or a review's whole answer, a dict with its
    `problems` and `fixes`); once they run out, every review passes. `replans` maps the start of a question whose answer the page
    showed otherwise to the answer to fill instead, when Sonnet plans it
    again; any other is left as planned. Keeps every call it was sent.

    It also plays Claude driving a browser step by step (Claude
    fill): `driver(page, schema, prompt, files)` does on the page what
    Claude would and returns its structured answer. Each drive costs the next
    of `drive_tokens` (then 10,000) and `drive_turns` turns; a drive that
    would pass its cap stops there, as the live one is stopped, with no answer.
    `sent` is what it reads off a page a submit led to: whether the
    application was sent, or the error the call raises.
    `spent()` counts each thread's drive tokens plus `ask_tokens` per ask.
    A Company brief's research finds the facts in `brief` (none unless given),
    or for a team, those in `team_brief` (either one may be the research's
    whole output, as a dict); each Posting is for `team` ("" for
    none). Both kinds of call are kept apart from `calls`, in `researched`
    and `teams_named`. `named` maps the start of an essay question to the
    brief fact's name its answer says it named. The story map's call returns
    the episodes in `story_map` as given. An essay plan call gets a
    valid plan (the classifier's type, a distinct Story bank heading per
    essay, no company fact, and that heading quoted for every required slot
    of its type); each of `plans`, one per plan call (the last kept), maps
    the start of a question to the fields to give instead.
    The default probe gives TYPICAL and TYPICAL_ANGLES for each question,
    unless `typical` maps the start of its question to another answer and angles.
    The editor hands each answer back as it was, except that an answer the
    pass flags something in and that starts with a key of `repairs` comes
    back as that key's text."""

    DRAFT = "A plain draft drawn from his own projects."
    # The default probe's answer to an idea-driven essay, unless `typical` maps the start of its question to another.
    TYPICAL = "I have always admired the mission and I want to grow as an engineer on a great team."
    TYPICAL_ANGLES = ("the mission resonates opener", "uses the product daily", "learn from great engineers")
    SHORT = "A short answer from the profile"

    # A default essay opens on DRAFT (another opening for each later essay of
    # the form, so no two open alike), then adds MORE until it fits the
    # length its question asks for (apply.gates.bounds), so it passes the gates.
    OPENINGS = ("A", "Another", "One more", "Yet another", "A further", "A last")
    MORE = ("He built the parts himself and checked each one against what the team needed.",
            "The team used the work every week after that and relied on it to plan.",
            "He wrote down each choice he made so the next person could follow it.",
            "He tested it on the real data first and fixed what broke before the review.")

    def __init__(self, essays: dict[str, str | list[str]] | None = None, needs_lisul=(), reviews: list[list[str]] = (),
                 driver: Callable | None = None, drive_tokens: list[int] = (), drive_turns: int = 6,
                 replans: dict[str, str] | None = None, ask_tokens: int = 0, drafts: dict | None = None,
                 sent: bool | Exception = False, facts: dict | None = None, brief: list[dict] | dict | None = None,
                 team: str = "", team_brief: list[dict] | dict | None = None, named: dict[str, str] | None = None,
                 story_map: list[dict] = (), plans: list[dict[str, dict]] = (),
                 typical: dict[str, dict] | None = None, repairs: dict[str, str] | None = None):
        self._repairs = repairs or {}
        self._typical = typical or {}
        self._sent = sent
        self._story_map = list(story_map)
        self._plans = list(plans)
        self._brief = brief or []
        self._team, self._team_brief = team, team_brief or []
        self._named = named or {}
        self.researched: list[str] = []  # the prompt of each Company brief research
        self.teams_named: list[str] = []  # the prompt of each call naming a Posting's team
        self._essays = essays or {}
        self._drafts = drafts or {}
        self._facts = facts or {}
        self._ask_tokens = ask_tokens
        self._spent = threading.local()
        self._replans = replans or {}
        self._needs_lisul = tuple(needs_lisul)
        self._reviews = list(reviews)
        self._driver = driver
        self._drive_tokens = list(drive_tokens)
        self._drive_turns = drive_turns
        self.calls: list[dict] = []

    @property
    def prompts(self) -> list[str]:
        return [call["prompt"] for call in self.calls]

    def spent(self) -> int:
        return getattr(self._spent, "tokens", 0)

    def _spend(self, tokens: int) -> None:
        self._spent.tokens = self.spent() + tokens

    def ask(self, *, model: str, system: str, prompt: str, schema: dict) -> dict:
        if "team" in schema["properties"]:
            self.teams_named.append(prompt)
            return {"team": self._team}
        self.calls.append({"model": model, "system": system, "prompt": prompt, "schema": schema})
        self._spend(self._ask_tokens)
        wanted = schema["properties"]
        if "episodes" in wanted:  # the story map (apply.story_map)
            return {"episodes": [dict(e) for e in self._story_map]}
        if "essays" in wanted or "drafts" in wanted:
            given = {}
            if "essays" in wanted:
                given["essays"] = {key: self._written(question, n)
                                   | {"named": n for start, n in self._named.items() if question["description"].startswith(start)}
                                   for n, (key, question) in enumerate(wanted["essays"]["properties"].items())}
            if "drafts" in wanted:
                given["drafts"] = {
                    key: {"answer": "" if self._needs(question) else self._draft(question), "needs_lisul": self._needs(question)}
                    | {"facts": f for start, f in self._facts.items() if question["description"].startswith(start)}
                    for key, question in wanted["drafts"]["properties"].items()
                }
            return given
        if "typical" in wanted:  # the default probe (apply.probe): the stock typical answer, unless told otherwise
            return {"typical": {key: next((t for start, t in self._typical.items() if entry["description"].startswith(start)),
                                          {"answer": self.TYPICAL, "angles": list(self.TYPICAL_ANGLES)})
                                for key, entry in wanted["typical"]["properties"].items()}}
        if "plan" in wanted:  # the essay plan (apply.essays): a valid one, unless a test gave its own; no link_kind
            given = self._plans.pop(0) if len(self._plans) > 1 else self._plans[0] if self._plans else {}
            planned = {}
            for n, (key, entry) in enumerate(wanted["plan"]["properties"].items()):
                story = PLAN_STORIES[n] if n < len(PLAN_STORIES) else ""
                planned[key] = ({"type": entry["properties"]["type"].get("default", "general"), "parts": ["What it asks"],
                                 "story": story, "company_fact": "", "angle": "A point only his own facts support.",
                                 "link_kind": ""}
                                | next((p for start, p in given.items() if entry["description"].startswith(start)), {}))
                planned[key].setdefault("slots", [
                    {"slot": slot.name, "quotes": [story or PLAN_STORIES[n % len(PLAN_STORIES)]], "ask": ""}
                    for slot in answering.load()[planned[key]["type"]].slots if slot.required is True])
            return {"plan": planned}
        if "edited" in wanted:  # the editor's pass (apply.writing): hands every answer back as it was, unless repaired
            drafts = json.loads(prompt.split("<drafts>\n", 1)[1].split("\n</drafts>", 1)[0])
            flagged = json.loads(prompt.split("<flagged>\n", 1)[1].split("\n</flagged>", 1)[0]) if "<flagged>" in prompt else {}
            return {"edited": {key: next((fixed for start, fixed in self._repairs.items()
                                          if key in flagged and text.startswith(start)), text)
                               for key, text in drafts.items()}}
        if "unsupported" in wanted:  # the claim check (apply.writing): finds nothing
            return {"unsupported": {key: [] for key in wanted["unsupported"]["properties"]}}
        if "problems" in wanted:  # a review: its problems, or a dict of them with the fixes it gives
            found = self._reviews.pop(0) if self._reviews else []
            return found if isinstance(found, dict) else {"problems": found}
        if "sent" in wanted:
            if isinstance(self._sent, Exception):
                raise self._sent
            return {"sent": self._sent, "why": "it says so" if self._sent else "the form is still there"}
        if "replanned" in wanted:
            return {"replanned": {
                key: {"answer": next((a for start, a in self._replans.items() if field["description"].startswith(start)), "")}
                for key, field in wanted["replanned"]["properties"].items()
            }}
        raise AssertionError(f"FakeClaude doesn't know this call: {sorted(wanted)}")

    def drive(self, *, page, model: str, system: str, prompt: str, schema: dict, files: list[Path],
              max_turns: int, max_tokens: int, hook: tuple[str, ...] = ()) -> Drive:
        self.calls.append({"model": model, "system": system, "prompt": prompt, "schema": schema, "files": files,
                           **({"hook": hook} if hook else {})})
        if self._driver is None:
            raise AssertionError("FakeClaude was given no driver for a drive")
        tokens = self._drive_tokens.pop(0) if self._drive_tokens else 10_000
        if tokens > max_tokens or self._drive_turns > max_turns:
            self._spend(min(tokens, max_tokens))
            return Drive(None, min(self._drive_turns, max_turns), min(tokens, max_tokens), capped=True)
        self._spend(tokens)
        return Drive(self._driver(page, schema, prompt, files), self._drive_turns, tokens)

    def _written(self, question: dict, n: int = 0) -> dict:
        """An essay; a cover letter's slots get it as their first paragraph, the rest left empty."""
        text = self._essay(question["description"], n)
        slots = [p for p in question["properties"] if p not in ("needs_lisul", "named")]
        return {slot: text if n == 0 else "" for n, slot in enumerate(slots)} | {"needs_lisul": self._needs(question)}

    def research(self, *, model: str, system: str, prompt: str, schema: dict, max_turns: int,
                 max_tokens: int) -> Drive:
        self.researched.append(prompt)
        facts = self._team_brief if "<team>" in prompt else self._brief
        output = dict(facts) if isinstance(facts, dict) else {"facts": [dict(f) for f in facts]}
        return Drive(output, 8, 200_000)

    def _needs(self, question: dict) -> bool:
        return bool(self._needs_lisul) and question["description"].startswith(self._needs_lisul)

    def _draft(self, question: dict):
        given = next((a for start, a in self._drafts.items() if question["description"].startswith(start)), None)
        if given is not None:
            return given
        answer = question["properties"]["answer"]
        options = answer.get("enum") or answer.get("items", {}).get("enum")
        if not options:
            return self.SHORT
        return [options[0]] if answer["type"] == "array" else options[0]

    def _essay(self, question: str, n: int = 0) -> str:
        given = next((answer for start, answer in self._essays.items() if question.startswith(start)), None)
        if given is None:
            return self._default(question, n)
        if isinstance(given, list):
            return given.pop(0) if len(given) > 1 else given[0]
        return given

    def _default(self, question: str, n: int) -> str:
        """DRAFT, opened for the form's `n`th essay and grown to the length `question` asks."""
        kind = (re.search(r"\{type: ([\w-]+)", question) or [None, "general"])[1]
        field = Question("q", question, "text" if "single-line field" in question else "textarea")
        low, high, unit = gates.bounds(field, kind)
        text = self.OPENINGS[n % len(self.OPENINGS)] + self.DRAFT[1:]
        for more in self.MORE * 4:
            longer = f"{text} {more}"
            if gates._measure(text, unit) >= low or gates._measure(longer, unit) > high:
                break
            text = longer
        return text


class FakeMailbox:
    """Lisul's Gmail: fake job servers deliver codes and links into it, under
    the Gmail search that finds them. With a clock, each mail arrives at the
    clock's time, and only mail since the time asked for is found."""

    def __init__(self, clock: "FakeClock | None" = None, set_up: bool = True):
        """Not `set_up`: no Gmail app password, so no mail can be read."""
        self._clock = clock
        self._set_up = set_up
        self._mail: list[tuple[str, datetime | None, str, str]] = []  # (search, arrived, kind, value)
        self._senders: dict[str, str] = {}  # each code's sender domain
        self._lock = threading.Lock()
        self.looks = 0  # how many times Apply looked

    def deliver(self, search: str, *, code: str = "", link: str = "", sender: str = "mail.example.com") -> None:
        arrived = self._clock.now() if self._clock else None
        with self._lock:
            self._senders[code] = sender
            self._mail.append((search, arrived, "code" if code else "link", code or link))

    def unavailable(self) -> str | None:
        return None if self._set_up else "Gmail isn't set up for Apply: no Gmail app password in Keychain."

    def find_code(self, *, search: str, since: datetime) -> str | None:
        return self._find(search, since, "code")

    def find_mailed_code(self, *, search: str, since: datetime) -> MailedCode | None:
        code = self._find(search, since, "code")
        return MailedCode(code, self._senders[code]) if code else None

    def find_link(self, *, search: str, since: datetime, hosts: tuple[str, ...]) -> str | None:
        link = self._find(search, since, "link")
        return link if link and on_hosts(link, hosts) else None

    def _find(self, search: str, since: datetime, kind: str) -> str | None:
        with self._lock:
            self.looks += 1
            found = [value for s, arrived, k, value in self._mail
                     if s == search and k == kind and (arrived is None or arrived >= since)]
        return found[-1] if found else None


class ScriptedUsage:
    """Usage readings from a script: a function of what has happened so far,
    such as the time on a FakeClock or the forms a FakeJobServer has seen.
    Without a script, nothing of the Max plan is used."""

    def __init__(self, script: Callable[[], UsageReading] = UsageReading):
        self._script = script

    def reading(self) -> UsageReading:
        return self._script()


class FakeClock:
    """Stands still until a run sleeps, then jumps to the wake-up time."""

    def __init__(self, now: datetime, on_sleep: Callable[[], None] = lambda: None):
        """`on_sleep` runs as each sleep starts, to look at the world mid-pause."""
        self._now = now
        self._on_sleep = on_sleep
        self.slept: list[datetime] = []  # every wake-up time a run slept until

    def now(self) -> datetime:
        return self._now

    def sleep_until(self, when: datetime) -> None:
        self.slept.append(when)
        self._on_sleep()
        self._now = max(self._now, when)


class RecordingBoard:
    """The dashboard's captions, as the run left them, by Worker."""

    def __init__(self):
        self.captions: dict[int, dict[str, object]] = {}
        self.runs: list[dict[str, object]] = []  # each run() call, in order
        self.notes: list[tuple[str, str, str]] = []  # each Posting skipped without a Worker, and why
        self._lock = threading.Lock()

    def update(self, worker: int, **caption: object) -> None:
        with self._lock:
            self.captions.setdefault(worker, {}).update(caption)

    def run(self, **fields: object) -> None:
        with self._lock:
            self.runs.append(fields)

    def add_tile(self, worker: int) -> int:
        """One more tile, for a link sent into Worker `worker` (Dashboard.add_tile); its number."""
        with self._lock:
            self.captions.setdefault(len(self.captions), {})
            self.shown = getattr(self, "shown", {}) | {len(self.captions) - 1: worker}
            return len(self.captions) - 1

    def wait_for_start(self, timeout: float) -> None:
        self.run(start="pressed")  # Lisul presses Start at once

    def note(self, company: str, role: str, why: str, posting_url: str = "") -> None:
        with self._lock:
            self.notes.append((company, role, why))

    def answered(self, worker: int) -> list[tuple[str, str]]:
        return []

    def file_given(self, worker: int) -> None:
        pass

    def resumed(self, worker: int) -> bool:
        return False

    def regenerations(self, worker: int) -> list[tuple[str, str]]:
        return []
    def wanted(self, worker: int) -> list[tuple[str, Callable[[str], None]]]:
        return []

    def typed(self, worker: int, questions: list[str], answer: str) -> str:
        with self._lock:
            self.typed_in = getattr(self, "typed_in", []) + [(worker, list(questions), answer)]
        return ""
