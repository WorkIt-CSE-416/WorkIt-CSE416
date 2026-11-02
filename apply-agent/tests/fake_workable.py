"""A fake Workable: serves saved Workable forms (page.har from
tests/save_workable_form.py) to a headless browser, takes file uploads the
way Workable's storage does, and records what would have been submitted.
Nothing here touches the network. Implements the JobSite adapter."""

import base64
import json
import re
from contextlib import contextmanager
from pathlib import Path

from fakes import Submission
from playwright.sync_api import Route, sync_playwright

UPLOAD_GRANT = re.compile(r"^https://apply\.workable\.com/api/v1/jobs/(\w+)/form/upload/(\w+)\?")
STORAGE = "https://workable-application-form.s3.us-east-1.amazonaws.com"
APPLY = re.compile(r"^https://apply\.workable\.com/api/v1/jobs/(\w+)/apply$")
# Workable keeps an unsent form in local storage under this key and restores it.
DRAFT_KEY = "evergreen-persistence-%s"
# Leaves `draft` in local storage once, as an earlier visit to the form would have.
SEED_DRAFT = """
if (!sessionStorage.getItem('fake-draft-seeded')) {
  localStorage.setItem(%(key)s, %(draft)s);
  sessionStorage.setItem('fake-draft-seeded', '1');
}
"""
# Holds back each upload to storage `ms` before it is sent, as a slow network would.
SLOW_STORAGE = """
(() => {
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__url = String(url); return open.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__url.startsWith(%(storage)s)) { setTimeout(() => send.apply(this, args), %(ms)d); return; }
    return send.apply(this, args);
  };
})();
"""
TURNSTILE_STUB = """
window.turnstile = {
  render: function (el, opts) { setTimeout(function () { opts && opts.callback && opts.callback('fake-turnstile-token'); }); return 'fake'; },
  execute: function () {}, reset: function () {}, remove: function () {},
  getResponse: function () { return 'fake-turnstile-token'; }, isExpired: function () { return false; },
};
"""


def _load_responses(folder: Path) -> dict[str, tuple[int, str, bytes]]:
    responses = {}
    for entry in json.loads((folder / "page.har").read_text())["log"]["entries"]:
        content = entry["response"]["content"]
        text = content.get("text", "")
        body = base64.b64decode(text) if content.get("encoding") == "base64" else text.encode()
        responses.setdefault(entry["request"]["url"], (entry["response"]["status"], content["mimeType"], body))
    return responses


class FakeWorkableServer:
    """Serves saved Workable forms. Every request it has no answer for is refused."""

    def __init__(self, *forms: Path, draft: dict[str, dict] | None = None, storage_delay: int = 0):
        """`draft` maps a Posting's shortcode to the unsent answers Workable
        restores when its form opens; `storage_delay` holds back each file's
        upload to storage that many ms, as a slow network would."""
        self._responses: dict[str, tuple[int, str, bytes]] = {}
        for form in forms:
            self._responses.update(_load_responses(form))
        self._draft = draft or {}
        self._storage_delay = storage_delay
        self.uploads: list[str] = []  # the field of each file Workable asked to store
        self.stored = 0  # how many files reached storage
        self.submissions: list[Submission] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        if url in self._responses and body is None:
            status, _, saved = self._responses[url]
            if status >= 400:
                raise LookupError(f"fake Workable answered {status} at {url}")
            return saved
        raise LookupError(f"fake Workable has nothing saved at {url}")

    @contextmanager
    def open(self, url: str, worker: int = 0):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(service_workers="block")
            for shortcode, draft in self._draft.items():
                context.add_init_script(SEED_DRAFT % {"key": json.dumps(DRAFT_KEY % shortcode),
                                                      "draft": json.dumps(json.dumps(draft))})
            if self._storage_delay:
                context.add_init_script(SLOW_STORAGE % {"storage": json.dumps(STORAGE), "ms": self._storage_delay})
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
        if url.startswith("https://challenges.cloudflare.com/turnstile/"):
            return route.fulfill(content_type="text/javascript", body=TURNSTILE_STUB)
        if request.method == "GET" and (grant := UPLOAD_GRANT.match(url)):
            self.uploads.append(grant.group(2))
            return route.fulfill(content_type="application/json", body=json.dumps({
                "downloadUrl": f"{STORAGE}/tmp/fake/{len(self.uploads)}",
                "uploadPostUrl": {"url": STORAGE, "fields": {"key": f"tmp/fake/{len(self.uploads)}"}},
            }))
        if request.method == "POST" and url.rstrip("/") == STORAGE:
            self.stored += 1
            return route.fulfill(status=204, body="")
        if request.method == "POST" and APPLY.match(url):
            self.submissions.append(Submission(url=url, application=json.loads(request.post_data or "{}"), files={}))
            return route.fulfill(content_type="application/json", body="{}")
        if request.method == "GET" and url in self._responses:
            status, mime, body = self._responses[url]
            return route.fulfill(status=status, content_type=mime, body=body)
        route.abort()
