"""A fake Lever: serves saved Lever forms to a headless browser, parses
résumés the way Lever's server does, and records what would have been
submitted. Nothing here touches the network. Implements the JobSite adapter."""

import base64
import http.server
import json
import threading
import time
import uuid
from contextlib import contextmanager
from email.parser import BytesParser
from email.policy import default as email_policy
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fakes import Submission
from playwright.sync_api import Route, sync_playwright

# Lever's form asks hCaptcha for a token at submit; this one always passes.
HCAPTCHA_STUB = """
window.hcaptcha = {
  render: function (el, opts) { window.__hcaptcha = opts; return 0; },
  execute: function () { setTimeout(function () { window.__hcaptcha.callback('fake-hcaptcha-token'); }); },
  reset: function () {},
};
(function ready() { if (window[%(onload)s]) window[%(onload)s](); else setTimeout(ready, 10); })();
"""
# The same, when hCaptcha doubts the browser: it shows its picture challenge and never answers.
HCAPTCHA_CHALLENGE_STUB = HCAPTCHA_STUB.replace(
    "setTimeout(function () { window.__hcaptcha.callback('fake-hcaptcha-token'); });",
    "var f = document.createElement('iframe');"
    " f.src = 'https://newassets.hcaptcha.com/captcha/v1/fake/static/hcaptcha.html#frame=challenge&id=0';"
    " f.style.cssText = 'width:400px;height:600px'; document.body.appendChild(f);",
)

# Lever's page posts the résumé to its own /parseResume. Playwright can't see
# file bytes in an intercepted multipart request, so the fake's parser is a
# real server on 127.0.0.1 and the page is pointed at it.
PARSER_SHIM = """
const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  return open.call(this, method, url === '/parseResume' ? %s : url, ...rest);
};
"""

# What the parser "reads" from any résumé: deliberately not the answers, so a
# Filler that fills before the parse returns gets its answers overwritten.
PARSED = {
    "name": "Parsed Name",
    "email": "parsed@example.com",
    "phone": "+1 555 010 0000",
    "position": "Parsed Company",
    "location": {"name": "Parsed City, ZZ, USA", "id": "parsed"},
    "links": [{"domain": "linkedin.com", "url": "https://www.linkedin.com/in/parsed"}],
}

# Lever answers the submit POST by sending the browser to /thanks. Playwright
# can't fulfill a navigation with a redirect, so the fake does it client-side.
TO_THANKS = "<!doctype html><script>location.replace(%s)</script>"
THANKS = "<!doctype html><title>Thanks</title><h3>Application submitted!</h3>"
# What Lever answers the submit POST with when its hCaptcha turns the token down (Simbe Robotics, 2026-11-03).
NOT_VERIFIED = ("<!doctype html><title>Apply</title><div class=\"application-error\">"
                "There was an error verifying your application. Please try again.</div>")


class _Parser(http.server.ThreadingHTTPServer):
    """Lever's résumé parser: keeps each résumé under a storage id and answers
    after `delay` seconds, as Lever's server-side parse does."""

    def __init__(self, delay: float):
        super().__init__(("127.0.0.1", 0), _ParseHandler)
        self.delay = delay
        self.resumes: dict[str, bytes] = {}
        self.answered: list[bytes] = []  # each résumé, once its parse has been answered

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/parseResume"


class _ParseHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        parts = _multipart(self.headers["Content-Type"], self.rfile.read(int(self.headers["Content-Length"])))
        storage_id = uuid.uuid4().hex
        self.server.resumes[storage_id] = parts["resume"].get_payload(decode=True)
        time.sleep(self.server.delay)
        self.server.answered.append(self.server.resumes[storage_id])
        body = json.dumps({**PARSED, "resumeStorageId": storage_id}).encode()
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def _multipart(content_type: str, body: bytes) -> dict:
    head = f"Content-Type: {content_type}\r\n\r\n".encode()
    message = BytesParser(policy=email_policy).parsebytes(head + body)
    return {p.get_param("name", header="content-disposition"): p for p in message.iter_parts()}


def _load_responses(folder: Path) -> dict[str, tuple[int, str, bytes]]:
    responses = {}
    for entry in json.loads((folder / "page.har").read_text())["log"]["entries"]:
        content = entry["response"]["content"]
        text = content.get("text", "")
        body = base64.b64decode(text) if content.get("encoding") == "base64" else text.encode()
        responses.setdefault(entry["request"]["url"], (entry["response"]["status"], content["mimeType"], body))
    return responses


class FakeLeverServer:
    """Serves saved Lever forms (each folder holds a page.har from
    tests/save_lever_form.py). Every request it has no answer for is refused."""

    def __init__(self, *forms: Path, parse_delay: float = 2.0, challenge: bool = False, refuse: bool = False):
        """`challenge` makes hCaptcha show its picture challenge at submit;
        `refuse`, Lever turn the sent form's hCaptcha token down."""
        self._challenge = challenge
        self._refuse = refuse
        self._responses: dict[str, tuple[int, str, bytes]] = {}
        for form in forms:
            self._responses.update(_load_responses(form))
        self._parse_delay = parse_delay
        self.submissions: list[Submission] = []
        self.workers: list[int] = []  # the Worker number of each open

    def __enter__(self):
        self._parser = _Parser(self._parse_delay)
        threading.Thread(target=self._parser.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self._parser.shutdown()
        self._parser.server_close()

    @property
    def parsed(self) -> list[bytes]:
        """Every résumé whose parse Lever has answered so far."""
        return self._parser.answered

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        if url in self._responses:
            return self._responses[url][2]
        raise LookupError(f"fake Lever has nothing saved at {url}")

    @contextmanager
    def open(self, url: str, worker: int = 0):
        self.workers.append(worker)
        # Playwright's sync API is bound to the thread that starts it, so each
        # open starts its own browser on the calling Worker's thread.
        with sync_playwright() as playwright:
            # Chromium blocks a public page from posting to 127.0.0.1 unless told not to.
            browser = playwright.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks"])
            context = browser.new_context(service_workers="block")
            context.add_init_script(PARSER_SHIM % json.dumps(self._parser.url))
            context.route("**/*", self._handle)
            try:
                page = context.new_page()
                page.goto(url)
                yield page
            finally:
                browser.close()

    def _handle(self, route: Route) -> None:
        request = route.request
        url = request.url
        if url.startswith(self._parser.url):
            return route.continue_()
        if url.startswith("https://js.hcaptcha.com/1/"):
            onload = parse_qs(urlsplit(url).query)["onload"][0]
            stub = HCAPTCHA_CHALLENGE_STUB if self._challenge else HCAPTCHA_STUB
            return route.fulfill(content_type="text/javascript", body=stub % {"onload": json.dumps(onload)})
        if request.method == "GET" and url in self._responses:
            status, mime, body = self._responses[url]
            return route.fulfill(status=status, content_type=mime, body=body)
        if request.method == "POST" and url in self._responses and url.endswith("/apply") and self._refuse:
            return route.fulfill(content_type="text/html", body=NOT_VERIFIED)
        if request.method == "POST" and url in self._responses and url.endswith("/apply"):
            self.submissions.append(self._submission(url, request))
            thanks = url.removesuffix("/apply") + "/thanks"
            return route.fulfill(content_type="text/html", body=TO_THANKS % json.dumps(thanks))
        if request.method == "GET" and url.endswith("/thanks") and url.removesuffix("/thanks") + "/apply" in self._responses:
            return route.fulfill(content_type="text/html", body=THANKS)
        route.abort()

    def _submission(self, url: str, request) -> Submission:
        parts = _multipart(request.headers["content-type"], request.post_data_buffer)
        # File parts arrive empty (see PARSER_SHIM); text fields are intact.
        # A checkbox posts after its hidden "0" twin, so the last value wins.
        application = {name: part.get_content() for name, part in parts.items()
                       if part.get_param("filename", header="content-disposition") is None}
        files = {"resume": self._parser.resumes[application["resumeStorageId"]]} if application.get("resumeStorageId") else {}
        return Submission(url=url, application=application, files=files)
