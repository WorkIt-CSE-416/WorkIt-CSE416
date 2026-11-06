"""`apply rehearse --into`: a link sent into a running Apply window (KAN-645). No browser."""

import json
import os
import urllib.error
import urllib.request

import pytest

from apply import ask, into
from apply.dashboard import Dashboard, NoFrames


class Frames(NoFrames):
    def frame(self, worker: int, tab: int | None = None) -> bytes | None:
        return f"worker {worker}".encode()


@pytest.fixture
def window(tmp_path):
    taken = []
    with Dashboard(2, Frames()) as board:
        def take(url: str, worker: int) -> dict:
            tile = board.add_tile(worker)
            taken.append((url, worker, tile))
            return {"tile": tile, "worker": worker}
        board.taking(take)
        path = ask.register(tmp_path, board.url, board.token, os.getpid())
        yield board, taken, tmp_path, path


def test_the_window_lists_itself_for_lisul_only(window):
    board, _, folder, path = window
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    assert into.windows(folder) == [{"url": board.url, "token": board.token, "pid": os.getpid()}]


def test_a_link_sent_by_port_gets_a_tile_of_its_own_on_that_worker(window):
    board, taken, folder, _ = window
    port = board.url.rsplit(":", 1)[1]
    _, answer = into.send(f"{port}:2", "https://jobs.example/two", folder)
    assert answer == {"tile": 2, "worker": 1} and taken == [("https://jobs.example/two", 1, 2)]
    assert len(board.state()["tiles"]) == 3
    assert board._frames.frame(2) is None  # its form's tab not known yet: it might show another form's (KAN-717)
    board.showing(2, 7)
    assert board._frames.frame(2) == b"worker 1"  # its tile shows that Worker's window
    assert "Browser 2" in board.page().split('data-k="2"')[1].split("</div>")[1]


def test_a_link_sent_by_application_goes_to_the_worker_that_fills_it(window):
    board, taken, folder, _ = window
    board.update(1, application_id="app-1", status="filling")
    into.send("app-1", "https://jobs.example/next", folder)
    assert taken[-1][:2] == ("https://jobs.example/next", 1)


def test_no_such_window_or_worker_is_said(window):
    board, _, folder, _ = window
    with pytest.raises(into.NoWindow, match="no running Apply window on port 1"):
        into.send("1", "https://jobs.example/x", folder)
    with pytest.raises(into.NoWindow, match="no Worker 5"):
        into.send(board.url.rsplit(":", 1)[1] + ":5", "https://jobs.example/x", folder)
    with pytest.raises(into.NoWindow, match="no running Apply window has a tile"):
        into.send("app-nope", "https://jobs.example/x", folder)


def test_only_apply_may_send_a_link(window):
    board, taken, _, _ = window
    request = urllib.request.Request(board.url + "/rehearse", data=json.dumps({"url": "https://x"}).encode(),
                                     method="POST", headers={"X-Apply-Token": "wrong"})
    with pytest.raises(urllib.error.HTTPError) as refused:
        urllib.request.urlopen(request, timeout=5)
    assert refused.value.code == 403 and not taken


def post_fill_again(board, body: dict, token: str | None = None) -> tuple[int, dict]:
    request = urllib.request.Request(board.url + "/fill-again", data=json.dumps(body).encode(), method="POST",
                                     headers={"X-Apply-Token": board.token if token is None else token})
    try:
        with urllib.request.urlopen(request, timeout=5) as answer:
            return answer.status, json.loads(answer.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_fill_again_on_a_held_tile_is_given_to_its_worker_once(window):
    board, _, _, _ = window
    board.update(1, application_id="app-1", status="held", askable=True)
    assert post_fill_again(board, {"id": "tile-1"})[0] == 200
    assert not board.fill_again_asked(0)
    assert board.fill_again_asked(1) and not board.fill_again_asked(1)


@pytest.mark.parametrize("body, status", [({"id": "tile-0"}, 409), ({"id": "tile-9"}, 404), ({"id": "app-1"}, 404),
                                          ({"nope": 1}, 400)])
def test_fill_again_with_no_form_held_there_says_why_and_asks_nothing(window, body, status):
    board, _, _, _ = window
    board.update(0, application_id="app-1", status="filling")  # still filling: not held for him
    assert post_fill_again(board, body)[0] == status
    assert not board.fill_again_asked(0)


def test_only_apply_may_fill_a_form_again(window):
    board, _, _, _ = window
    board.update(0, status="held", askable=True)
    assert post_fill_again(board, {"id": "tile-0"}, token="wrong")[0] == 403
    assert not board.fill_again_asked(0)


def test_fill_again_finds_the_form_by_port_or_application_id(window):
    board, _, folder, _ = window
    port = board.url.rsplit(":", 1)[1]
    board.update(1, application_id="app-1", status="held", askable=True)
    assert into.fill_again(port, folder)[1] == 1 and board.fill_again_asked(1)
    assert into.fill_again("app-1", folder)[1] == 1 and board.fill_again_asked(1)


def test_fill_again_by_port_refuses_to_guess_between_held_forms(window):
    board, _, folder, _ = window
    board.update(0, application_id="app-0", status="held", askable=True)
    board.update(1, application_id="app-1", status="held", askable=True)
    with pytest.raises(into.NoWindow, match="app-0, app-1"):
        into.fill_again(board.url.rsplit(":", 1)[1], folder)
    assert into.fill_again("app-1", folder)[1] == 1 and not board.fill_again_asked(0)


def test_fill_again_with_nothing_held_says_so(window):
    board, _, folder, _ = window
    board.update(0, application_id="app-0", status="filling")
    with pytest.raises(into.NoWindow, match="no form is held"):
        into.fill_again("app-0", folder)
    with pytest.raises(into.NoWindow, match="no running Apply window"):
        into.fill_again("1", folder)


def test_a_window_that_takes_no_links_says_so(tmp_path):
    with Dashboard(1, NoFrames()) as board:
        ask.register(tmp_path, board.url, board.token, os.getpid())
        with pytest.raises(into.NoWindow, match="takes no new links"):
            into.send(board.url.rsplit(":", 1)[1], "https://jobs.example/x", tmp_path)


def test_a_window_whose_process_is_gone_is_forgotten(tmp_path):
    (tmp_path / "1.json").write_text(json.dumps({"url": "http://127.0.0.1:1", "token": "t", "pid": 2 ** 22 + 7}))
    assert into.windows(tmp_path) == [] and not (tmp_path / "1.json").exists()


class _Connection:
    """A plain Worker's port, played: tabs, and each guard.reset with the forms' tabs open then."""

    def __init__(self, site):
        import threading

        self.closed, self.site, self.tabs, self.resets, self.worker = threading.Event(), site, [1], [], 0

    def on(self, event: str, handler) -> None:
        pass

    def call(self, name: str, **given):
        if name == "tabs.query":
            return [{"tab": t, "url": "about:blank"} for t in self.tabs]
        if name == "tabs.create":
            self.tabs.append(max(self.tabs, default=0) + 1)
            return {"tab": self.tabs[-1]}
        if name == "tabs.get":
            return {"url": "about:blank", "title": ""}
        if name == "tabs.close":
            self.tabs = [t for t in self.tabs if t != given["tab"]]
        if name == "guard.reset":
            self.resets.append(set(self.site._open.get(0, ())))
        return None


class _Workers:
    """One running plain Worker whose refresh takes a while (it writes a vendor set)."""

    def __init__(self):
        from types import SimpleNamespace

        self.profiles, self.running, self.bridge = None, {}, SimpleNamespace(connection=lambda k: None)
        self.SimpleNamespace = SimpleNamespace

    def refresh(self, worker: int, others: bool = False) -> list[str]:
        import time

        time.sleep(0.3)
        return []


def test_two_links_sent_into_one_worker_at_once_never_reset_the_others_guards():
    # `apply rehearse --into 54321 <a> <b>` sends both at once: two opens on the idle Worker 0. Only the first may
    # reset its guards; the second must see the first's tab and leave its guards (KAN-645).
    import threading

    from apply.plain.site import PlainSite

    workers = _Workers()
    site = PlainSite(workers, fetcher=object())
    connection = _Connection(site)
    workers.running[0] = workers.SimpleNamespace(connection=connection)
    opened, done = threading.Barrier(3, timeout=10), threading.Event()

    def one():
        with site.open("https://jobs.example.com/a", worker=0):
            opened.wait()
            done.wait(5)
    threads = [threading.Thread(target=one, daemon=True) for _ in range(2)]
    for thread in threads:
        thread.start()
    opened.wait()  # both forms are open now
    done.set()
    for thread in threads:
        thread.join(10)

    assert connection.resets == [set()]  # one reset, with no other form open


def test_a_forms_tab_is_told_to_its_tile_before_its_page_loads():
    # `--into`: the new tile must know its own tab while its form still loads, else it would show and press
    # whichever tab the Worker shows then, maybe another form's held Submit (KAN-717).
    from apply.plain.site import PlainSite, telling

    workers = _Workers()
    site = PlainSite(workers, fetcher=object())
    connection, said = _Connection(site), []
    workers.running[0] = workers.SimpleNamespace(connection=connection)
    call = connection.call
    connection.call = lambda name, **given: said.append(name) or call(name, **given)
    with telling(lambda tab: said.append(("shown", tab))), site.open("https://jobs.example.com/a", worker=0) as page:
        pass

    assert ("shown", page.tab) in said
    told = said.index(("shown", page.tab))
    assert not [name for name in said[:told] if name == "tabs.goto"]
    assert [name for name in said[told:] if name == "tabs.goto"]
