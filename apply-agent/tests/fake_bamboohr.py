"""A fake BambooHR, a job system with no Filler: serves a saved BambooHR
careers page to a headless browser, keeps uploaded résumés the way BambooHR's
server does, and records what would have been submitted. Nothing here
touches the network. Implements the JobSite adapter."""

import http.server
import itertools
import json
import threading
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import Route, sync_playwright

from fake_lever import _load_responses, _multipart
from fakes import Submission

# The form renders reCAPTCHA's checkbox and waits for its callback; this one is
# ticked at once.
RECAPTCHA_STUB = """
window.grecaptcha = {
  render: function (el, opts) { setTimeout(function () { opts.callback('fake-recaptcha-token'); }); return 0; },
  reset: function () {},
  getResponse: function () { return 'fake-recaptcha-token'; },
};
(function ready() { if (window[%(onload)s]) window[%(onload)s](); else setTimeout(ready, 10); })();
"""

# The page uploads the résumé to its own /ajax/files/attachTemporary.php as soon
# as it is chosen. Playwright can't see file bytes in an intercepted multipart
# request, so the fake's store is a real server on 127.0.0.1 and the page is
# pointed at it.
UPLOAD = "/ajax/files/attachTemporary.php"
UPLOAD_SHIM = """
const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  return open.call(this, method, url === %s ? %s : url, ...rest);
};
"""


class _Store(http.server.ThreadingHTTPServer):
    """BambooHR's temporary file store: answers each upload with a file id."""

    def __init__(self):
        super().__init__(("127.0.0.1", 0), _StoreHandler)
        self.files: dict[str, tuple[str, bytes]] = {}  # file id -> (name, bytes)
        self.ids = itertools.count(9001)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}{UPLOAD}"


class _StoreHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        upload = _multipart(self.headers["Content-Type"], self.rfile.read(int(self.headers["Content-Length"])))["upload"]
        fid = str(next(self.server.ids))
        self.server.files[fid] = (upload.get_filename(), upload.get_payload(decode=True))
        body = json.dumps({"status": "OK", "fid": fid, "name": upload.get_filename()}).encode()
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class FakeBambooServer:
    """Serves saved BambooHR careers pages (each folder holds a page.har from
    tests/save_page.py). Every request it has no answer for is refused."""

    def __init__(self, *forms: Path):
        self._responses: dict[str, tuple[int, str, bytes]] = {}
        for form in forms:
            self._responses.update(_load_responses(form))
        self.submissions: list[Submission] = []
        self.opened: list[str] = []  # every page opened, in order

    def __enter__(self):
        self._store = _Store()
        threading.Thread(target=self._store.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self._store.shutdown()
        self._store.server_close()

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        if url in self._responses and body is None:
            return self._responses[url][2]
        raise LookupError(f"fake BambooHR has nothing saved at {url}")

    @contextmanager
    def open(self, url: str, worker: int = 0):
        self.opened.append(url)
        # Playwright's sync API is bound to the thread that starts it, so each
        # open starts its own browser on the calling Worker's thread.
        with sync_playwright() as playwright:
            # Chromium blocks a public page from posting to 127.0.0.1 unless told not to.
            browser = playwright.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks"])
            context = browser.new_context(service_workers="block")
            context.add_init_script(UPLOAD_SHIM % (json.dumps(UPLOAD), json.dumps(self._store.url)))
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
        if url.startswith(self._store.url):
            return route.continue_()
        if url.startswith("https://www.google.com/recaptcha/api.js"):
            onload = parse_qs(urlsplit(url).query)["onload"][0]
            return route.fulfill(content_type="text/javascript", body=RECAPTCHA_STUB % {"onload": json.dumps(onload)})
        if request.method == "GET" and url in self._responses:
            status, mime, body = self._responses[url]
            return route.fulfill(status=status, content_type=mime, body=body)
        if request.method == "POST" and url.endswith("/add") and url.removesuffix("/add") in self._responses:
            self.submissions.append(self._submission(url, request))
            return route.fulfill(json={})
        route.abort()

    def _submission(self, url: str, request) -> Submission:
        parts = _multipart(request.headers["content-type"], request.post_data_buffer)
        application = {name: part.get_content() for name, part in parts.items()}
        files = {name: self._store.files[fid][1] for name, fid in application.items()
                 if name.endswith("FileId") and fid in self._store.files}
        return Submission(url=url, application=application, files=files)
