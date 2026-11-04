"""The plain Workers' demos: `apply plain ping` and `apply plain fill <url>`."""

import base64
import http.server
import json
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from apply import fill_engine
from apply.home import SAMPLE
from apply.model import FillError, Posting
from apply.plain.launcher import PlainWorkers
from apply.plain.script import evaluate
from apply.profile import ApplicantProfile

BLANK = b"<!doctype html><title>Apply plain Worker</title><p>A page on 127.0.0.1 for the ping."


@contextmanager
def local_page(body: bytes = BLANK):
    """A page served on 127.0.0.1 while the block runs: its URL."""
    class Page(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/"
    finally:
        server.shutdown()


def ping(count: int = 1, kind: str | None = None) -> list[str]:
    """Start `count` plain Workers, report each one's hello and checks, and quit them."""
    workers = PlainWorkers(kind=kind)
    lines = []
    try:
        with local_page() as url:
            for worker in range(count):
                running = workers.launch(worker)
                hello, connection = running.connection.hello, running.connection
                tab = connection.call("tabs.create", url=url)["tab"]
                for _ in range(100):
                    if connection.call("tabs.get", tab=tab)["status"] == "complete":
                        break
                    time.sleep(0.1)
                webdriver = evaluate(connection, tab, "() => navigator.webdriver")
                port_file = (running.profile / "DevToolsActivePort").exists()
                lines.append(f"plain Worker {worker + 1} (pid {running.pid}, {workers.kind}): extension {hello['extension']}, "
                             f"Fill engine {hello['engine']['version']}, user scripts {'on' if hello['userScripts'] else 'off'}, "
                             f"navigator.webdriver: {str(webdriver).lower()} (service worker: {str(hello['webdriver']).lower()}), "
                             f"DevToolsActivePort: {'present' if port_file else 'none'}")
    finally:
        workers.stop_all()
    return lines


SAVED_FORMS = fill_engine.ENGINE_DIR / "test" / "fixtures" / "forms"


@contextmanager
def replay(folder: Path):
    """A saved form (the engine's fixtures: a HAR of its page) served on 127.0.0.1, by path, as
    its job system served it. Only GETs of its own host's paths are answered; any POST is refused,
    so nothing can be sent. Yields (local URL, the form's real URL)."""
    har = json.loads((folder / "page.har").read_text())
    first = har["log"]["entries"][0]["request"]["url"]
    host = urlsplit(first).netloc
    responses = {}
    for entry in har["log"]["entries"]:
        url = urlsplit(entry["request"]["url"])
        if url.netloc != host:
            continue
        content = entry["response"]["content"]
        text = content.get("text", "")
        body = base64.b64decode(text) if content.get("encoding") == "base64" else text.encode()
        responses.setdefault(url.path, (content.get("mimeType") or "text/html", body))

    class Saved(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            kind, body = responses.get(urlsplit(self.path).path, ("text/plain", b""))
            self.send_response(200 if body else 404)
            self.send_header("Content-Type", kind)
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            self.send_response(403)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Saved)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}{urlsplit(first).path}", first
    finally:
        server.shutdown()


def fill(target: str, kind: str | None = None) -> list[str]:
    """Fill a form in a plain Worker as Test Person (the sample's made-up applicant) with the
    engine, and report what the page shows. `target` is a saved form's name (lever-immuta), never a
    live posting. Essays are left blank, and nothing is ever submitted."""
    folder = SAVED_FORMS / target
    if not (folder / "page.har").exists():
        raise SystemExit(f"No saved form {target!r}: pick one of {', '.join(sorted(p.name for p in SAVED_FORMS.iterdir() if (p / 'page.har').exists()))}")
    profile = ApplicantProfile.load(SAMPLE / "applicant-profile.yaml")
    workers = PlainWorkers(kind=kind)
    with replay(folder) as (url, real_url):
        site = fill_engine.job_of(real_url)["site"]
        try:
            with workers.open(url) as page:
                try:
                    questions = fill_engine.read_questions(page, site)
                except FillError:  # a job system whose questions come from its served page (Lever)
                    questions = fill_engine.parse_questions(site, page.evaluate("() => document.documentElement.outerHTML"))
                posting = Posting(target, "Saved form", "Intern", real_url)
                planned = fill_engine.plan(questions, posting, profile)
                answers = {name: value for name, value in planned.answers.items() if value not in (None, "")}
                left = []
                for _ in range(5):  # a field that needs the job system's live API (Lever's location search) is left
                    try:
                        readback = fill_engine.fill(page, site, questions, answers)
                        break
                    except FillError as error:
                        name = str(error).split(":", 1)[0]
                        if name not in answers:
                            raise
                        answers.pop(name)
                        left.append(str(error))
                problems = fill_engine.readback_problems(questions, answers, readback, planned.accepted)
                shown = sum(1 for name in answers if readback.get(name) not in (None, "", []))
                lines = [f"{target} ({site}) in plain Worker 1 at {url}: {len(questions)} questions, {len(answers)} answered, "
                         f"{shown} shown on the page, {len(problems)} read-back problems. Nothing was sent."]
                lines += [f"  {q.label}: {readback.get(q.name)!r}" for q in questions if q.name in answers][:25]
                lines += [f"  problem: {p}" for p in problems]
                lines += [f"  left: {why}" for why in left]
                return lines
        finally:
            workers.stop_all()
