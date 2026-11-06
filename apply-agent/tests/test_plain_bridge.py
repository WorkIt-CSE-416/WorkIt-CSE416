"""The plain Workers' bridge and host relay, with a fake extension in place of Chrome: no browser."""

import json
import os
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import pytest

from apply.plain import extension, host
from apply.plain.bridge import (
    CHUNK_OVER,
    FEATURES,
    OUT_OF_DATE,
    Bridge,
    BridgeBusy,
    PortError,
    PortTimeoutError,
    Refused,
    WorkerGone,
    socket_path,
)
from apply.plain.extension import EXTENSION_DIR, EXTENSION_ORIGIN
from apply.plain.launcher import PlainWorkers

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


def fake_worker(bridge, worker=0, origin=EXTENSION_ORIGIN, engine=ENGINE, protocol=1, features=None) -> socket.socket:
    """A relay plus extension: says relay and hello, as the host and the worker extension do."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(str(bridge.path))
    sock.sendall(frame({"type": "relay", "protocol": 1, "worker": worker, "origin": origin, "host_pid": 1}))
    sock.sendall(frame({"type": "hello", "protocol": protocol, "extension": "0.1.0", "engine": engine,
                        "userScripts": False, "webdriver": False, **({} if features is None else {"features": features})}))
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


def test_each_profiles_folder_has_its_own_socket(tmp_path):
    one = PlainWorkers(tmp_path / "one", kind="testing").bridge
    two = PlainWorkers(tmp_path / "two", kind="testing").bridge
    assert one.path != two.path
    one.start()
    try:
        two.start()  # a second process on other profiles: not BridgeBusy (KAN-634)
        two.stop()
        with pytest.raises(BridgeBusy):
            PlainWorkers(tmp_path / "one", kind="testing").bridge.start()
    finally:
        one.stop()


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


def test_an_extension_with_vendor_sets_gets_apply_s_own_set_whatever_its_folder_holds(bridge):
    # The seed loads another checkout's folder, prepared for another engine (KAN-645): the Worker reads
    # this Apply's own set from it instead, so it is welcomed and told which set.
    bridge.vendor = "vendor/sets/0123456789abcdef"
    sock = fake_worker(bridge, engine={"version": "0.3.12+old", "sha256": "zzz"}, features=3)
    assert read(sock) == {"type": "welcome", "worker": 0, "protocol": 1, "vendor": "vendor/sets/0123456789abcdef"}
    assert bridge.wait_for(0, timeout=5).vendor == "vendor/sets/0123456789abcdef"


def test_a_vendor_set_is_written_once_and_never_changed(tmp_path):
    one = extension.vendor_set(tmp_path, {"engine.js": b"one", "guards/lifted.js": b"x"})
    files = tmp_path / one
    assert (files / "engine.js").read_bytes() == b"one" and (files / "guards/lifted.js").read_bytes() == b"x"
    two = extension.vendor_set(tmp_path, {"engine.js": b"two", "guards/lifted.js": b"x"})  # a newer engine
    assert two != one and (tmp_path / one / "engine.js").read_bytes() == b"one"  # the running Workers' set stays
    assert extension.vendor_set(tmp_path, {"engine.js": b"one", "guards/lifted.js": b"x"}) == one
    assert not [p for p in (tmp_path / "vendor/sets").iterdir() if p.name.startswith(".")]


def test_the_loaded_folder_is_the_one_the_profile_registered(tmp_path):
    folder = tmp_path / "elsewhere" / "worker-extension"
    folder.mkdir(parents=True)
    (folder / "manifest.json").write_text("{}")
    profile = tmp_path / "plain-seed"
    (profile / "Default").mkdir(parents=True)
    assert extension.loaded_folder(profile) is None
    (profile / "Default" / "Secure Preferences").write_text(json.dumps(
        {"extensions": {"settings": {extension.EXTENSION_ID: {"path": str(folder), "location": 4}}}}))
    assert extension.loaded_folder(profile) == folder
    workers = PlainWorkers(tmp_path, kind="chrome")
    assert workers.loaded_folder(0) == folder  # no Worker profile yet: the seed's
    assert PlainWorkers(tmp_path, kind="testing").loaded_folder(0) == tmp_path / extension.COPY


def test_the_code_hash_changes_with_the_code_not_the_vendor_files(tmp_path):
    folder = tmp_path / "worker-extension"
    (folder / "ops").mkdir(parents=True)
    (folder / "manifest.json").write_text("{}")
    (folder / "ops" / "core.js").write_text("one")
    before = extension.code_hash(folder)
    (folder / "vendor").mkdir()
    (folder / "vendor" / "engine.js").write_text("new engine")
    assert extension.code_hash(folder) == before
    (folder / "ops" / "core.js").write_text("two")
    assert extension.code_hash(folder) != before


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


def test_workers_load_their_profiles_folders_own_copy_which_changes_only_while_none_runs(tmp_path):
    source = tmp_path / "checkout" / "worker-extension"
    shutil.copytree(EXTENSION_DIR, source, ignore=shutil.ignore_patterns("vendor"))
    files = {"engine.js": b"engine one", "guards/lifted.js": b"x"}
    copy = tmp_path / "profiles" / extension.COPY
    assert extension.install(copy, files, replace=False, source=source)  # none yet: made
    assert (copy / "background.js").read_text() == (source / "background.js").read_text()
    first_set = next((copy / "vendor/sets").iterdir())
    (source / "ops" / "core.js").write_text((source / "ops" / "core.js").read_text() + "\n// newer\n")  # git pull
    assert not extension.install(copy, files, replace=False, source=source)  # a Worker runs: unchanged
    assert "// newer" not in (copy / "ops" / "core.js").read_text()
    assert extension.install(copy, {**files, "engine.js": b"engine two"}, replace=True, source=source)
    assert "// newer" in (copy / "ops" / "core.js").read_text()
    assert first_set.is_dir() and len(list((copy / "vendor/sets").iterdir())) == 2  # the old set stays
    assert not [p for p in copy.parent.iterdir() if p.name.startswith(".")]
    workers = PlainWorkers(tmp_path / "profiles", kind="testing")
    assert workers.copy == copy and workers.loaded_folder(0) == copy  # what --load-extension names (no Chrome in CI)
    assert PlainWorkers(tmp_path / "p2", kind="chrome").loaded_folder(0) == tmp_path / "p2" / extension.COPY


def test_guards_match_reads_the_plain_guard_files(tmp_path):
    from apply.plain import guards
    assert not extension.guards_match(tmp_path)
    for name, text in guards.FILES.items():
        (tmp_path / "vendor/guards" / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "vendor/guards" / name).write_text(text)
    assert extension.guards_match(tmp_path)
    (tmp_path / "vendor/guards/lifted.js").write_text("another Apply's")
    assert not extension.guards_match(tmp_path)


def test_an_extension_older_than_apply_is_welcomed_as_stale_with_one_line(bridge, capsys):
    sock = fake_worker(bridge, worker=0)  # from before KAN-643: no `features`, no extension.reload
    assert read(sock)["type"] == "welcome"  # never refused: the run goes on
    connection = bridge.wait_for(0, timeout=5)
    other = fake_worker(bridge, worker=1)
    assert read(other)["type"] == "welcome"

    assert connection.stale and bridge.wait_for(1, timeout=5).stale
    assert capsys.readouterr().err.count(OUT_OF_DATE) == 1


def test_an_extension_that_can_reload_is_reloaded_once_before_its_welcome(bridge):
    bridge.expects = FEATURES + 1
    bridge.reloadable = lambda worker: True  # Developer mode on in its profile
    old = fake_worker(bridge, worker=0, features=FEATURES)
    assert read(old)["type"] == "welcome"
    assert read(old) == {"type": "call", "id": 1, "op": "extension.reload", "params": {}}
    with pytest.raises(TimeoutError):
        bridge.wait_for(0, timeout=0.5)  # the reloading one is never registered
    old.close()  # chrome.runtime.reload() closed its port; the new code says hello again
    fresh = fake_worker(bridge, worker=0, features=FEATURES + 1)
    assert read(fresh)["type"] == "welcome"
    assert not bridge.wait_for(0, timeout=5).stale

    fresh.close()  # still old after its reload (old files on disk): welcomed as stale, not reloaded again
    again = fake_worker(bridge, worker=0, features=FEATURES)
    assert read(again)["type"] == "welcome"
    assert until_stale(bridge, 0)


def test_an_old_extension_on_another_engine_is_reloaded_not_refused(bridge):
    # wt/sync's running code is from before vendor sets, and its folder holds another engine: once its
    # code on disk takes sets, a reload welcomes it with this Apply's own set (KAN-645).
    bridge.vendor = "vendor/sets/0123456789abcdef"
    bridge.reloadable = lambda worker: True
    old = fake_worker(bridge, worker=0, engine={"version": "0.3.12+old", "sha256": "zzz"}, features=2)
    assert read(old)["type"] == "welcome"
    assert read(old)["op"] == "extension.reload"
    old.close()
    fresh = fake_worker(bridge, worker=0, engine={"version": "0.3.12+old", "sha256": "zzz"}, features=3)
    assert read(fresh)["vendor"] == "vendor/sets/0123456789abcdef"


def test_an_old_extension_that_cant_reload_is_refused_with_where_to_update(bridge):
    bridge.folder = Path("/somewhere/wt/sync/apply-agent/worker-extension")
    sock = fake_worker(bridge, engine={"version": "0.3.12+old", "sha256": "zzz"}, features=2)
    refused = read(sock)
    assert refused["type"] == "refuse" and "/somewhere/wt/sync" in refused["reason"] and "git pull" in refused["reason"]


def test_an_extension_is_never_reloaded_without_developer_mode(bridge):
    bridge.expects = FEATURES + 1  # bridge.reloadable says no: Chrome would disable the reloaded extension
    sock = fake_worker(bridge, worker=0, features=FEATURES)
    assert read(sock)["type"] == "welcome"
    connection = bridge.wait_for(0, timeout=5)

    assert connection.stale
    with pytest.raises(PortError):
        bridge.reload(0)


def until_stale(bridge, worker, seconds=5.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        connection = bridge.connection(worker)
        if connection is not None and connection.stale:
            return True
        time.sleep(0.05)
    return False
