"""The plain Workers' demos: `apply plain ping` and `apply plain fill <url>`."""

import http.server
import threading
import time
from contextlib import contextmanager

from apply.plain.launcher import PlainWorkers
from apply.plain.script import evaluate

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
