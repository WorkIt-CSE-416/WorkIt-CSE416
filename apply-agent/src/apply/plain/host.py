"""The plain Workers' native messaging host: relays one worker extension's port to Apply.

Chrome starts it when the worker extension calls connectNative("com.workit.apply_worker"),
through the wrapper in that Worker profile's NativeMessagingHosts folder, which adds
`--socket <path> --worker <k>`; Chrome adds the caller's origin. It connects to Apply's
socket, says which Worker it is, then relays frames both ways unchanged: Chrome's framing
(a 4-byte length in native byte order, then UTF-8 JSON) is also the socket's.

Stdlib only, run with `python3 -I`, so it needs nothing from Apply's environment.
"""

import json
import os
import socket
import struct
import sys
import threading

PROTOCOL = 1
TO_CHROME = 1024 * 1024  # Chrome's limit on a message from a host


def read_exact(stream, size: int) -> bytes:
    data = b""
    while len(data) < size:
        more = stream.read(size - len(data)) if hasattr(stream, "read") else stream.recv(size - len(data))
        if not more:
            return b""
        data += more
    return data


def frames(stream):
    """Each frame (its 4-byte head and body) read from `stream`, until it ends."""
    while (head := read_exact(stream, 4)):
        body = read_exact(stream, struct.unpack("=I", head)[0])
        if len(body) != struct.unpack("=I", head)[0]:
            return
        yield head + body


def main(argv: list[str]) -> None:
    path = argv[argv.index("--socket") + 1]
    worker = int(argv[argv.index("--worker") + 1])
    origin = next((a for a in argv if a.startswith("chrome-extension://")), "")
    apply = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    apply.connect(path)
    first = json.dumps({"type": "relay", "protocol": PROTOCOL, "worker": worker, "origin": origin,
                        "host_pid": os.getpid()}).encode()
    apply.sendall(struct.pack("=I", len(first)) + first)

    def up() -> None:  # Chrome -> Apply
        for frame in frames(sys.stdin.buffer):
            apply.sendall(frame)
        os._exit(0)

    threading.Thread(target=up, daemon=True).start()
    out = sys.stdout.buffer
    for frame in frames(apply):  # Apply -> Chrome
        if len(frame) - 4 > TO_CHROME:  # Chrome would close the port: Apply must chunk
            continue
        out.write(frame)
        out.flush()
    os._exit(0)


if __name__ == "__main__":
    main(sys.argv[1:])
