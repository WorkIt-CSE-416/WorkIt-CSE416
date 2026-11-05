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

from fake_lever import _load_responses, _multipart
from fakes import Submission
from playwright.sync_api import Route, sync_playwright

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

# A fake of reCAPTCHA v2's real checkbox (Lunar Outpost's form, 2026-11-04), for FakeBambooServer(recaptcha=True):
# its "I'm not a robot" box in its own frame on google.com, and its token in a hidden field beside it. Ticking the
# box opens its picture challenge in a second frame, over a backdrop that covers the whole page, as Google's
# does; the challenge's Verify closes it and gives the form the token.
RECAPTCHA_CHECKBOX = """
window.grecaptcha = {
  render: function (el, opts) {
    const frame = document.createElement('iframe');
    frame.src = 'https://www.google.com/recaptcha/api2/anchor?k=fake&size=normal';
    frame.title = 'reCAPTCHA';
    frame.style.cssText = 'width:304px;height:78px;border:0';
    const answer = document.createElement('textarea');
    answer.name = 'g-recaptcha-response';
    answer.style.display = 'none';
    el.append(frame, answer);
    addEventListener('message', function (event) {
      if (event.data === 'recaptcha-ticked') {
        const challenge = document.createElement('div');
        challenge.id = 'fake-recaptcha-challenge';
        challenge.innerHTML = '<div style="position:fixed;top:0;left:0;width:100%%;height:100%%;z-index:2000000000;'
          + 'background:#fff;opacity:0.05"></div><iframe title="recaptcha challenge expires in two minutes" '
          + 'src="https://www.google.com/recaptcha/api2/bframe?k=fake" style="position:absolute;top:10px;left:10px;'
          + 'width:400px;height:580px;z-index:2000000001;border:0;background:#fff"></iframe>';
        document.body.appendChild(challenge);
      }
      if (event.data === 'recaptcha-solved') {
        document.getElementById('fake-recaptcha-challenge').remove();
        answer.value = 'fake-recaptcha-token';
        opts.callback('fake-recaptcha-token');
      }
    });
    return 0;
  },
  reset: function () {},
  getResponse: function () { return document.querySelector('[name=g-recaptcha-response]').value; },
};
(function ready() { if (window[%(onload)s]) window[%(onload)s](); else setTimeout(ready, 10); })();
"""
ANCHOR_PAGE = """<!doctype html><html><body>
<div id="recaptcha-anchor" role="checkbox" aria-checked="false" tabindex="0" style="padding:20px;border:1px solid #ccc">
I'm not a robot</div>
<script>
const box = document.getElementById('recaptcha-anchor');
box.addEventListener('click', () => {
  if (box.getAttribute('aria-checked') === 'true') return;
  box.setAttribute('aria-checked', 'true');
  parent.postMessage('recaptcha-ticked', '*');
});
</script></body></html>"""
# The picture challenge: Lisul picks the pictures, then Verify.
BFRAME_PAGE = """<!doctype html><html><body>
<p>Select all images with traffic lights</p>
<button id="recaptcha-verify-button" onclick="parent.postMessage('recaptcha-solved', '*')">Verify</button>
</body></html>"""

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
# The fake reCAPTCHA's frames, and a real click on its box, as Playwright MCP or Lisul makes one.
ANCHOR = "iframe[src*='recaptcha/api2/anchor']"
BFRAME = "iframe[src*='recaptcha/api2/bframe']"


def tick_the_box(page) -> None:
    page.frame_locator(ANCHOR).locator("#recaptcha-anchor").click(timeout=3_000)


def ticked(page) -> bool:
    return page.frame_locator(ANCHOR).locator("#recaptcha-anchor").get_attribute("aria-checked") == "true"


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

    def __init__(self, *forms: Path, recaptcha: bool = False):
        """`recaptcha`: the form shows reCAPTCHA's real checkbox (RECAPTCHA_CHECKBOX),
        not one ticked at once; `challenges` counts each picture challenge it opened."""
        self._recaptcha = recaptcha
        self.challenges = 0
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
            stub = RECAPTCHA_CHECKBOX if self._recaptcha else RECAPTCHA_STUB
            return route.fulfill(content_type="text/javascript", body=stub % {"onload": json.dumps(onload)})
        if url.startswith("https://www.google.com/recaptcha/api2/anchor"):
            return route.fulfill(content_type="text/html", body=ANCHOR_PAGE)
        if url.startswith("https://www.google.com/recaptcha/api2/bframe"):
            self.challenges += 1
            return route.fulfill(content_type="text/html", body=BFRAME_PAGE)
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
