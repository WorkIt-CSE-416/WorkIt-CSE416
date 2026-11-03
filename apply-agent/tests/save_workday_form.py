"""Save a live Workday posting up to its sign-in step, for the Workday
Filler's offline tests. Read-only: types nothing, signs in to nothing, submits
nothing.

    uv run python tests/save_workday_form.py <posting-url> ../autofiller_extension/fill-engine/test/fixtures/forms/<name>

Writes <out-dir>/page.har: every GET the posting makes to Workday's own hosts
while it is opened and Apply, then Apply Manually, are clicked, and its sign-in
views are shown (Create Account and Sign In, or "Sign in with email" on a
tenant with Sign in with Google), so their code is saved too. Every request
that isn't a GET is aborted. No headers or cookies are kept, but a
redirect's Location (Workday's unversioned asset URLs redirect to versioned ones).

The steps after sign-in can't be saved without an account, so the fake
Workday (tests/fake_workday.py) builds them itself.
"""

import json
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

WORKDAY_HOSTS = ("myworkdayjobs.com", "myworkdaysite.com", "myworkdaycdn.com", "www.myworkday.com")
# Shown in turn when present: each reveals a sign-in view without typing anything.
VIEWS = ("SignInWithEmailButton", "createAccountLink", "signInLink")


def save(url: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.har"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(service_workers="block", record_har_path=raw, record_har_content="embed")
            ctx.route("**/*", lambda r: r.continue_() if r.request.method == "GET" else r.abort())
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle")
            page.locator("[data-automation-id=adventureButton]").first.click()
            page.locator("[data-automation-id=applyManually]").click()
            page.wait_for_load_state("networkidle")
            for view in VIEWS:
                button = page.locator(f"[data-automation-id={view}]")
                if button.count():
                    button.click()
                    page.wait_for_load_state("networkidle")
            page.wait_for_timeout(2000)
            ctx.close()
            browser.close()
        har = json.loads(raw.read_text())

    entries, seen = [], set()
    for e in har["log"]["entries"]:
        req, res = e["request"], e["response"]
        host = urlsplit(req["url"]).hostname or ""
        if req["method"] != "GET" or res["status"] <= 0 or not host.endswith(WORKDAY_HOSTS) or req["url"] in seen:
            continue
        seen.add(req["url"])
        content = {k: v for k, v in res["content"].items() if k in ("mimeType", "text", "encoding", "size")}
        response = {"status": res["status"], "content": content}
        if 300 <= res["status"] < 400:
            response["redirectURL"] = res.get("redirectURL") or next(
                (h["value"] for h in res["headers"] if h["name"].lower() == "location"), "")
        entries.append({"request": {"method": "GET", "url": req["url"]}, "response": response})
    (out / "page.har").write_text(json.dumps({"log": {"version": "1.2", "entries": entries}}, indent=1) + "\n")
    print(f"saved {len(entries)} responses to {out}")


if __name__ == "__main__":
    save(sys.argv[1], Path(sys.argv[2]))
