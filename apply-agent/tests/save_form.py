"""Save a live Greenhouse Posting's form for offline tests. Read-only: never submits.

    uv run python tests/save_form.py <posting-url> ../autofiller_extension/fill-engine/test/fixtures/forms/<name> ["<location>" ["<school>"]]

Writes <out-dir>/page.har (the form page and the Greenhouse assets it loads)
and <out-dir>/questions.json (the Job Board API Question set). If the form asks
for a location or has an education block, it also saves the answer to one
search for <location> (Greenhouse's geocoder) and for <school>, typed the way
the Filler types them. Every request
that isn't a GET is aborted, so nothing can be submitted or uploaded. Re-save a
form and rerun its Filler test to see whether the job system changed it.
"""

import json
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

from apply import fill_engine

# Hosts the form needs to render and run. Everything else (Google sign-in,
# Drive and Dropbox pickers, analytics, reCAPTCHA) is left out; the fake job
# server stubs reCAPTCHA.
KEEP_HOSTS = re.compile(
    r"^(job-boards(\.cdn)?\.greenhouse\.io|s\d+-recruiting\.cdn\.greenhouse\.io|boards\.greenhouse\.io|my\.greenhouse\.io"
    r"|api-geocode-earth-proxy\.greenhouse\.io)$"
)


def save(url: str, out: Path, location: str = "", school: str = "") -> None:
    try:
        job_of = fill_engine.job_of(url)  # a hosted page, or the embedded form
        board, job = job_of["board"], job_of["job"]
    except TypeError:
        raise SystemExit(f"not a Greenhouse Posting URL: {url}") from None
    out.mkdir(parents=True, exist_ok=True)
    api = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job}?questions=true"
    questions = json.load(urllib.request.urlopen(api))
    (out / "questions.json").write_text(json.dumps(questions, indent=1) + "\n")

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.har"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(service_workers="block", record_har_path=raw, record_har_content="embed")
            ctx.route("**/*", lambda r: r.continue_() if r.request.method == "GET" else r.abort())
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle")
            # Open each dropdown once so lazily loaded chunks are saved too.
            for box in page.get_by_role("combobox").all():
                box.click()
                page.keyboard.press("Escape")
            for box, text in (("candidate-location", location), ("school--0", school)):
                if text and page.locator(f'[id="{box}"]').count():
                    page.locator(f'[id="{box}"]').click()
                    page.locator(f'[id="{box}"]').fill(text)
                    page.get_by_role("option").first.wait_for()
                    page.keyboard.press("Escape")
            page.wait_for_load_state("networkidle")
            ctx.close()
            browser.close()
        har = json.loads(raw.read_text())

    entries = []
    for e in har["log"]["entries"]:
        req, res = e["request"], e["response"]
        host = req["url"].split("/")[2]
        if req["method"] != "GET" or res["status"] <= 0 or not KEEP_HOSTS.match(host):
            continue
        if "presigned_fields" in req["url"]:
            continue  # short-lived S3 upload credentials; the fake job server makes its own
        content = {k: v for k, v in res["content"].items() if k in ("mimeType", "text", "encoding", "size")}
        entries.append({
            "request": {"method": "GET", "url": req["url"]},
            "response": {"status": res["status"], "content": content},
        })
    entries += _education_lists(board, {e["request"]["url"] for e in entries}) if questions.get("education") else []
    (out / "page.har").write_text(json.dumps({"log": {"version": "1.2", "entries": entries}}, indent=1) + "\n")
    print(f"saved {len(entries)} responses and {len(questions.get('questions', []))} questions to {out}")


def _education_lists(board: str, saved: set[str]) -> list[dict]:
    """Every page of the degree and discipline lists, which the Filler reads
    for the dropdowns' options (the page itself loads only the first)."""
    entries = []
    for kind in ("degrees", "disciplines"):
        page, count = 1, 0
        while True:
            url = f"https://boards.greenhouse.io/v1/boards/{board}/education/{kind}?page={page}"
            text = urllib.request.urlopen(url).read().decode()
            if url not in saved:
                entries.append({"request": {"method": "GET", "url": url},
                                "response": {"status": 200, "content": {"mimeType": "application/json", "text": text}}})
            listed = json.loads(text)
            count += len(listed["items"])
            if not listed["items"] or count >= listed["meta"]["total_count"]:
                break
            page += 1
    return entries


if __name__ == "__main__":
    save(sys.argv[1], Path(sys.argv[2]), *sys.argv[3:5])
