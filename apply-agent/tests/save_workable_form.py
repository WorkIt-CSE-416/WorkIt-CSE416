"""Save a live Workable Posting's form for offline tests. Read-only: never submits.

    uv run python tests/save_workable_form.py <apply-url> ../autofiller_extension/fill-engine/test/fixtures/forms/<name>

Writes <out-dir>/page.har: the /apply page, the Workable scripts it runs and
the API answers it reads (the form's Question set among them). Each dropdown
is opened and each repeating section's editor shown once, so the scripts they
load lazily are saved too. Every request that isn't a GET is aborted, so
nothing can be submitted or uploaded. Re-save a form and rerun the Workable
Filler test to see whether Workable changed it.
"""

import json
import re
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

# The hosts the form needs to render and run. Cloudflare's challenge and
# Turnstile, the employer's logo and analytics are left out; the fake stubs Turnstile.
KEEP_HOSTS = re.compile(r"^(apply\.workable\.com|dcvxs6ggqztsa\.cloudfront\.net)$")
SKIP_PATHS = re.compile(r"/cdn-cgi/")


def save(url: str, out: Path) -> None:
    if not re.search(r"apply\.workable\.com/[^/]+/j/[0-9A-F]+/apply/?$", url):
        raise SystemExit(f"not a Workable /apply URL: {url}")
    out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.har"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(service_workers="block", record_har_path=raw, record_har_content="embed")
            ctx.route("**/*", lambda r: r.continue_() if r.request.method == "GET" else r.abort())
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle")
            page.locator("[data-ui=apply-button]").wait_for()
            decline = page.get_by_role("button", name="Decline all")
            if decline.count():
                decline.click()
            for box in page.locator("input[role=combobox]").all():
                box.click()
                page.keyboard.press("Escape")
            for add in page.locator("button[data-ui=add-section]").all():
                add.click()
                page.locator("[data-ui=editor] button[data-ui=cancel-section]").first.click()
            page.wait_for_load_state("networkidle")
            ctx.close()
            browser.close()
        har = json.loads(raw.read_text())

    entries = {}  # by URL: a script preloaded and then run is listed twice, the first time without its body
    for e in har["log"]["entries"]:
        req, res = e["request"], e["response"]
        host = req["url"].split("/")[2]
        if req["method"] != "GET" or res["status"] <= 0 or not KEEP_HOSTS.match(host) or SKIP_PATHS.search(req["url"]):
            continue
        content = {k: v for k, v in res["content"].items() if k in ("mimeType", "text", "encoding", "size")}
        if len(content.get("text", "")) >= len(entries.get(req["url"], {}).get("response", {}).get("content", {}).get("text", "")):
            entries[req["url"]] = {
                "request": {"method": "GET", "url": req["url"]},
                "response": {"status": res["status"], "content": content},
            }
    entries = list(entries.values())
    (out / "page.har").write_text(json.dumps({"log": {"version": "1.2", "entries": entries}}, indent=1) + "\n")
    print(f"saved {len(entries)} responses to {out}")


if __name__ == "__main__":
    save(sys.argv[1], Path(sys.argv[2]))
