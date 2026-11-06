"""The live tile and Fix from the window on a plain Worker (S3, KAN-609): Chrome for Testing
with the worker extension, no CDP; the Apply window is a headless Chromium page, as in
test_dashboard. Fake forms only. Skips without Chrome for Testing (CI)."""

import base64
import http.server
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from apply.dashboard import Dashboard, jpeg_size
from apply.plain import demo, window_capture
from apply.plain.bridge import Bridge, PortTimeoutError
from apply.plain.launcher import PlainWorkers, chrome_for_testing
from apply.plain.page import PortPage
from apply.plain.tile import PortFrames

try:
    chrome_for_testing()
    HAVE_CHROME = True
except FileNotFoundError:
    HAVE_CHROME = False

pytestmark = pytest.mark.skipif(not HAVE_CHROME, reason="needs Chrome for Testing (uv run playwright install chromium)")

PAGES = {
    "/fields": ("<!doctype html><style>input { display: block; width: 90%; height: 45vh; font-size: 40px }</style>"
                "<input id=a><input id=b>"),
    "/select": ("<!doctype html><select id=s style='width: 100%; height: 50vh; font-size: 40px'>"
                "<option>Choose one<option>Yes<option>No</select><script>s.onchange = () => document.title = 'changed'</script>"),
    "/file": ("<!doctype html><input id=f type=file style='width: 100%; height: 50vh'>"
              "<script>f.onchange = () => document.title = f.files[0].name + ' ' + f.files[0].size</script>"),
    # A dropzone: its button's script clicks a hidden file input, as react-dropzone does.
    "/dropzone": ("<!doctype html><input id=f type=file hidden multiple><button id=b style='width: 100%; height: 50vh'>Upload</button>"
                  "<script>b.onclick = () => f.click(); f.onchange = () => document.title = [...f.files].map(x => x.name).join(',')</script>"),
    # Four buttons, one per quarter of the viewport: a click says which one it reached.
    "/quarters": ("<!doctype html><title>none</title><style>body { margin: 0 } button { position: fixed; width: 50vw; height: 50vh; border: 0 }"
                  "</style><button id=tl style='left: 0; top: 0'>tl</button><button id=tr style='left: 50vw; top: 0'>tr</button>"
                  "<button id=bl style='left: 0; top: 50vh'>bl</button><button id=br style='left: 50vw; top: 50vh'>br</button>"
                  "<script>for (const b of document.querySelectorAll('button')) b.onclick = () => document.title = b.id</script>"),
    "/colour": "<!doctype html><title>Colour</title><body style='margin: 0; background: rgb(220, 30, 30)'><h1 id=h>Step 1</h1>",
    "/tall": ("<!doctype html><div id=box style='height: 200px; overflow: auto'><div style='height: 2000px'>inner</div></div>"
              "<div style='height: 4000px'>page</div>"),
    "/framed": "<!doctype html><h1 style='height: 100px; margin: 0'>Outer</h1><iframe id=i style='width: 600px; height: 300px; border: 0'></iframe>",
    "/inner": "<!doctype html><input id=x style='width: 400px; height: 100px; font-size: 30px'>",
    # A page that changes every frame, to count the tile's frames a second.
    "/ticking": ("<!doctype html><h1 id=n style='font-size: 80px'>0</h1>"
                 "<script>let n = 0; const h = document.getElementById('n');"
                 "(function tick() { h.textContent = ++n; requestAnimationFrame(tick) })()</script>"),
}

FILMED = window_capture.mode() == "native" and window_capture.allowed()


def serve():
    class Pages(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(PAGES.get(self.path.split("?")[0], "<p>none").encode())

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


@pytest.fixture(scope="module")
def site():
    server = serve()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture(scope="module")
def workers():
    """One plain Worker for every test here, started in the background (never in front), stopped after."""
    folder = Path(tempfile.mkdtemp(prefix="apw-tile-", dir="/tmp"))
    workers = PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "t.sock"))  # its own socket
    workers.launch(0)
    yield workers
    workers.stop_all()


@pytest.fixture(scope="module")
def worker(workers):
    return workers.launch(0)


@pytest.fixture
def page(worker) -> PortPage:
    return PortPage.first(worker.connection)


@pytest.fixture
def frames(worker):
    """The tile from the extension's frames (captureVisibleTab), as without Screen Recording."""
    with PortFrames(1, lambda k: worker.connection, capture="extension") as frames:
        yield frames


@pytest.fixture
def filmed(worker):
    """The tile filmed by ScreenCaptureKit (KAN-635): needs Screen Recording for the app pytest runs in."""
    if not FILMED:
        pytest.skip(f"no Screen Recording permission ({window_capture.SETTINGS})")
    with PortFrames(1, lambda k: worker.connection, capture="native") as frames:
        yield frames


@pytest.fixture
def window():
    """The Apply window: a page in a throwaway headless Chromium (not a Worker)."""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            yield browser.new_page(viewport={"width": 900, "height": 600})
        finally:
            browser.close()


def until(read, expected, seconds: float = 10):
    deadline = time.monotonic() + seconds
    while (value := read()) != expected and time.monotonic() < deadline:
        time.sleep(0.2)
    return value


def shown(window, board, frames, page, path_url):
    """The window on the Workers tab, with tile 0 showing `path_url` live and taken control of;
    returns where the tile's frame is."""
    page.goto(path_url)
    after = frames.wait(0, 0, 0)[1]
    frames.wait(0, after, 10)  # a frame of this page
    window.goto(board.url + "/#workers")
    window.wait_for_function("document.getElementById('frame-0').naturalWidth > 0", timeout=10_000)
    window.click(".tile[data-k='0'] img")
    window.wait_for_selector(".tile.big[data-k='0'] .note", state="visible")
    window.wait_for_timeout(300)
    return window.locator("#frame-0").bounding_box()


def pixel(window, jpeg: bytes, x: int, y: int) -> list[int]:
    """The (r, g, b) at (x, y) of a JPEG, decoded in the window's Chromium."""
    return window.evaluate("""async ([data, x, y]) => {
      const bitmap = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + data)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), g = canvas.getContext('2d');
      g.drawImage(bitmap, 0, 0);
      return [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
    }""", [base64.b64encode(jpeg).decode(), x, y])


def test_a_covered_workers_tile_gets_live_frames_of_its_page(page, frames, site, window):
    # The Worker started with `open -g`: behind Lisul's front app, never activated, so its window is covered.
    page.goto(f"{site}/colour")
    first, seen = frames.wait(0, 0, 15)
    behind = page.evaluate("() => [document.hasFocus(), document.visibilityState]")
    page.evaluate("() => { document.body.style.background = 'rgb(30, 30, 220)'; document.getElementById('h').textContent = 'Step 2' }")
    later, moved = frames.wait(0, seen, 10)
    # Frames come only when the picture changed: nothing new on an unchanged page.
    time.sleep(1.5)
    _, still = frames.wait(0, moved, 0)

    assert behind == [False, "visible"]  # not the front window, still painting
    assert first.startswith(b"\xff\xd8") and moved > seen and later != first
    width, height = jpeg_size(later)
    assert width <= 1280 and height <= 900 and abs(width - page.viewport_size["width"]) <= 1  # CSS size, not Retina
    assert still == moved
    red, blue = pixel(window, first, width // 2, height - 5), pixel(window, later, width // 2, height - 5)
    assert red[0] > 150 and red[2] < 100 and blue[2] > 150 and blue[0] < 100  # the new blue, not a stale red


def frames_a_second(frames, seconds: float = 3.0) -> float:
    start = frames.wait(0, 0, 0)[1]
    began = time.monotonic()
    while time.monotonic() - began < seconds:
        frames.wait(0, frames.wait(0, 0, 0)[1], 1)
    return (frames.wait(0, 0, 0)[1] - start) / (time.monotonic() - began)


def test_a_filmed_tile_is_live_at_the_screens_full_scale(page, filmed, site, worker):
    page.goto(f"{site}/ticking")
    filmed.wait(0, 0, 15)
    rate = frames_a_second(filmed)
    width, height = jpeg_size(filmed.frame(0))
    viewport = page.viewport_size

    assert filmed.native == {0: True} and filmed.notice(0) == ""
    assert rate >= 25, f"{rate:.1f} frames a second"
    assert width >= viewport["width"] * 2 - 2 and abs(width / height - viewport["width"] / viewport["height"]) < 0.02  # Retina, only the page


def test_without_screen_recording_the_tile_falls_back_and_says_where_to_turn_it_on(page, worker, site, monkeypatch):
    monkeypatch.setattr(window_capture, "allowed", lambda: False)
    with PortFrames(1, lambda k: worker.connection, capture="native") as frames, Dashboard(1, frames) as board:
        page.goto(f"{site}/colour")
        frame = frames.wait(0, 0, 15)[0]
        line = until(lambda: board.state()["tiles"][0].get("capture", ""), frames.notice(0), 5)

        assert frames.native == {} and frame.startswith(b"\xff\xd8")
        assert jpeg_size(frame)[0] == page.viewport_size["width"]  # the extension's frame, at CSS size
        assert window_capture.SETTINGS in line and line.startswith("Live tile off: turn on ")


class Retina:
    """The ScreenCaptureKit helper, faked: a frame at twice the viewport's CSS size, as a 2x
    screen films it (2560 x 1626 for 1280 x 813), whatever it is aimed at."""

    frame = b""

    def __init__(self, pid, on_frame, **_):
        self.status, self.alive, self._on_frame = {}, True, on_frame
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while self.alive:
            self._on_frame(Retina.frame)
            time.sleep(0.1)

    def aim(self, window, viewport, title=""):
        self.status = {"window": 1, "width": viewport["width"] * 2, "height": viewport["height"] * 2, "scale": 2.0}

    def close(self):
        self.alive = False


@pytest.mark.parametrize("retina", [True, False], ids=["2x-filmed", "extension"])
def test_a_click_in_the_tile_reaches_the_element_under_it_at_any_frame_scale(page, worker, site, window, monkeypatch, retina):
    page.goto(f"{site}/quarters")
    css = page.evaluate("() => [innerWidth, innerHeight]")
    if retina:
        Retina.frame = base64.b64decode(window.evaluate("""async ([w, h]) => {
          const canvas = new OffscreenCanvas(w, h);
          canvas.getContext('2d').fillRect(0, 0, w, h);
          const bytes = new Uint8Array(await (await canvas.convertToBlob({type: 'image/jpeg'})).arrayBuffer());
          return btoa(String.fromCharCode(...bytes));
        }""", [css[0] * 2, css[1] * 2]))
        monkeypatch.setattr(window_capture, "allowed", lambda: True)
        monkeypatch.setattr(window_capture, "WindowStream", Retina)
    with PortFrames(1, lambda k: worker.connection, capture="native" if retina else "extension") as frames, \
            Dashboard(1, frames) as board:
        frame = shown(window, board, frames, page, f"{site}/quarters")
        size = jpeg_size(frames.frame(0))
        clicked = []
        for name, (x, y) in {"br": (0.8, 0.8), "tl": (0.2, 0.3), "bl": (0.3, 0.7), "tr": (0.9, 0.1)}.items():
            window.mouse.click(frame["x"] + frame["width"] * x, frame["y"] + frame["height"] * y)
            clicked.append(until(lambda: page.title(), name, 5))

        assert size == ((css[0] * 2, css[1] * 2) if retina else tuple(css))
        assert frames.native == ({0: True} if retina else {})
        assert clicked == ["br", "tl", "bl", "tr"]


def test_a_click_and_typing_in_a_filmed_tile_land_in_the_page(page, filmed, site, window):
    with Dashboard(1, filmed) as board:
        frame = shown(window, board, filmed, page, f"{site}/fields")
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * 0.7)  # field b
        window.keyboard.type("Typed in the tile")

        assert until(lambda: page.input_value("#b"), "Typed in the tile") == "Typed in the tile"
        assert page.input_value("#a") == ""


def test_a_click_and_typing_from_the_tile_land_in_the_page(page, frames, site, window):
    with Dashboard(1, frames) as board:
        frame = shown(window, board, frames, page, f"{site}/fields")
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * 0.25)  # field a
        window.keyboard.type("Lisul O'Neil-Vitigala, #42 (SBU) & \"Q\"!?")
        window.keyboard.press("Backspace")
        window.keyboard.press("Tab")
        window.keyboard.type("BC")
        window.keyboard.press("ArrowLeft")
        window.keyboard.type("x")
        window.keyboard.press("Shift+Tab")
        window.keyboard.press("Meta+a")
        window.keyboard.press("Meta+c")
        window.keyboard.type("A")
        values = lambda: [page.input_value("#a"), page.input_value("#b")]

        assert until(values, ["A", "BxC"]) == ["A", "BxC"]


def test_a_click_on_the_second_field_from_the_tile_moves_the_focus_there(page, frames, site, window):
    with Dashboard(1, frames) as board:
        frame = shown(window, board, frames, page, f"{site}/fields")
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * 0.25)
        window.keyboard.type("one")
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * 0.7)
        window.keyboard.type("two")
        values = lambda: [page.input_value("#a"), page.input_value("#b")]

        assert until(values, ["one", "two"]) == ["one", "two"]


def test_a_select_pressed_in_the_tile_shows_its_options_there_to_pick_from(page, frames, site, window):
    with Dashboard(1, frames) as board:
        frame = shown(window, board, frames, page, f"{site}/select")
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * 0.2)
        options = window.locator(".menu div")
        options.first.wait_for(timeout=10_000)
        assert options.all_inner_texts() == ["Choose one", "Yes", "No"]
        options.nth(2).dispatch_event("mousedown")
        read = lambda: [page.input_value("#s"), page.title()]

        assert until(read, ["No", "changed"]) == ["No", "changed"]


@pytest.mark.parametrize("path, at, title", [("/file", 0.2, "Lisul Resume.pdf 17"), ("/dropzone", 0.2, "Lisul Resume.pdf")])
def test_a_file_the_page_asks_for_from_the_tile_is_picked_in_the_window(page, frames, site, window, tmp_path, path, at, title):
    # An untrusted click opens no picker: the tile asks for the file instead, for an input or a script's input.click().
    resume = tmp_path / "Lisul Resume.pdf"
    resume.write_bytes(b"%PDF-1.4 a resume")
    with Dashboard(1, frames) as board:
        frame = shown(window, board, frames, page, f"{site}{path}")
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * at)
        window.locator("#file-0").wait_for(timeout=10_000)
        window.set_input_files("#file-0 input", resume)

        assert until(page.title, title) == title
        window.wait_for_selector("#file-0", state="hidden", timeout=5_000)
    assert frames.chooser(0) is None


def test_the_wheel_in_the_tile_scrolls_the_box_under_it_then_the_page(page, frames, site):
    page.goto(f"{site}/tall")
    frames.wait(0, frames.wait(0, 0, 0)[1], 10)
    frames.input(0, {"type": "wheel", "x": 50, "y": 50, "dx": 0, "dy": 300})
    page.mouse.move(50, 600)
    page.mouse.wheel(0, 500)

    assert page.evaluate("() => [box.scrollTop, scrollY]") == [300, 500]


def test_typing_from_the_tile_reaches_a_field_in_a_cross_origin_iframe(page, frames, site):
    other = serve()  # another origin: localhost on another port
    try:
        page.goto(f"{site}/framed")
        page.evaluate(f"() => new Promise(done => {{ i.onload = done; i.src = 'http://localhost:{other.server_address[1]}/inner' }})")
        page.mouse.click(60, 150)  # in the iframe's field
        frames.input(0, {"type": "text", "text": "Q"})
        frames.input(0, {"type": "text", "text": "uinn"})
        inner = next(f for f in page.frames if "/inner" in f.url)

        assert until(lambda: inner.input_value("#x"), "Quinn") == "Quinn"
    finally:
        other.shutdown()


def test_a_copy_from_the_tile_reads_what_is_selected(page, frames, site):
    page.goto(f"{site}/fields")
    page.fill("#a", "Lisul Vitigala")
    page.mouse.click(100, 100)
    frames.input(0, {"type": "key", "key": "a", "modifiers": ["Meta"]})

    assert frames.input(0, {"type": "copy"}) == {"text": "Lisul Vitigala"}


def test_expect_file_chooser_gives_the_file_a_click_asked_for(page, site, tmp_path):
    resume = tmp_path / "one-pager.pdf"
    resume.write_bytes(b"%PDF-1.4")
    page.goto(f"{site}/file")
    with page.expect_file_chooser(timeout=5_000) as chosen:
        page.click("#f")
    assert not chosen.value.is_multiple()
    chosen.value.set_files(resume)
    assert until(page.title, "one-pager.pdf 8") == "one-pager.pdf 8"

    page.goto(f"{site}/dropzone")
    with page.expect_file_chooser(timeout=5_000) as chosen:
        page.get_by_role("button", name="Upload").click()
    assert chosen.value.is_multiple()
    chosen.value.set_files([resume, {"name": "letter.pdf", "mimeType": "application/pdf", "buffer": b"%PDF"}])
    assert until(page.title, "one-pager.pdf,letter.pdf") == "one-pager.pdf,letter.pdf"

    page.goto(f"{site}/fields")
    with pytest.raises(PortTimeoutError, match="filechooser"):
        with page.expect_file_chooser(timeout=1_000):
            page.click("#a")


def test_screenshots_still_work_while_the_tile_streams(page, frames, site):
    page.goto(f"{site}/colour")
    frames.wait(0, 0, 10)
    shots = [page.screenshot(type="jpeg") for _ in range(3)]

    assert all(s.startswith(b"\xff\xd8") for s in shots)


def test_the_tile_demo_streams_the_saved_form_it_fills(workers):
    seen = []

    def show(url):
        def look():
            deadline = time.monotonic() + 60
            while not seen and time.monotonic() < deadline:
                try:
                    frame = urllib.request.urlopen(f"{url}/frame/0", timeout=5).read()
                    if frame.startswith(b"\xff\xd8"):
                        seen.append(frame)
                except OSError:
                    pass
                time.sleep(0.3)
        threading.Thread(target=look, daemon=True).start()

    lines = demo.tile("lever-immuta", seconds=2, show=show, workers=workers)

    assert "Nothing was sent" in lines[0] and seen
