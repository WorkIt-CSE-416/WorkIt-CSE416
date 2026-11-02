"""Save a live form on a job system with no Filler, for Claude fill's
offline tests. Read-only: never submits.

    uv run python tests/save_page.py <posting-url> ../autofiller_extension/fill-engine/test/fixtures/forms/<name> ["<button to click>" ...]

Writes <out-dir>/page.har: every GET the page makes to its own site (hosts
sharing the posting's domain, plus its job system's static host in ALSO,
minus analytics), after clicking each named button in turn (such as "Apply
for This Job") so the form and its lazily loaded code are saved too. Every request that isn't a GET is aborted, so
nothing can be submitted or uploaded.
"""

import json
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ANALYTICS = re.compile(r"pendo|analytics|rum|metrics|telemetry|segment|sentry", re.IGNORECASE)
# Other hosts a job system serves its own pages' code from.
ALSO = {"oraclecloud.com": ("static.oracle.com",)}


def save(url: str, out: Path, clicks: list[str]) -> None:
    domain = ".".join(urlsplit(url).hostname.split(".")[-2:])
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.har"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(service_workers="block", record_har_path=raw, record_har_content="embed")
            ctx.route("**/*", lambda r: r.continue_() if r.request.method == "GET" else r.abort())
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle")
            for name in clicks:
                page.get_by_role("button", name=name).first.click()
                page.wait_for_load_state("networkidle")
            page.wait_for_timeout(2000)
            ctx.close()
            browser.close()
        har = json.loads(raw.read_text())

    entries = []
    for e in har["log"]["entries"]:
        req, res = e["request"], e["response"]
        host = urlsplit(req["url"]).hostname
        ours = host == domain or host.endswith("." + domain) or host in ALSO.get(domain, ())
        if req["method"] != "GET" or res["status"] <= 0 or not ours:
            continue
        if ANALYTICS.search(host):
            continue
        content = {k: v for k, v in res["content"].items() if k in ("mimeType", "text", "encoding", "size")}
        entries.append({
            "request": {"method": "GET", "url": req["url"]},
            "response": {"status": res["status"], "content": content},
        })
    (out / "page.har").write_text(json.dumps({"log": {"version": "1.2", "entries": entries}}, indent=1) + "\n")
    print(f"saved {len(entries)} responses to {out}")


if __name__ == "__main__":
    save(sys.argv[1], Path(sys.argv[2]), sys.argv[3:])
