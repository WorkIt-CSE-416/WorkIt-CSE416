"""The submit guard's shared hostile pages: every click path against every page built to trick it (KAN-666).

Here so far: Fill again, a held page filled anew in a fresh Worker browser, whose page sends as it loads (KAN-682).
"""

import http.server
import sys
import threading
from contextlib import contextmanager
from pathlib import Path

import pytest

from apply.submit_guard import lift

FINAL = "/acme/jobs/123/apply"  # final by its name alone: a path ending in /apply
GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/5442881008"  # a known final URL
START = "/acme/jobs/123/start"

# What a page's script uses to send the application every way it can, once called.
SEND_ALL = """<script>
window.sendAll = () => {
  const body = 'first=Test';
  try { fetch('%(final)s', {method: 'POST', body}).catch(() => {}); } catch (e) {}
  try { const x = new XMLHttpRequest(); x.open('POST', '%(final)s'); x.send(body); } catch (e) {}
  try { navigator.sendBeacon('%(final)s', body); } catch (e) {}
  try { fetch('%(gh)s', {method: 'POST', body}).catch(() => {}); } catch (e) {}
};
</script>""" % {"final": FINAL, "gh": GREENHOUSE}

# --- Fill again: the held page closes, and the form opens anew in a fresh Worker browser under the guard

LOADS_AND_SENDS = f"""<!doctype html><title>Apply</title><form id=f method=post action="{FINAL}"><input name=first value=Test>
<button type=button>Fill again</button></form>{SEND_ALL}<script>addEventListener('load', () => {{ sendAll(); document.getElementById('f').submit(); }});</script>"""


@contextmanager
def local_site(html: str):
    """The page on 127.0.0.1, for a real Worker browser that Playwright can't route before its first load."""
    sent = []

    class Pages(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            sent.append(self.path)
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            body = b"<title>Thanks</title>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_port}{START}", sent
    finally:
        server.shutdown()
        server.server_close()


def test_fill_again_opens_the_form_guarded_before_its_first_load(tmp_path):
    from playwright.sync_api import sync_playwright

    from apply.browsers import WorkerBrowsers
    from apply.rehearsal import _Kept

    with sync_playwright() as playwright:
        if not Path(playwright.chromium.executable_path).exists():
            pytest.skip("no Playwright Chromium here")
    class Bundled(WorkerBrowsers):  # Playwright's Chromium, headless; Linux CI runs it without Chrome's sandbox
        def launch_options(self, worker):
            return super().launch_options(worker) | {"chromium_sandbox": sys.platform == "darwin"}

    kept = _Kept(Bundled(tmp_path / "profiles", headless=True, channel=None), 0)
    again = []
    with local_site(LOADS_AND_SENDS) as (url, sent):
        try:
            with kept.open(url) as page:
                page.wait_for_timeout(800)
                lift(page, again=lambda: again.append(True))  # held for Lisul, as hold()'s hand_over does
                kept._lifted = kept._bound = True
                page.locator("#apply-rehearsal-blocked button", has_text="Fill again").click()
                page.wait_for_timeout(300)
            assert again == [True]
            with kept.open(url) as page:  # Fill again: a fresh, guarded page
                page.wait_for_timeout(1500)
        finally:
            kept.close()
        assert [p for p in sent if p.endswith("/apply") or "submit" in p] == []
