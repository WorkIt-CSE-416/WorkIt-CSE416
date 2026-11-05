"""`apply rehearse --into`: a link sent into a running Apply window (KAN-645). No browser."""

import json
import os
import urllib.error
import urllib.request

import pytest

from apply import ask, into
from apply.dashboard import Dashboard, NoFrames


class Frames(NoFrames):
    def frame(self, worker: int) -> bytes | None:
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


def test_a_window_that_takes_no_links_says_so(tmp_path):
    with Dashboard(1, NoFrames()) as board:
        ask.register(tmp_path, board.url, board.token, os.getpid())
        with pytest.raises(into.NoWindow, match="takes no new links"):
            into.send(board.url.rsplit(":", 1)[1], "https://jobs.example/x", tmp_path)


def test_a_window_whose_process_is_gone_is_forgotten(tmp_path):
    (tmp_path / "1.json").write_text(json.dumps({"url": "http://127.0.0.1:1", "token": "t", "pid": 2 ** 22 + 7}))
    assert into.windows(tmp_path) == [] and not (tmp_path / "1.json").exists()
