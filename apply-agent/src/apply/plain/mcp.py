"""The MCP server `claude -p` starts for a drive on a plain Worker (KAN-612): stdio in, Apply out.

`claude -p` starts it as its `playwright` server (`python -m apply.plain.mcp --socket <path>`),
so Claude fill and Rescue see the same tool names and inputs as Playwright MCP's
(mcp_tools.json, taken from @playwright/mcp@0.0.83's own tools/list), and the submit-click hook
(apply.send_click, on mcp__playwright__browser_click) runs as before. It holds no browser: each
tools/call goes as one JSON line over the drive's Unix socket to Apply's ToolServer
(apply.plain.tools), which runs it on the Worker's page through its port, and the answer comes
back the same way. Stdlib only: it starts fast and imports nothing of Apply's.
"""

import argparse
import json
import socket
import sys
from pathlib import Path

TOOLS = json.loads((Path(__file__).with_name("mcp_tools.json")).read_text())["tools"]
PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")
SERVER = {"name": "Playwright", "version": "apply-plain-1"}


def answer(message: dict, ask) -> dict | None:
    """The reply to one JSON-RPC message (None for a notification). `ask(name, arguments)` runs a tool."""
    method, ident = message.get("method"), message.get("id")
    if ident is None:
        return None
    if method == "initialize":
        asked = (message.get("params") or {}).get("protocolVersion")
        result = {"protocolVersion": asked if asked in PROTOCOLS else PROTOCOLS[0],
                  "capabilities": {"tools": {}}, "serverInfo": SERVER}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        params = message.get("params") or {}
        result = ask(params.get("name"), params.get("arguments") or {})
    else:
        return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": f"no method {method}"}}
    return {"jsonrpc": "2.0", "id": ident, "result": result}


class Apply:
    """The line-per-message connection to the drive's ToolServer."""

    def __init__(self, path: str):
        self._socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._socket.connect(path)
        self._lines = self._socket.makefile("r", encoding="utf-8")

    def __call__(self, name: str, arguments: dict) -> dict:
        self._socket.sendall((json.dumps({"name": name, "arguments": arguments}) + "\n").encode())
        line = self._lines.readline()
        if not line:
            return {"content": [{"type": "text", "text": "### Error\nApply stopped this drive."}], "isError": True}
        return json.loads(line)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m apply.plain.mcp")
    parser.add_argument("--socket", required=True)
    args = parser.parse_args(argv)
    ask = Apply(args.socket)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if reply := answer(message, ask):
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
