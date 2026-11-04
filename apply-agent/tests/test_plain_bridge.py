"""The plain Workers' bridge and host relay, with a fake extension in place of Chrome: no browser."""

import json
import os
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import pytest

from apply.plain import host
from apply.plain.bridge import (
    CHUNK_OVER,
    Bridge,
    PortError,
    PortTimeoutError,
    Refused,
    WorkerGone,
    socket_path,
)
from apply.plain.extension import EXTENSION_ORIGIN

ENGINE = {"version": "0.3.13+test", "sha256": "abc"}


def frame(message: dict) -> bytes:
    body = json.dumps(message).encode()
    return struct.pack("=I", len(body)) + body


def read(stream) -> dict | None:
    head = host.read_exact(stream, 4)
    if not head:
        return None
    return json.loads(host.read_exact(stream, struct.unpack("=I", head)[0]))


@pytest.fixture
def bridge():
    folder = Path(tempfile.mkdtemp(prefix="apw-", dir="/tmp"))
    bridge = Bridge(folder / "workers.sock", engine=ENGINE)
    bridge.start()
    yield bridge
    bridge.stop()


def fake_worker(bridge, worker=0, origin=EXTENSION_ORIGIN, engine=ENGINE, protocol=1) -> socket.socket:
    """A relay plus extension: says relay and hello, as the host and the worker extension do."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(str(bridge.path))
    sock.sendall(frame({"type": "relay", "protocol": 1, "worker": worker, "origin": origin, "host_pid": 1}))
    sock.sendall(frame({"type": "hello", "protocol": protocol, "extension": "0.1.0", "engine": engine,
                        "userScripts": False, "webdriver": False}))
    return sock


def serve(sock, answer):
    """Answer each call with answer(message) until the socket closes; chunks are joined first."""
    def loop():
        parts = []
        while (message := read(sock)) is not None:
            if message["type"] == "chunk":
                parts.append(message["data"])
                if len(parts) < message["of"]:
                    continue
                message, parts = json.loads("".join(parts)), []
            if message["type"] == "call":
                sock.sendall(frame(answer(message)))
    threading.Thread(target=loop, daemon=True).start()


def test_the_socket_is_only_lisuls(bridge):
    assert stat.S_IMODE(os.stat(bridge.path).st_mode) == 0o600


def test_a_long_data_folder_puts_the_socket_under_tmp():
    long = Path("/tmp") / ("x" * 120)
    path = socket_path(long)
    assert len(str(path)) < 104 and path.parent.name == f"apply-{os.getuid()}"
    assert socket_path(Path("/tmp/short")) == Path("/tmp/short/workers.sock")


def test_a_good_hello_is_welcomed_and_calls_answer(bridge):
    sock = fake_worker(bridge, worker=2)
    assert read(sock) == {"type": "welcome", "worker": 2, "protocol": 1}
    serve(sock, lambda m: {"type": "result", "id": m["id"], "value": {"op": m["op"], **m["params"]}})
    connection = bridge.wait_for(2, timeout=5)
    assert connection.hello["engine"] == ENGINE
    assert connection.call("ping", tab=7) == {"op": "ping", "tab": 7}


def test_another_engine_is_refused_with_how_to_fix_it(bridge):
    sock = fake_worker(bridge, engine={"version": "0.3.12+old", "sha256": "zzz"})
    refused = read(sock)
    assert refused["type"] == "refuse"
    assert "0.3.12+old" in refused["reason"] and "0.3.13+test" in refused["reason"]
    assert "apply plain prepare" in refused["reason"]
    with pytest.raises(Refused):
        bridge.wait_for(0, timeout=5)


def test_another_extension_is_refused(bridge):
    sock = fake_worker(bridge, origin="chrome-extension://someoneelse/")
    assert read(sock)["type"] == "refuse"


def test_an_op_error_raises_as_a_playwright_error(bridge):
    sock = fake_worker(bridge)
    read(sock)
    serve(sock, lambda m: {"type": "error", "id": m["id"], "error": {"name": "NoTab", "message": "No tab with id: 9"}}
          if m["op"] != "slow" else {"type": "error", "id": m["id"], "error": {"name": "TimeoutError", "message": "late"}})
    connection = bridge.wait_for(0, timeout=5)
    with pytest.raises(PortError) as raised:
        connection.call("tabs.get", tab=9)
    assert raised.value.kind == "NoTab"
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    with pytest.raises(PlaywrightTimeoutError):
        connection.call("slow")
    assert issubclass(PortTimeoutError, PortError)


def test_a_big_message_goes_as_chunks_under_chromes_limit(bridge):
    sock = fake_worker(bridge)
    read(sock)
    sizes = []

    def loop():
        parts = []
        while (head := host.read_exact(sock, 4)):
            sizes.append(struct.unpack("=I", head)[0])
            message = json.loads(host.read_exact(sock, sizes[-1]))
            parts.append(message["data"])
            if len(parts) == message["of"]:
                call = json.loads("".join(parts))
                sock.sendall(frame({"type": "result", "id": call["id"], "value": len(call["params"]["data"])}))
    threading.Thread(target=loop, daemon=True).start()
    data = "x" * (3 * CHUNK_OVER)
    assert bridge.wait_for(0, timeout=5).call("files", data=data) == len(data)
    assert len(sizes) > 1 and max(sizes) < 1024 * 1024


def test_a_closed_worker_is_gone(bridge):
    sock = fake_worker(bridge)
    read(sock)
    connection = bridge.wait_for(0, timeout=5)
    sock.close()
    connection.closed.wait(5)
    with pytest.raises(WorkerGone):
        connection.call("ping")


def test_the_host_relays_both_ways_and_names_its_worker(bridge):
    """The real host script, run as Chrome runs it, between a fake extension's pipes and the bridge."""
    relay = subprocess.Popen([sys.executable, "-I", host.__file__, "--socket", str(bridge.path), "--worker", "1",
                              EXTENSION_ORIGIN], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    relay.stdin.write(frame({"type": "hello", "protocol": 1, "engine": ENGINE}))
    relay.stdin.flush()
    assert read(relay.stdout) == {"type": "welcome", "worker": 1, "protocol": 1}
    connection = bridge.wait_for(1, timeout=5)
    assert connection.relay["origin"] == EXTENSION_ORIGIN and connection.relay["worker"] == 1

    def extension():
        while (message := read(relay.stdout)) is not None:
            relay.stdin.write(frame({"type": "result", "id": message["id"], "value": message["op"].upper()}))
            relay.stdin.flush()
    threading.Thread(target=extension, daemon=True).start()
    assert connection.call("ping") == "PING"
    relay.stdin.close()
    relay.wait(5)
    connection.closed.wait(5)
    assert connection.closed.is_set()


def test_a_second_apply_on_the_same_socket_is_told_so(bridge):
    from apply.plain.bridge import BridgeBusy
    with pytest.raises(BridgeBusy):
        Bridge(bridge.path, engine=ENGINE).start()
