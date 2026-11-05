"""Plain Workers (KAN-606): Apply's Workers as plain Chromes driven through a private extension.

A plain Worker is a Chrome process Apply starts itself, with its own profile and no CDP, no
automation flags and no headless mode. The worker extension (apply-agent/worker-extension/)
runs Apply's ops through ordinary extension APIs; a native messaging host relays between it
and this process over a Unix socket in the data folder. Nothing hides automation: there is
none to hide. The protocol is apply-agent/docs/plain-workers/PROTOCOL.md.

- extension: the worker extension's ID and its generated vendor files (`prepare`).
- host: the relay Chrome starts (stdlib only).
- bridge: the socket server, the hello, and one Connection per Worker.
- launcher: PlainWorkers, which copies a seed profile, starts Chrome, and stops it by PID.
"""
