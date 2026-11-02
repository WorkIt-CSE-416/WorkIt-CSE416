"""Save a live Lever Posting's form for offline tests. Read-only: never submits.

    uv run python tests/save_lever_form.py <apply-url> ../autofiller_extension/fill-engine/test/fixtures/forms/<name> "<location>"

Writes <out-dir>/page.har: the /apply page (its HTML carries the Question set),
the Lever scripts it runs, and the answer to one location search for
<location>, typed the way the Filler types it. Every request that isn't a GET
is aborted, so nothing can be submitted, uploaded or parsed. Re-save a form and
rerun the Lever Filler test to see whether Lever changed it.
"""

import json
import re
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

# The host the form needs to render and run. Fonts, hCaptcha, Cloudflare's
# challenge, analytics and the employer's logo are left out; the fake job
# server stubs hCaptcha.
KEEP_HOSTS = re.compile(r"^jobs\.lever\.co$")
SKIP_PATHS = re.compile(r"/cdn-cgi/")


def save(url: str, out: Path, location: str) -> None:
    if not re.search(r"jobs\.lever\.co/[^/]+/[0-9a-f-]{36}/apply$", url):
        raise SystemExit(f"not a Lever /apply URL: {url}")
    out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.har"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(service_workers="block", record_har_path=raw, record_har_content="embed")
            ctx.route("**/*", lambda r: r.continue_() if r.request.method == "GET" else r.abort())
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle")
            box = page.locator("input[name=location]")
            if box.count():
                box.press_sequentially(location)
                page.locator(".dropdown-location").first.wait_for()
            page.wait_for_load_state("networkidle")
            ctx.close()
            browser.close()
        har = json.loads(raw.read_text())

    entries = []
    for e in har["log"]["entries"]:
        req, res = e["request"], e["response"]
        host = req["url"].split("/")[2]
        if req["method"] != "GET" or res["status"] <= 0 or not KEEP_HOSTS.match(host) or SKIP_PATHS.search(req["url"]):
            continue
        content = {k: v for k, v in res["content"].items() if k in ("mimeType", "text", "encoding", "size")}
        entries.append({
            "request": {"method": "GET", "url": req["url"]},
            "response": {"status": res["status"], "content": content},
        })
    (out / "page.har").write_text(json.dumps({"log": {"version": "1.2", "entries": entries}}, indent=1) + "\n")
    print(f"saved {len(entries)} responses to {out}")


if __name__ == "__main__":
    save(sys.argv[1], Path(sys.argv[2]), sys.argv[3])
