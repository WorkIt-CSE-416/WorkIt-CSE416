"""Save a live Ashby Posting's form for offline tests. Read-only: never submits.

    uv run python tests/save_ashby_form.py <posting-url> ../autofiller_extension/fill-engine/test/fixtures/forms/<name> [<city> [<school>]]

Writes <out-dir>/page.har (the form page, the Ashby assets it loads and the
answers to the page's own read-only GraphQL queries) and <out-dir>/questions.json
(the answer to the Filler's Question set query). Every request that isn't a GET
or a GraphQL `query` is aborted, so no field is saved on Ashby's side, no file
is uploaded and nothing is submitted. With <city>, each location field's search
for it (Ashby's own place search) is saved too, typed as the Filler types it; with <school>, the
education entry's school search for it. Re-save a form and rerun its Filler test to see whether Ashby changed it.
"""

import json
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

from playwright.sync_api import Route, sync_playwright

from apply import fill_engine
from apply.ashby import EDUCATION

PLACE = ".ashby-application-form-input-autocomplete"  # a box whose options come from a search (a city, a school)

# Hosts the form needs to render and run. reCAPTCHA (stubbed by the fake job
# server), SEON device fingerprinting and analytics are left out.
KEEP_HOSTS = re.compile(r"^(jobs\.ashbyhq\.com|app\.ashbyhq\.com|cdn\.ashbyprd\.com)$")


def _is_query(body: str | None) -> bool:
    try:
        return json.loads(body or "")["query"].lstrip().startswith("query ")
    except (ValueError, KeyError, TypeError, AttributeError):
        return False


def _read_only(route: Route) -> None:
    request = route.request
    if request.method == "GET" or (request.method == "POST" and _is_query(request.post_data)):
        return route.continue_()
    route.abort()


def save(url: str, out: Path, city: str = "", school: str = "") -> None:
    job = fill_engine.job_of(url)
    assert job and job["site"] == "ashby", f"not an Ashby Posting URL: {url}"
    out.mkdir(parents=True, exist_ok=True)
    answers = []

    class Asking:  # the engine asks Ashby with its own query; its answer is what gets saved
        def fetch(self, url, body=None):
            headers = {"content-type": "application/json", "user-agent": "Mozilla/5.0"}
            answers.append(urllib.request.urlopen(urllib.request.Request(url, body, headers)).read())
            return answers[-1]

    fill_engine.fetched_question_set(url, Asking())
    questions = json.loads(answers[0])
    (out / "questions.json").write_text(json.dumps(questions, indent=1) + "\n")

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.har"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(service_workers="block", record_har_path=raw, record_har_content="embed")
            ctx.route("**/*", _read_only)
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle")
            page.locator("[data-field-path]").first.wait_for()
            page.wait_for_load_state("networkidle")
            for box in page.locator(f'[data-field-path]:not([data-field-path="{EDUCATION}"]) {PLACE}').all() if city else []:
                with page.expect_response(lambda r: "op=ApiAutocompleteGeoLocation" in r.url):
                    box.fill(city)
                page.wait_for_load_state("networkidle")
            for box in page.locator(f'[data-field-path="{EDUCATION}"] {PLACE}').all() if school else []:
                with page.expect_response(lambda r: "op=ApiSearchSchoolByCanonicalName" in r.url):
                    box.fill(school)
                page.wait_for_load_state("networkidle")
            ctx.close()
            browser.close()
        har = json.loads(raw.read_text())

    entries = []
    for e in har["log"]["entries"]:
        req, res = e["request"], e["response"]
        host = req["url"].split("/")[2]
        if res["status"] <= 0 or not KEEP_HOSTS.match(host):
            continue
        request = {"method": req["method"], "url": req["url"]}
        if req["method"] == "POST":
            body = (req.get("postData") or {}).get("text")
            if not _is_query(body):
                continue
            # The fake job server tells the page's queries apart by their variables.
            request["postData"] = {"mimeType": "application/json", "text": body}
        elif req["method"] != "GET":
            continue
        content = {k: v for k, v in res["content"].items() if k in ("mimeType", "text", "encoding", "size")}
        entries.append({"request": request, "response": {"status": res["status"], "content": content}})
    (out / "page.har").write_text(json.dumps({"log": {"version": "1.2", "entries": entries}}, indent=1) + "\n")
    posting = questions["data"]["jobPosting"]
    print(f"saved {len(entries)} responses for {posting['title']!r} to {out}")


if __name__ == "__main__":
    save(sys.argv[1], Path(sys.argv[2]), *sys.argv[3:5])
