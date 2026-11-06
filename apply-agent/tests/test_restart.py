"""Restart recovery (docs/restart-recovery.md): what survives a quit or a restart of the Mac. No browser."""

from apply.plain.launcher import PlainWorkers


def test_a_plain_worker_keeps_its_session_cookies_across_a_quit(tmp_path):
    # KAN-718: without it, a clean quit drops every job site's sign-in (a session cookie).
    command = PlainWorkers(tmp_path, kind="chrome").arguments(0)
    assert "--restore-last-session" in command
    assert "--no-startup-window" in command  # so no tab of the last session loads again, unguarded
