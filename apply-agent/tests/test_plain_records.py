"""S5 (KAN-611) live on a plain Worker (Chrome for Testing, no CDP): a Record's full-page screenshot
and page HTML, and Needs you on the page, Go to question, Resume and the emailed code's boxes
through fixed extension functions, on a page whose CSP forbids eval. Then a held rehearsal of a
fake form in a plain Worker: paused, resumed, Go to question, an answer typed on the page.
Skips without Chrome for Testing (CI). Nothing is ever submitted: the fake refuses every POST."""

import http.server
import json
import struct
import tempfile
import threading
import time
import zlib
from contextlib import contextmanager
from pathlib import Path

import pytest
from conftest import ARC_FORM, ARC_URL
from fakes import FakeJobServer, RecordingBoard
from test_rehearse import adapters
from test_run_answers import profile_with

from apply import email_code, on_page, rehearsal, stuck
from apply.fillers import FILLERS
from apply.model import Handoff, Question
from apply.plain.bridge import Bridge, PortError
from apply.plain.launcher import PlainWorkers, chrome_for_testing
from apply.plain.page import PortPage
from apply.profile import ApplicantProfile
from apply.records import FolderRecords

try:
    chrome_for_testing()
    HAVE_CHROME = True
except FileNotFoundError:
    HAVE_CHROME = False

pytestmark = pytest.mark.skipif(not HAVE_CHROME, reason="needs Chrome for Testing (uv run playwright install chromium)")

TALL = 4200  # CSS px: several viewports of the Worker's small window
BANDS = [(255, 0, 0), (0, 160, 0), (0, 0, 255), (255, 160, 0), (0, 160, 160), (120, 0, 120)]
BAND = TALL // len(BANDS)
# No script runs on this page, and none may: its CSP forbids eval, so only fixed functions work.
LONG = f"""<!doctype html><html><head><title>Tall form</title>
<style>body {{ margin: 0; font: 16px sans-serif; }}
header {{ position: sticky; top: 0; height: 60px; background: rgb(255, 0, 255); z-index: 9; }}
.band {{ height: {BAND}px; }} .field {{ padding: 8px; background: white; }}
#err {{ color: #b00; }}</style></head><body>
<header id="top">Acme careers</header>
{''.join(f'<div class="band" style="background: rgb{c}"></div>' for c in BANDS[:3])}
<form>
  <div class="field"><label for="first">First Name</label><input id="first" name="first"></div>
  <div class="field"><label for="email">Email</label><input id="email" name="email" aria-invalid="true" aria-describedby="err">
    <span id="err">Enter a valid email address</span></div>
  <div class="field"><label for="pw">Password</label><input id="pw" type="password" name="pw"></div>
  <div class="field"><label for="code">Security code</label><input id="code" name="security_code" autocomplete="one-time-code"></div>
  <div class="field"><label for="zip">Zip code</label><input id="zip" name="zip"></div>
</form>
{''.join(f'<div class="band" style="background: rgb{c}"></div>' for c in BANDS[3:])}
</body></html>"""
CSP = "script-src 'none'; object-src 'none'"


def png_pixels(data: bytes) -> tuple[int, int, list[bytes]]:
    """(width, height, rows of RGBA bytes) of an 8-bit RGBA or RGB, non-interlaced PNG."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    at, chunks, width = 8, b"", 0
    while at < len(data):
        size, kind = struct.unpack(">I4s", data[at:at + 8])
        body = data[at + 8:at + 8 + size]
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and color in (2, 6)
            channels = 4 if color == 6 else 3
        elif kind == b"IDAT":
            chunks += body
        at += 12 + size
    raw, stride, rows, previous = zlib.decompress(chunks), width * channels, [], bytearray(width * channels)
    for y in range(height):
        kind, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            b, c = previous[x], previous[x - channels] if x >= channels else 0
            if kind == 1:
                line[x] = (line[x] + a) & 255
            elif kind == 2:
                line[x] = (line[x] + b) & 255
            elif kind == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line) if channels == 4 else bytes(v for i in range(width) for v in (*line[i * 3:i * 3 + 3], 255)))
        previous = line
    return width, height, rows


def pixel(rows: list[bytes], x: int, y: int) -> tuple[int, int, int]:
    return tuple(rows[y][x * 4:x * 4 + 3])


def near(color, wanted, slack: int = 40) -> bool:
    return all(abs(a - b) <= slack for a, b in zip(color, wanted))


@contextmanager
def served(pages: dict[str, str]):
    """`pages` (path -> HTML) on 127.0.0.1 under CSP; every POST is refused."""
    class Pages(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = pages.get(self.path.split("?")[0])
            self.send_response(200 if body else 404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Security-Policy", CSP)
            self.end_headers()
            self.wfile.write((body or "").encode())

        def do_POST(self):
            self.send_response(403)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()


@pytest.fixture(scope="module")
def site():
    with served({"/long": LONG}) as url:
        yield url


@pytest.fixture(scope="module")
def workers():
    folder = Path(tempfile.mkdtemp(prefix="apw-s5-", dir="/tmp"))
    workers = PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"))  # its own socket
    yield workers
    workers.stop_all()


@pytest.fixture
def page(workers, site) -> PortPage:
    page = PortPage.first(workers.launch(0).connection)
    page.goto(f"{site}/long")
    return page


def test_page_code_is_refused_here_so_what_works_below_is_the_fixed_functions(page):
    with pytest.raises(PortError):
        page.evaluate("() => 1 + 1")


def test_a_full_page_screenshot_stitches_the_whole_page_with_its_sticky_header_once(page, tmp_path):
    page.locator("#first").scroll_into_view_if_needed()  # the page is mid-scroll, as Lisul may leave it
    view = page.viewport_size
    shot = page.screenshot(full_page=True, path=tmp_path / "form.png")
    width, height, rows = png_pixels(shot)
    page_height = 60 + TALL + page.locator("form").bounding_box()["height"]
    assert width == view["width"]  # the window's width, at 1 px per CSS px
    assert abs(height - page_height) <= 2
    assert near(pixel(rows, 200, 30), (255, 0, 255))  # the header, at the top
    magenta = [y for y in range(0, height, 10) if near(pixel(rows, 600, y), (255, 0, 255))]
    assert max(magenta) < 60  # and nowhere else: hidden after the first strip
    for n, color in enumerate(BANDS):  # every band, where the page has it: nothing stale or doubled
        y = 60 + n * BAND + BAND // 2 + (0 if n < 3 else int(page.locator("form").bounding_box()["height"]))
        assert near(pixel(rows, 600, y), color), (n, pixel(rows, 600, y))
    assert (tmp_path / "form.png").read_bytes() == shot
    assert page.locator("#first").bounding_box()["y"] < view["height"]  # the page is back where it was
    _, form_height, rows = png_pixels(page.locator("form").screenshot())  # an element, cut from a stitch
    assert abs(form_height - page.locator("form").bounding_box()["height"]) <= 2
    assert near(pixel(rows, 600, 5), (255, 255, 255))


def test_a_records_html_has_the_values_shown_and_no_password_or_script(page):
    page.fill("#first", "Testy")
    page.fill("#pw", "hunter2-secret")
    html = page.record_html()
    assert 'value="Testy"' in html and "hunter2-secret" not in html
    assert "<script" not in html and "<base href=" in html and html.startswith("<!DOCTYPE html>")
    assert "Testy" not in page.content()  # Playwright's content(): the page's own HTML


def test_go_to_question_and_the_watch_run_without_eval(page, monkeypatch):
    monkeypatch.setattr(on_page, "IDLE_S", 0.2)
    email = Question("email", "Email", "text", required=True)
    assert on_page.go_to(page, email) == ""
    assert on_page._in_frames(page, email, "read")["focused"]  # focused (document.activeElement: the window is behind)
    assert "solid" in page.locator(".field:has(#email)").get_attribute("style")  # and outlined
    watch = on_page.Watch("acme")
    assert watch.tick(page, [email]) == []  # the field as Apply left it
    page.keyboard.type("testy@example.com")
    page.locator("#email").blur()
    assert watch.tick(page, [email]) == []  # changed just now: not yet his answer
    time.sleep(0.3)
    assert watch.tick(page, [email]) == [(email, "testy@example.com")]  # his answer, once he left it


def test_resumes_field_error_and_the_emailed_codes_boxes_run_without_eval(page):
    assert stuck.field_error(page) == "Enter a valid email address"
    boxes = email_code._boxes(page)
    assert [key.split("|")[1].split()[0] for key, _ in boxes] == ["code"]  # the code box, never the zip
    email_code._in_frames(page, email_code.ARM)  # the switches run too (S4's guard reads them)


# --- a held rehearsal in a plain Worker

FORM = Question("first", "First Name", "text", required=True), Question("email", "Email", "text", required=True)


class PlainSite:
    """The job site in a plain Worker: Arc Boat Company's Posting (the saved Greenhouse form's API, read
    Apply-side), its form a fake on 127.0.0.1 under CSP."""

    def __init__(self, workers: PlainWorkers, form_url: str, fake: FakeJobServer):
        self._workers, self._form_url, self._fake = workers, form_url, fake
        self.pages: list[PortPage] = []

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        return self._fake.fetch(url, body)

    @contextmanager
    def open(self, url: str, worker: int = 0):
        with self._workers.open(self._form_url, worker) as page:
            self.pages.append(page)
            yield page


class PausesOnce:
    """A Filler for the fake form: its first fill stops for Lisul (a Handoff, as a step that won't leave);
    after his Resume it fills First Name and reads both fields back. It never submits."""

    def __init__(self):
        self.fills = 0

    def question_set(self, url, site):
        return list(FORM)

    def fill(self, page, questions, answers):
        self.fills += 1
        if self.fills == 1:
            raise Handoff("the form's step wants a fix only you can make")
        if answers.get("first"):
            page.fill("#first", answers["first"])
        return {q.name: page.input_value(f"#{q.name}") or None for q in questions}

    def submit(self, page):
        pytest.fail("a rehearsal called the Filler's submit")


class Lisul(RecordingBoard):
    """In the Apply window: Resume on the paused card; then Go to question on Email, his answer typed
    into the field it focused, Tab; the page closes once Apply took it."""

    def __init__(self, site: PlainSite):
        super().__init__()
        self.site, self.focused, self.said = site, [], []
        self._resumed = self._turn = 0

    def resumed(self, worker):
        if self._resumed or self.captions.get(worker, {}).get("status") == "filling":
            return False
        self._resumed += 1
        return True

    def wanted(self, worker):
        if not self.captions.get(worker, {}).get("missing") and not getattr(self, "typed_in", None):
            return []
        if not self._resumed or self.site.pages[-1].is_closed():
            return []
        self._turn += 1
        page = self.site.pages[-1]
        if self._turn == 1:
            return [("Email", self.said.append)]
        if self._turn == 2:
            self.focused.append(on_page._in_frames(page, FORM[1], "read").get("focused"))
            page.keyboard.type("testy@example.com")
            page.keyboard.press("Tab")
        elif getattr(self, "typed_in", None):
            page.close()
        return []


def test_a_held_rehearsal_in_a_plain_worker_pauses_resumes_and_takes_an_answer_typed_on_the_page(
        monkeypatch, tmp_path, workers):
    filler = PausesOnce()
    monkeypatch.setitem(FILLERS, "greenhouse", filler)
    monkeypatch.setattr(on_page, "IDLE_S", 0.5)
    profile = profile_with(tmp_path, **{"identity.email": None})
    lines = []
    with FakeJobServer(ARC_FORM) as fake, served({"/form": LONG}) as url:
        site = PlainSite(workers, f"{url}/form", fake)
        board = Lisul(site)
        rehearsal.rehearse([ARC_URL], adapters(site, board=board, records=FolderRecords(tmp_path / "rehearsals")),
                           ApplicantProfile.load(profile), 1, keep_open=True, out=lines.append)

    assert filler.fills == 2  # paused, then Resume went on
    assert any("Resumed: you pressed Resume" in h for h in board.captions[0]["history"])
    assert board.said == [""] and board.focused == [True]  # Go to question focused the field
    assert board.typed_in == [(0, ["Email"], "testy@example.com")]  # his answer typed on the page is taken
    assert board.captions[0]["missing"] == []  # and its card leaves Needs you
    [readme] = (tmp_path / "rehearsals").glob("*/*/README.md")
    record = readme.parent
    _, height, _ = png_pixels((record / "form.png").read_bytes())
    assert height > 4000  # the whole page, not the window
    html = (record / "page.html").read_text()
    assert 'id="first" name="first" value="Test"' in html and "[page.html](page.html)" in readme.read_text()
    [row] = [r for r in json.loads((record / "answers.json").read_text()) if r["question"] == "Email"]
    assert row["planned"] == row["on_page"] == "testy@example.com"
    assert fake.submissions == []
