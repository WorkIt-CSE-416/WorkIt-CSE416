"""The `apply` command."""

import argparse
import imaplib
import os
import queue
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

import yaml

from apply import (
    already_applied,
    ask,
    batch,
    bot_signals,
    captcha,
    dashboard,
    data_command,
    doctor,
    employer_mail,
    essays,
    home,
    into,
    masked,
    native_host,
    on_page,
    orchestrator,
    own_application,
    preflight,
    rehearsal,
    resume_check,
    schedule,
    sheet,
    sheet_import,
    story_map,
    tailored,
    trace,
    tracker_cleanup,
    walls,
    workit,
)
from apply.accounts_tab import AccountsTab
from apply.adapters import Adapters
from apply.answer_bank import AnswerBank
from apply.answers_tab import AnswersTab
from apply.browsers import ProfileInUse, WorkerBrowsers
from apply.claude_cli import ClaudeCLI
from apply.clock import SystemClock
from apply.feed import live_feed
from apply.gmail import live_mailbox
from apply.home import HOME
from apply.keychain import GMAIL, MacKeychain
from apply.match_queue import match_queue
from apply.notify import SET_UP, TEST_PUSH, MacNotifier, RecordingNotifier, live_phone
from apply.plain.site import live_site
from apply.profile import OVERRIDE, ApplicantProfile, load_policies
from apply.records import FolderRecords, GitRecords
from apply.repair import FOLDER as REPAIRS
from apply.repair import RepairRequests
from apply.repairer import Repairer, repair_later
from apply.sheet import (
    APPLICATIONS,
    NoSheet,
    live_tracker_sheet,
)
from apply.tracker import TRACKER, FileTracker, InMemoryTracker, WorkItTracker
from apply.worker import SENT, sent_resume

DEFAULT_PROFILE = HOME / "applicant-profile.yaml"
# The Answer bank's file, beside the Applicant profile.
ANSWER_BANK = "answer-bank.yaml"
# Where a rehearsal keeps its Records, one folder per day.
REHEARSALS = HOME / "rehearsals"
# Where a run keeps its Records while policies.yaml sets no records_remote.
RECORDS = HOME / "records"


def main(argv: list[str] | None = None, adapters: Adapters | None = None) -> None:
    """From the shell, every line goes out scrubbed of personal values (apply.masked, KAN-664). A test's fake
    adapters print only what it made."""
    if adapters is not None:
        return _main(argv, adapters)
    with masked.output():
        return _main(argv, adapters)


def _main(argv: list[str] | None, adapters: Adapters | None) -> None:
    parser = argparse.ArgumentParser(prog="apply")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="submit approved Holds, then apply to every Request and Match")
    approve_pass = commands.add_parser("approve-pass", help="submit only the Holds approved in the Tracker")
    rehearse = commands.add_parser(
        "rehearse", help="fill each link's form as a run would, to its last page, and never submit; the browsers stay open",
    )
    rehearse.add_argument("urls", nargs="+", metavar="url")
    rehearse.add_argument("--start-button", dest="together", action="store_true",
                          help="hold every form, open and planned, until all are and you press Start in the window, "
                               "then fill them all at once (for filming)")
    rehearse.add_argument("--into", metavar="WINDOW",
                          help="send the links into a running Apply window instead: its port (54321, or 54321:2 for "
                               "Browser 2) or an Application ID on one of its tiles. Each fills in that Worker's "
                               "running Chrome, in a tab of its own, so the job site's sign-in holds")
    rehearse.add_argument("--force", action="store_true",
                          help="rehearse a link you already applied to anyway; its page keeps Submit blocked "
                               "under a red note until you dismiss it")
    reopen = commands.add_parser(
        "reopen", help="after a restart: reopen every form on the open-forms list in the Worker that held it, keeping "
                       "what it held; at a sign-in it waits for you and goes on once you are in. It never submits")
    reopen.add_argument("--list", action="store_true", help="print what it would reopen, and open nothing")
    for command in (run, approve_pass, rehearse, reopen):
        command.add_argument("--profile", type=Path, default=DEFAULT_PROFILE, help="the Applicant profile (YAML)")
        command.add_argument("--workers", type=int, default=orchestrator.WORKERS, help="how many Workers fill at once")
    run.add_argument("--requests-only", action="store_true",
                     help="apply only to approved Holds and waiting Requests: the 5-minute check between runs")
    commands.add_parser("matches", help="dry run: count today's Matches in the live Feed; applies to nothing")
    commands.add_parser("signals", help="count the Bot signals on the Tracker's rows per mode (headless or headed, "
                                        "policies.yaml: worker_headless) and job system, to compare the two")
    watch = commands.add_parser("watch", help="reopen the window of the run or rehearsal going; "
                                              "with none going, open it on the Answers tab")
    answers = commands.add_parser("answers", help="open the Apply window on the Answers tab: every answer Apply "
                                                  "gives, to read and edit")
    for command in (watch, answers):
        command.add_argument("--profile", type=Path, default=DEFAULT_PROFILE,
                             help="the Applicant profile (YAML); its Answer bank is beside it")
    traced = commands.add_parser("trace", help="print what happened in an Application, step by step: the newest "
                                               "Trace, or the newest whose Posting matches QUERY")
    traced.add_argument("query", nargs="?", default="", help="part of a Posting link, a company or an Application id")
    traced.add_argument("--path", action="store_true", help="print only the Trace file's path")
    check = commands.add_parser("doctor", help="check the setup a run needs, read-only: one line per check, "
                                               "with how to fix it; exits non-zero if any check fails")
    check.add_argument("--profile", type=Path, default=DEFAULT_PROFILE, help="the Applicant profile (YAML)")
    check.add_argument("--usage", action="store_true",
                       help="also read Claude's usage of the Max plan (one tiny Haiku call)")
    add = commands.add_parser("add", help="add Posting links as Requests, applied to ahead of every Match")
    add.add_argument("urls", nargs="+", metavar="url")
    applied = commands.add_parser("applied", help="add Applications you submitted yourself to the Tracker as "
                                                  "submitted: paste the Posting or its thank-you page")
    applied.add_argument("urls", nargs="+", metavar="url")
    repair = commands.add_parser(
        "repair", help="Claude fixes Apply's own code for each waiting Repair request, merged only past the gate; "
                       "never submits (runs by itself after each run and rehearsal)",
    )
    repair.add_argument("--branch", help="the integration branch to merge into (default: the branch Apply runs from)")
    repair.add_argument("--no-push", action="store_true", help="merge, but don't push the integration branch")
    sign_in = commands.add_parser(
        "sign-in", help="sign every Worker profile in to a site that needs your account (TikTok, ByteDance, an iCIMS "
                        "site): you sign in yourself in the Chrome window it opens, and Apply never sees your password",
    )
    sign_in.add_argument("url", help="a Posting on that site, as a Handoff's reason gives it")
    commands.add_parser("login", help="log in to WorkIt one time, in a Chrome window that it opens, so Apply can "
                                      "write to your Applications Tracker; Apply keeps the login in the data folder")
    import_sheet = commands.add_parser(
        "import-sheet", help="one time: put each submitted row of the Tracker Sheet into your WorkIt Applications "
                             "Tracker. It lists every add and skip first, and writes only when you type yes")
    import_sheet.add_argument("--dry-run", action="store_true", help="only list what it would do; write nothing")
    clean_tracker = commands.add_parser(
        "clean-tracker", help="delete the saved and queued applications on your WorkIt Applications Tracker of jobs "
                              "you did not apply to. It lists every delete first, and deletes only when you type yes")
    clean_tracker.add_argument("--dry-run", action="store_true", help="only list what it would delete; delete nothing")
    clean_tracker.add_argument("--keep", action="append", default=[], metavar="LINK",
                               help="a job's link (or WorkIt job id) to keep on the tracker; give it again for more")
    commands.add_parser(
        "chrome-passwords", help="let the WorkIt extension in your own Chrome sign you in to each Workday account "
                                 "Apply made, from Keychain, so Chrome offers to save its password: installs the "
                                 "Apply accounts host and lists Keychain's accounts in the Tracker")
    commands.add_parser("push-test", help="send one test push to your phone (ntfy), or say how to set it up")
    scheduled = commands.add_parser(
        "schedule", help="launchd jobs for the Daily sweep (`apply run` at policies.yaml's schedule.daily_sweep_at) "
                         "and the Requests check (`apply run --requests-only` every 5 minutes)",
    ).add_subparsers(dest="action", required=True)
    install = scheduled.add_parser("install", help="write both jobs' plists to ~/Library/LaunchAgents; "
                                                   "load them only with --load")
    install.add_argument("--load", action="store_true", help="also load them into launchd (launchctl bootstrap)")
    scheduled.add_parser("uninstall", help="unload both jobs and remove their plists")
    scheduled.add_parser("status", help="whether each job is installed and loaded, and when it last ran")
    mail = commands.add_parser(
        "mail", help="read recent employer mail and note in the Tracker each confirmation and a Suggested outcome "
                     "(never your Outcome); lists online assessments and mail it can't match. Read-only: it never "
                     "sends, moves, deletes or marks mail read",
    )
    mail.add_argument("--days", type=int, default=employer_mail.DAYS, help="how many days back to read")
    mail.add_argument("--profile", type=Path, default=DEFAULT_PROFILE, help="the Applicant profile (YAML): its email")
    mapped = commands.add_parser(
        "story-map", help="tag each Story bank episode with its question types, problem kinds and follow-ups (one "
                          "Opus call), show what changed against story-map.yaml, and write it once you say yes",
    )
    mapped.add_argument("--yes", action="store_true", help="write the new map without asking")
    mapped.add_argument("--check", action="store_true", help="list stale entries (their bank line changed or is "
                                                            "gone); no model call")
    mapped.add_argument("--gaps", action="store_true", help="print the follow-ups the bank can't answer as "
                                                           "bank/questions.md lines; no model call")
    plain = commands.add_parser(
        "plain", help="plain Workers (KAN-606): Chromes with no CDP, driven through the worker extension",
    ).add_subparsers(dest="action", required=True)
    ping = plain.add_parser("ping", help="start plain Workers, print each one's hello and checks, then quit them")
    ping.add_argument("--workers", type=int, default=1, help="how many plain Workers to start")
    ping.add_argument("--chrome", choices=("testing", "chrome"), default="testing",
                      help="Chrome for Testing with --load-extension (default), or branded Chrome from the seed profile")
    filled = plain.add_parser("fill", help="fill a saved form (the engine's fixtures, served on 127.0.0.1) in a plain "
                                           "Worker as Test Person, and print the read-back; never submits")
    filled.add_argument("form", help="a saved form's name, such as lever-immuta")
    filled.add_argument("--chrome", choices=("testing", "chrome"), default="testing",
                        help="Chrome for Testing (default), or branded Chrome from the seed profile")
    tiled = plain.add_parser("tile", help="fill a saved form in a plain Worker shown live in an Apply window tile, then "
                                          "leave it there to click and type in from the tile; never submits")
    tiled.add_argument("form", help="a saved form's name, such as lever-immuta")
    tiled.add_argument("--seconds", type=float, default=300, help="how long the tile stays up after the fill")
    tiled.add_argument("--chrome", choices=("testing", "chrome"), default="testing",
                       help="Chrome for Testing (default), or branded Chrome from the seed profile")
    plain.add_parser("prepare", help="write the worker extension's engine bundle and Playwright's injected script")
    plain.add_parser("seed", help="guided one-time setup: open branded Chrome on the seed profile, confirm each step, check a real Worker")
    asked = commands.add_parser("ask", help="Ask Claude to fix an open form in a running Apply window, in your own "
                                            "words; prints what Claude changed. It never submits")
    asked.add_argument("target", nargs="?", help="the form: its Application ID, or words of its company and role")
    asked.add_argument("message", nargs="?", help="what is wrong, e.g. \"page 2's GPA is wrong\"")
    asked.add_argument("--list", action="store_true", help="list every open form: its ID, company, role, page and state")
    again = commands.add_parser("fill-again", help="fill a held form anew in its running Apply window, as its page's "
                                                   "Fill again button does; it never submits")
    again.add_argument("target", help="the window's port, when it holds one form, or the form's Application ID")
    checked = commands.add_parser(
        "preflight", help="before a batch: group the links by job system and site, say which sign-ins to do first, "
                          "and print the order and pacing plan. It opens no page and reads no job site")
    checked.add_argument("urls", nargs="*", metavar="url")
    checked.add_argument("--workers", type=int, default=orchestrator.WORKERS, help="how many Workers fill at once")
    checked.add_argument("--open", action="store_true", help="the open forms instead (apply reopen): which of their "
                                                              "sites wait on your sign-in now, and in which Browser")
    data = commands.add_parser("data", help="what the data folder holds, masked: keys and shapes, never a value")
    data_commands = data.add_subparsers(dest="data_command", required=True)
    data_keys = data_commands.add_parser("keys", help="list the data files, or one file's keys, with each one's shape")
    data_keys.add_argument("file", nargs="?", help="a file in the data folder, such as answer-bank.yaml")
    data_key = data_commands.add_parser("show-key", help="one key, masked, by its dotted name")
    data_key.add_argument("key", help="such as identity.email")
    data_key.add_argument("--file", help=f"a file in the data folder (default: {data_command.DEFAULT_FILE})")
    args = parser.parse_args(argv)
    if adapters is None:
        masked.KNOWN.learn(getattr(args, "profile", None) or DEFAULT_PROFILE)
    if adapters is None and threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, _stop)  # `kill <pid>` closes the browsers and the window, as Ctrl-C does
    # doctor only reads: it says the profile is missing. login and import-sheet need no profile.
    if args.command not in ("doctor", "login", "import-sheet", "clean-tracker", "plain", "ask", "fill-again",
                            "preflight", "data") and home.fill_from_sample():
        print(f"No Applicant profile yet: copied the Test Person sample data into {HOME}. Apply runs as Test Person "
              "(the window says Sample data) until you put your own files there.", file=sys.stderr)

    if args.command in ("run", "approve-pass"):
        profile = ApplicantProfile.load(args.profile)
        kinds = {"matches": not args.requests_only} if args.command == "run" else {"matches": False, "requests": False}
        if adapters:
            orchestrator.run(adapters, profile, args.workers, **kinds)
        else:
            _refuse_unless_live_runs_on(profile, args.command)
            _refuse_temp_state(profile, args.command)
            _refuse_busy_worker_profiles(args.command)
            _refuse_stale_resume(profile, args.command)
            _send_waiting_writes()
            adapters = live_adapters(profile, answer_bank=AnswerBank(args.profile.parent / ANSWER_BANK))
            WorkerBrowsers().seed(args.workers)
            try:
                with _dashboard(adapters, args.workers, profile):
                    orchestrator.run(adapters, profile, args.workers, **kinds)
            finally:
                _close_workers(adapters.site)
            repair_later(adapters.repairs, profile.policy("repair") or {})
    elif args.command == "fill-again":
        sys.exit(_fill_again(args.target))
    elif args.command == "preflight" and args.open:
        print(preflight.open_report(batch.forms(), _tiles()))
    elif args.command == "preflight":
        if not args.urls:
            parser.error("preflight: give the links, or --open for the open forms")
        _preflight(args.urls, args.workers, adapters)
    elif args.command == "rehearse" and args.into:
        sys.exit(_send_into(args.into, args.urls))
    elif args.command in ("rehearse", "reopen"):
        reopening = None
        if args.command == "reopen":
            reopening = _reopening(args, adapters)
            if reopening is None:
                return
        profile = ApplicantProfile.load(args.profile)
        live = adapters is None
        if live:
            _refuse_temp_state(profile, args.command)
            _refuse_busy_worker_profiles(args.command)
            _refuse_stale_resume(profile, args.command)
            # No Records repo, no notifications: a rehearsal leaves no trace but its local Records,
            # a Tracker row for each Application Lisul submits himself from a held page, and the
            # Employer accounts it makes (their passwords in Keychain).
            adapters = live_adapters(profile, tracker=InMemoryTracker(), records=FolderRecords(REHEARSALS),
                                     notifier=RecordingNotifier(), phone=RecordingNotifier(),
                                     answer_bank=AnswerBank(args.profile.parent / ANSWER_BANK))
            print(f"Rehearsing {len(args.urls)} links; Apply submits nothing, and each page is yours once it stops. "
                  f"Records go to {REHEARSALS}/; "
                  f"answers Claude drafts go to the Answer bank, {args.profile.parent / ANSWER_BANK}.")
            for seeded in WorkerBrowsers().seed(len(args.urls)):
                print(f"Signed {seeded.name} in to Google as a copy of a signed-in Worker profile.")
            _send_waiting_writes()
            try:  # where an Application Lisul submits from a held page is kept, and sent to WorkIt
                kept = live_tracker()
            except Exception as error:
                kept = None
                print(f"No Tracker ({type(error).__name__}: {error}): add any you submit yourself.")
            try:
                # A tile per link: each keeps its page open. A reopened tile follows its own Worker, whatever its number.
                with _dashboard(adapters, len(args.urls), profile, max([len(args.urls), *(
                        k + 1 for k in (reopening.workers if reopening else []))])):
                    rehearsal.rehearse(args.urls, adapters, profile, args.workers, on_done=lambda: repair_later(adapters.repairs, profile.policy("repair") or {}),
                                       submitted_to=kept, together=args.together, force=args.force,
                                       reopening=reopening)
            finally:
                _close_workers(adapters.site)  # before os._exit below: plain Workers' Chromes outlive this process
        else:
            rehearsal.rehearse(args.urls, adapters, profile, args.workers, submitted_to=adapters.tracker,
                               together=args.together, force=args.force, reopening=reopening)
        if live:
            # A link still filling at Ctrl-C has a browser on a thread that won't stop: end every one now.
            sys.stdout.flush()
            os._exit(0)
    elif args.command in ("watch", "answers"):
        profiles = WorkerBrowsers().profiles
        url = profiles / DASHBOARD_URL
        if url.exists():  # the window of the run going: both tabs
            dashboard.open_window(url.read_text().strip() + ("/#answers" if args.command == "answers" else ""),
                                  profiles / "dashboard")
        else:
            _answers_window(args.profile, profiles / "answers")
    elif args.command == "matches":
        feed, today = (adapters.feed, adapters.clock.now().date()) if adapters else (live_feed(), date.today())
        matches = feed.postings()
        policies = load_policies()
        first_run = match_queue(matches, [], today, policies["company_cap"], policies.get("employer_limits"))
        cap = policies.get("daily_cap")
        capped = cap is not None and len(first_run) > cap
        print(f"{len(matches)} Matches in the Feed today; a first run would apply to "
              + (f"{cap} (policies.yaml: daily_cap)." if capped else f"{len(first_run)}."))
    elif args.command == "trace":
        path = trace.latest(args.query)
        if path is None:
            sys.exit(f"No Trace{' matches ' + repr(args.query) if args.query else ''} in {trace.TRACES}.")
        print(path if args.path else f"{path}\n{trace.timeline(path)}")
    elif args.command == "doctor":
        sys.exit(doctor.run(live_machine(args.profile, usage=args.usage), sys.stdout))
    elif args.command == "login":
        client = workit.WorkIt()
        print(f"Sign in to WorkIt in the Chrome window that opens ({client.site.web}). Apply never sees your password.")
        try:
            account = workit.login(client)
        except workit.WorkItError as error:
            sys.exit(f"apply login: {error}")
        print(f"Logged in to WorkIt as {account.email}. The login is in {client.login}.")
        if account.account_type != "applicant":
            print(f"That is a {account.account_type} account: the Applications Tracker needs a student account.")
    elif args.command == "import-sheet":
        client = workit.WorkIt()
        if not client.logged_in():
            sys.exit("apply import-sheet: no WorkIt login. Run `uv run apply login` first.")
        try:
            cells = live_tracker_sheet().worksheet(APPLICATIONS).get_all_values()
            sys.exit(sheet_import.run(cells, client, SENT, dry_run=args.dry_run))
        except (NoSheet, workit.WorkItError) as error:
            sys.exit(f"apply import-sheet: {error}")
    elif args.command == "clean-tracker":
        client = workit.WorkIt()
        if not client.logged_in():
            sys.exit("apply clean-tracker: no WorkIt login. Run `uv run apply login` first.")
        try:
            cells = live_tracker_sheet().worksheet(APPLICATIONS).get_all_values()
        except NoSheet:
            cells = None
            print("No Tracker Sheet: only WorkIt says which jobs you applied to.")
        try:
            held = FileTracker().rows() if TRACKER.exists() else []  # Apply's Holds and Missing facts stay
            sys.exit(tracker_cleanup.run(client, cells, keep=args.keep, apply_rows=held, dry_run=args.dry_run))
        except workit.WorkItError as error:
            sys.exit(f"apply clean-tracker: {error}")
    elif args.command == "signals":
        print(bot_signals.summary((adapters.tracker if adapters else live_tracker()).rows()))
    elif args.command == "repair":
        if not (load_policies().get("repair") or {}).get("max_per_day"):
            print(f"Repairs are off: set repair.max_per_day in {OVERRIDE} to turn them on.")
            return
        try:
            repairer = live_repairer(args.branch, push=not args.no_push)
        except subprocess.CalledProcessError as error:
            sys.exit(f"apply repair: {CHECKOUT} isn't in a git checkout with a branch, so Repairs can't run "
                     f"({' '.join(error.stderr.split())[:200]})")
        for done in repairer.repair_waiting():
            print(f"{done.signature}: {done.status} ({done.branch or 'no branch'}): {done.why}")
    elif args.command == "sign-in":
        _sign_in(args.url, adapters.site if adapters else WorkerBrowsers(headless=False))
    elif args.command == "chrome-passwords":
        _chrome_passwords(ApplicantProfile.load(args.profile).get("identity.email"))
    elif args.command == "push-test":
        _push_test(adapters.phone if adapters else live_phone())
    elif args.command == "schedule":
        scheduler = schedule.live((load_policies().get("schedule") or {}).get("daily_sweep_at"))
        done = scheduler.install(load=args.load) if args.action == "install" else getattr(scheduler, args.action)()
        print("\n".join(done))
    elif args.command == "mail":
        _mail(args.days, adapters.mailbox if adapters else live_mailbox(ApplicantProfile.load(args.profile).get("identity.email")),
              lambda: adapters.tracker if adapters else live_tracker())
    elif args.command == "add":
        tracker = adapters.tracker if adapters else live_tracker()
        for url in args.urls:
            tracker.add_request(url)
        print(f"Added {len(args.urls)} Requests; the next check of the Requests tab applies to them.")
    elif args.command == "applied":
        add = _applied(adapters) if adapters else _applied_live
        for url in args.urls:
            print(add(url))
    elif args.command == "story-map":
        _story_map(args, adapters.claude if adapters else None)
    elif args.command == "data":
        try:
            shown = data_command.keys(args.file) if args.data_command == "keys" else data_command.show_key(args.key, args.file)
        except data_command.Refused as refused:
            sys.exit(f"apply data: {refused}")
        print("\n".join(shown))
    elif args.command == "ask":
        sys.exit(_ask(args.target, args.message, args.list))
    elif args.command == "plain":
        _plain(args)


def _plain(args) -> None:
    from apply.plain import demo
    from apply.plain.launcher import PlainWorkers

    if args.action == "ping":
        print("\n".join(demo.ping(args.workers, args.chrome)))
    elif args.action == "fill":
        print("\n".join(demo.fill(args.form, args.chrome)))
    elif args.action == "tile":
        demo.tile(args.form, args.seconds, args.chrome)
    elif args.action == "prepare":
        identity = PlainWorkers(kind="testing").prepare()
        print(f"Worker extension ready: Fill engine {identity['version']}.")
    elif args.action == "seed":
        from apply.adapters import SetupError
        from apply.plain import seed_setup

        try:
            done = seed_setup.run()
        except (SetupError, ProfileInUse) as error:
            print(error)
            done = False
        if done:
            print("Setup is done. Plain Workers start as copies of this seed.")
        else:
            sys.exit(1)


def _ask(target: str | None, message: str | None, listed: bool, out: Callable[[str], None] = print,
         sleep: Callable[[float], None] = time.sleep) -> int:
    """`apply ask`: send Lisul's message to the one open form `target` names, in any running Apply window,
    and print Claude's reply once it comes; or list the open forms. Returns the exit code."""
    import json
    import urllib.error
    import urllib.request

    def fetch(window: dict, path: str, body: dict | None = None):
        request = urllib.request.Request(window["url"] + path, data=json.dumps(body).encode() if body else None,
                                         headers={"X-Apply-Token": window["token"], "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=10) as answer:
                return json.loads(answer.read() or b"{}")
        except urllib.error.HTTPError as error:
            raise ask.AskRefused(json.loads(error.read() or b"{}").get("error") or str(error)) from None

    def alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except (ProcessLookupError, ValueError):
            return False
        except PermissionError:
            return True

    forms = ask.windows(WorkerBrowsers().profiles / ask.WINDOWS, alive, fetch)
    if listed or not target:
        out("\n".join(f.line() for f in forms) or "No form is open in an Apply window.")
        return 0
    found = ask.matching(forms, target)
    if not found:
        out(f"No open form matches {target!r}. Open forms:\n" + ("\n".join(f.line() for f in forms) or "none"))
        return 1
    if len(found) > 1:
        out(f"{len(found)} open forms match {target!r}: say which, by its ID.\n" + "\n".join(f.line() for f in found))
        return 2
    if not (message or "").strip():
        out("Say what Claude should fix, after the form: apply ask <form> \"<message>\"")
        return 1
    form = found[0]
    try:
        sent = fetch(form.window, "/ask", {"id": f"tile-{form.worker}", "message": message, "via": "terminal"})
    except ask.AskRefused as refused:
        out(f"Not sent: {refused}")
        return 1
    entry_id = sent["ask"]["id"]
    out(f"Sent to {form.tile.get('company') or form.id}. Claude is working on the form (it never presses Submit)…")
    waited = 0.0
    while waited < ask.WAIT_S:
        sleep(2)
        waited += 2
        try:
            entry = fetch(form.window, f"/ask/{entry_id}")
        except Exception:
            out("The Apply window closed before Claude replied.")
            return 1
        if entry.get("state") in ("done", "failed"):
            out(ask.told(entry))
            return 0 if entry["state"] == "done" else 1
    out(f"No reply after {ask.WAIT_S // 60} minutes: Claude may still be working. The form's tile shows its reply.")
    return 1


def _push_test(phone) -> None:
    """Send one test push, whether or not the phone_push policy is on."""
    if phone is None:
        sys.exit(SET_UP)
    try:
        phone.notify(*TEST_PUSH)
    except Exception as failed:
        sys.exit(f"The test push failed: {failed}")
    print(f"Sent a test push to your phone. Once it shows, set `phone_push: true` in {OVERRIDE} "
          "for a push after every run.")


def _story_map(args, claude) -> None:
    if args.check or args.gaps:
        print("\n".join((story_map.check() if args.check else []) + (story_map.gaps() if args.gaps else [])) or
              ("No stale entries." if args.check else "No follow-ups the bank can't answer."))
        return
    built = story_map.build(claude or ClaudeCLI())
    old = yaml.safe_load(story_map.MAP.read_text()) if story_map.MAP.exists() else None
    print("\n".join(story_map.diff((old or {}).get("episodes") or [], built["episodes"])) or "No changes.")
    if built["dropped"]:
        print("Dropped by the checks:\n" + "\n".join(f"  {why}" for why in built["dropped"]))
    if args.yes or input(f"Write {story_map.MAP}? [y/N] ").strip().lower() in ("y", "yes"):
        story_map.write(built)
        print(f"Wrote {len(built['episodes'])} entries to {story_map.MAP}.")


def _mail(days: int, mailbox, tracker) -> None:
    """One read-only pass over the last `days` days of employer mail. Without
    Gmail set up it says so and exits non-zero, before opening the Tracker."""
    if why := mailbox.unavailable():
        sys.exit(f"apply mail: {why}")
    try:
        mails = mailbox.read_mail(search=employer_mail.SEARCH.format(days))
    except imaplib.IMAP4.error as error:
        sys.exit(f"apply mail: Gmail refused to sign in ({error}); check the app password saved in Keychain.")
    except OSError as error:
        sys.exit(f"apply mail: couldn't reach Gmail ({error}).")
    print(employer_mail.describe(employer_mail.sync(mails, tracker()), len(mails), days))


def _refuse_unless_live_runs_on(profile: ApplicantProfile, command: str) -> None:
    """A live run or approve pass submits for real, so it waits until Lisul sets policies.yaml's
    live_runs to true. Missing, the switch is off. Rehearsals never submit and never ask."""
    if profile.policy("live_runs") is not True:
        sys.exit(f"Live runs are off, so `apply {command}` submits nothing and has not started. "
                 f"Turn them on by setting `live_runs: true` in {profile.folder / 'policies.yaml'}. "
                 "Until then, `apply rehearse <links>` fills forms without submitting.")


def _refuse_temp_state(profile: ApplicantProfile, command: str) -> None:
    """A reboot wipes a temp folder, and every held form and sign-in in it. Test Person has none to lose."""
    if profile.get("sample_data") is True:
        return
    why = home.temp_state(WorkerBrowsers().profiles)
    if why:
        sys.exit(f"apply {command}: {why}")


def _refuse_busy_worker_profiles(command: str) -> None:
    """One process per Worker profile: a second run or rehearsal would break the browsers of the one going."""
    try:
        WorkerBrowsers().refuse_in_use()
    except ProfileInUse as busy:
        sys.exit(f"apply {command}: {busy}")


def _refuse_stale_resume(profile: ApplicantProfile, command: str) -> None:
    """Stop before any form gets a resume other than the accepted one (policies.yaml's resume_source).
    A check that couldn't be made only warns: `gh` being offline never stops a run."""
    verdict = resume_check.compare(profile.policy("resume_source"), profile.get("files.resume_pdf"))
    if verdict and verdict.state == resume_check.STALE:
        sys.exit(f"apply {command}: {verdict.line}")
    if verdict and verdict.state == resume_check.UNKNOWN:
        print(f"apply {command}: warning: {verdict.line}", file=sys.stderr)


# Beside the Worker profiles: the address of the dashboard of the run going, for `apply watch`.
DASHBOARD_URL = "dashboard.url"


def _stop(signum, frame) -> None:
    """A SIGTERM: stop as Ctrl-C stops, so each `finally` closes what it opened."""
    raise KeyboardInterrupt


@contextmanager
def _dashboard(adapters: Adapters, tiles: int, profile: ApplicantProfile, workers: int | None = None):
    """Serve the dashboard (a live tile per Worker, and the Answers tab over
    the run's own Answer bank and profile) while a run goes, and open it in its own window."""
    site = adapters.site
    answers = AnswersTab(adapters.answer_bank, profile, held=adapters.tracker.rows)
    with _frames(site, workers or tiles) as frames, \
            dashboard.Dashboard(tiles, frames, answers, _applied(adapters), past=adapters.tracker.rows,
                                answer=_answering(lambda: adapters.tracker, answers),
                                approve=_approving(lambda: adapters.tracker), notify=adapters.notifier.notify,
                                show=getattr(site, "show", None), sample=profile.get("sample_data") is True,
                                everyday=adapters.everyday, accounts=_accounts_tab(lambda: adapters.tracker,
                                                                                   adapters.keychain, adapters.everyday),
                                quiet=getattr(site, "plain", None), remember=_remembering(adapters.answer_bank),
                                **_window_context()) as board:
        adapters.board = board
        url = site.profiles / DASHBOARD_URL
        url.parent.mkdir(parents=True, exist_ok=True)
        url.write_text(board.url)
        noted = ask.register(site.profiles / ask.WINDOWS, board.url, board.token, os.getpid())  # for `apply ask`
        dashboard.open_window(board.url, site.profiles / "dashboard", front=False)  # never pulls Lisul from his work
        print(f"Dashboard: {board.url} (open it from Apply in the Dock, or with: apply watch)")
        try:
            yield
        finally:
            url.unlink(missing_ok=True)
            noted.unlink(missing_ok=True)


def _fill_again(target: str) -> int:
    """`apply fill-again`: ask the window to fill the form anew, then wait for that fill to stop and print how."""
    try:
        window, tile, answer = into.fill_again(target)
        print(answer.get("message") or "Filling it again.")
        caption = into.outcome(window, tile)
    except into.NoWindow as error:
        print(f"apply fill-again {target}: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Stopped waiting; the window goes on filling.")
        return 0
    print(" | ".join(str(caption.get(k) or "") for k in ("company", "role", "status", "why")))
    return 0
def _gmail_set_up() -> bool:
    """Whether Keychain lists a Gmail app password: attributes only, never the password."""
    try:
        return bool(MacKeychain(GMAIL).sites())
    except (OSError, subprocess.SubprocessError):
        return False


def _preflight(urls: list[str], workers: int, adapters: Adapters | None) -> None:
    """`apply preflight`: the sign-ins and the plan for `urls`, from the links, Keychain's attributes and the
    Worker profiles' notes. Nothing here opens a page or reads a job site."""
    if wrong := [url for url in urls if not urlsplit(url).hostname or url.split() != [url]]:
        print(f"apply preflight: not a link: {wrong[0]}", file=sys.stderr)
        raise SystemExit(2)
    keychain = adapters.keychain if adapters else MacKeychain()
    try:
        items = keychain.sites()
    except (OSError, subprocess.SubprocessError):
        items = None  # no Keychain here, or it would not list: the report says so
    browsers = None if adapters else WorkerBrowsers()
    signed_in = adapters.site.signed_in() if adapters else browsers.signed_in()
    policies = load_policies()
    sites = preflight.group(urls, items, signed_in, bool(adapters) or bool(browsers.profiles_made()),
                            policies.get("plain_worker_hosts") or ())
    print(preflight.report(sites, workers, _gmail_set_up(), policies.get("worker_mode") or "cdp",
                           policies.get("workday_sign_in") == "google"))


def _reopening(args, adapters: Adapters | None) -> "rehearsal.Reopening | None":
    """`apply reopen`: the open-forms list's plan for this profiles folder (KAN-720), printed; with `--list`, or
    with nothing to reopen, None. Else the rehearsal's links, Workers and drafts are set from it."""
    kept = batch.forms()
    planned = batch.plan(kept, adapters.site.profiles if adapters else WorkerBrowsers().profiles)
    print("\n".join(batch.lines(planned)))
    if args.list or not planned.firsts:
        return None
    by_link = {form["link"]: form for form in kept}
    links = planned.firsts + [link for later in planned.later.values() for link in later]
    args.urls, args.workers, args.together, args.force = planned.firsts, len(planned.firsts), False, False
    return rehearsal.Reopening(planned.workers, planned.later, {link: batch.draft(by_link[link]) for link in links},
                               {link: str(by_link[link].get("opened") or "") for link in links})


def _tiles() -> list[dict]:
    """Every tile of every running Apply window of this profiles folder (into.windows), as its /state says."""
    tiles = []
    for window in into.windows():
        try:
            tiles += into._call(window, "/state", timeout=5).get("tiles") or []
        except into.NoWindow:
            continue  # a window going away
    return tiles


def _send_into(target: str, urls: list[str]) -> int:
    """`apply rehearse --into`: send each link into the window `target` names, then wait for each one's
    form to stop being filled and print how it stopped. The window's process fills it; this one opens nothing."""
    sent = []
    for url in urls:
        try:
            window, taken = into.send(target, url)
        except into.NoWindow as error:
            print(f"apply rehearse --into {target}: {error}", file=sys.stderr)
            return 1
        print(f"Sent {url} into Browser {taken['worker'] + 1} of {window['url']} (tile {taken['tile'] + 1}). "
              "Its sign-in holds; Apply submits nothing.")
        sent.append((window, taken["tile"], url))
    try:
        for window, tile, url in sent:
            caption = into.outcome(window, tile)
            print(" | ".join(str(caption.get(k) or "") for k in ("company", "role", "status", "why")) or url)
    except into.NoWindow as error:
        print(f"The window went away: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Stopped waiting; the window goes on filling.")
    return 0


def _remembering(bank: AnswerBank) -> Callable[[str, str], str]:
    """Ask Claude's offer, saved on Lisul's click: his own answer in the Answer bank, for later forms."""
    def remember(question: str, answer: str) -> str:
        bank.answer(question, answer, date.today())
        return f"Saved to your answers: {question} → {answer}. Later forms that ask it get it."
    return remember


def _worker_chrome(workers) -> Callable[[int], int | None]:
    """The PID of the Chrome that has plain Worker k's profile open: its tile films that Chrome only (KAN-717)."""
    from apply.browsers import chrome_pid

    return lambda worker: chrome_pid(workers.profile(worker))


def _frames(site, tiles: int):
    """The window's frame source for `site`'s Workers (worker_mode): CDP Workers' screencast,
    plain Workers' port (S3), or in `protected` mode whichever Worker k runs now."""
    from apply.plain.site import PlainSite, RoutedSite
    from apply.plain.tile import EitherFrames, PortFrames

    if isinstance(site, PlainSite):
        return PortFrames(tiles, site.workers.bridge.connection, chrome=_worker_chrome(site.workers))
    if isinstance(site, RoutedSite):
        return EitherFrames(dashboard.CdpFrames(tiles, site.endpoint),
                            PortFrames(tiles, site.connection, chrome=_worker_chrome(site.plain_site.workers)), site.plain)
    return dashboard.CdpFrames(tiles, site.endpoint)


def _close_workers(site) -> None:
    """Stop the plain Workers' Chromes the run started (by PID). A CDP Worker's closes with its page."""
    close = getattr(site, "close", None)
    if close:
        try:
            close()
        except Exception as error:
            print(f"Couldn't stop every plain Worker ({type(error).__name__}: {error}).", file=sys.stderr)


def _chrome_passwords(login: str) -> None:
    """Install the Apply accounts host for Lisul's everyday Chrome, and list each Employer account Keychain
    has in the Tracker, so the extension's Sign In button knows it (KAN-592). No password is read."""
    manifest = native_host.install()
    added = native_host.adopt(MacKeychain(), FileTracker(), login, date.today())
    print(f"Installed the Apply accounts host: {manifest}, for the WorkIt extension only ({native_host.EXTENSION_ID}).")
    print(f"Listed {len(added)} more Employer accounts from Keychain in the Tracker" + (f": {', '.join(added)}." if added else "."))
    print("In Chrome, open the WorkIt extension's options page and turn on Use My Apply Accounts (Chrome asks once to "
          "let it talk to Apply). Then, on a Workday Sign In page that Apply made an account for, press Sign In with "
          "Your Apply Account, and press Save when Chrome asks to save the password.")


def _answers_window(profile: Path, window: Path) -> None:
    """With no run going, serve the Apply window's Answers tab alone, over
    the profile and the Answer bank beside it, till its window closes."""
    sheet = []  # the live Tracker, opened once the window needs it

    def tracker():
        sheet[:] = sheet or [live_tracker()]
        return sheet[0]

    tab = AnswersTab(AnswerBank(profile.parent / ANSWER_BANK), profile, held=lambda: tracker().rows())

    with dashboard.Dashboard(0, dashboard.NoFrames(), tab, _applied_live, past=lambda: tracker().rows(),
                             answer=_answering(tracker, tab), approve=_approving(tracker),
                             everyday=captcha.to_everyday_chrome,
                             accounts=_accounts_tab(tracker, MacKeychain(), captcha.to_everyday_chrome),
                             **_window_context()) as board:
        dashboard.open_window(board.url, window)
        print(f"Answers: {board.url} (no run is going; close the window or press Ctrl-C to stop)")
        try:
            while dashboard.window_open(window):
                time.sleep(1)
        except KeyboardInterrupt:
            pass


def _accounts_tab(tracker: Callable[[], object], keychain, everyday: Callable[[str], None]) -> AccountsTab:
    """The window's Accounts tab over the Tracker's Employer accounts, their passwords in Keychain (KAN-591)."""
    return AccountsTab(lambda: tracker().employer_accounts(), keychain, rows=lambda: tracker().rows(), everyday=everyday)


def _answering(tracker: Callable[[], object], tab: AnswersTab) -> Callable[[dict, str, str], str]:
    """Save Lisul's answer typed in the Inbox where Apply reads it: a run's
    Missing fact in its Tracker row's Answer cell, as if he typed it in the
    Sheet, so the next check fills that Application again with it; a
    rehearsal's into his Applicant profile, for every form after, or, for
    what an essay asked him, into the Story bank, for every essay after. A
    bare date (From, To) is that form's alone: never saved by its label.
    The same for his answer typed on the held form itself (Board.typed)."""
    def answer(item: dict, question: str, text: str) -> str:
        if item.get("status") == "missing fact" and item.get("application_id"):
            tracker().answer(item["application_id"], text)
            return f"Saved your answer for {item.get('company') or 'it'}: it goes on at the next check."
        if question.startswith(essays.ASK):
            essays.remember_fact(question, text, item.get("company") or "", SystemClock().now().date())
            return "Saved to your Story bank: the essay is written with it next time."
        if on_page.bare(question):  # a bare From or To: true of one section of this form only (KAN-595)
            return "Kept on this form only: a bare date isn't saved to your facts without what it is for."
        tab.save_answered(question, text)
        return "Saved to your facts: every form that asks it gets this answer."
    return answer


def _approving(tracker: Callable[[], object]) -> Callable[[str], str]:
    """Approve a Hold from the Apply window, in Apply's Tracker (KAN-544): the next check sends it."""
    def approve(application_id: str, essay: str | None = None) -> str:
        tracker().approve(application_id, essay)
        return "Approved: it is sent at the next check, within 5 minutes."
    return approve


def _window_context() -> dict:
    """What the Apply window links and says beyond the run: the student's Applications Tracker on WorkIt,
    and when the Daily sweep runs."""
    return {"tracker_url": f"{workit.site().web}/applications", "sweep_at": schedule.daily_sweep_at()}


def live_tracker() -> WorkItTracker:
    """Apply's Tracker, the file in the data folder, which also writes each Application's new status to the
    student's Applications Tracker on WorkIt (KAN-544). The first time, the rows of the retired Tracker
    Sheet are copied in (read only), so no run applies again to a job already applied to."""
    local = FileTracker()
    if not local.path.exists() and sheet.SHEET_ID.is_file():
        try:
            copied = sheet.copy_into(sheet.live_tracker_sheet(), local)
        except Exception as error:
            raise RuntimeError(f"the Tracker Sheet's rows could not be copied into {local.path} "
                               f"({type(error).__name__}: {error}); run again once the Sheet reads") from error
        print(f"Copied {copied} rows of the Tracker Sheet into {local.path}. Apply no longer writes the Sheet.",
              file=sys.stderr)
    return WorkItTracker(local, workit.WaitingWrites(), _resume_of)


def _resume_of(application_id: str) -> str:
    """The resume an Application's form was given, from its folder under SENT."""
    try:
        name = Path(str(ApplicantProfile.load(DEFAULT_PROFILE).get("files.resume_pdf") or "")).name
    except Exception:
        name = ""
    return sent_resume(application_id, name)


def _send_waiting_writes() -> None:
    """Before a run or rehearsal: send the writes to the Applications Tracker that waited for WorkIt."""
    writes = workit.WaitingWrites()
    waiting = len(writes.waiting())
    for problem in writes.flush():
        print(problem, file=sys.stderr)
    if waiting and (left := len(writes.waiting())):
        print(f"{left} writes still wait to go to your Applications Tracker (apply doctor lists them).",
              file=sys.stderr)


def _applied(adapters: Adapters) -> Callable[[str], str]:
    """Add the Own application a link leads to, to `adapters`' Tracker, and say how it went."""
    return lambda url: own_application.report(url, tracker=adapters.tracker, claude=adapters.claude,
                                              site=adapters.site, clock=adapters.clock)


def _applied_live(url: str) -> str:
    """An Own application pasted into the window with no run going, added to the live Tracker."""
    return own_application.report(url, tracker=live_tracker(), claude=ClaudeCLI(), site=WorkerBrowsers(),
                                  clock=SystemClock())


def _sign_in(url: str, browsers: WorkerBrowsers) -> None:
    """Lisul signs one Worker profile in to the site of `url` by hand, in a
    Chrome window; once he presses Enter or closes it, and says he signed
    in, every other Worker profile becomes a copy of it and the site is noted
    as signed in, so Postings behind its wall fill as usual."""
    site = walls.site(url)
    lines = _Lines()
    print(f"A Chrome window opens on {url}. Sign in to {site} yourself there (Apply never types or keeps your "
          "password; decline if Chrome offers to save it). Once you're signed in, close the window or press Enter here.")
    try:
        profile = browsers.sign_in(url, lines.until_enter_or_closed)
        print(f"Did you sign in to {site}? [y/N] ", end="", flush=True)
        if (lines.next() or "").strip().lower() not in ("y", "yes"):
            print(f"Nothing copied or noted; Postings on {site} stay Handoffs.")
            return
        copied = browsers.share(profile)
    except ProfileInUse as busy:
        raise SystemExit(f"apply sign-in: {busy}")
    browsers.signed_in_to(site)
    print(f"Signed in to {site} in {profile.name}" + (f", copied to {', '.join(p.name for p in copied)}" if copied else "")
          + f". Postings on {site} now fill as usual.")


class _Lines:
    """What Lisul types in the terminal, a line at a time, read on a thread of
    its own so the sign-in window can be watched meanwhile."""

    def __init__(self):
        self._lines: queue.Queue[str | None] = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        while line := sys.stdin.readline():
            self._lines.put(line)
        self._lines.put(None)  # no more input

    def next(self) -> str | None:
        return self._lines.get()

    def until_enter_or_closed(self, context) -> None:
        """Wait until Lisul presses Enter or closes every tab of the window."""
        while self._lines.empty() and context.pages:
            try:
                context.pages[0].wait_for_timeout(250)
            except Exception:
                pass  # the tab closed as we waited
        if not self._lines.empty():
            self._lines.get()


# The checkout Apply runs from: a Repair merges into its branch and pushes to its own remote (origin).
CHECKOUT = Path(__file__).resolve().parent


def live_repairer(branch: str | None = None, push: bool = True) -> Repairer:
    """The Repairer over the live Repair requests, merging into `branch`,
    else policies.yaml's repair.branch, else the branch Apply runs from."""
    policy = load_policies().get("repair") or {}
    git = lambda *a: subprocess.run(["git", "-C", str(CHECKOUT), *a], check=True, capture_output=True, text=True).stdout.strip()
    claude = ClaudeCLI()
    return Repairer(
        repo=Path(git("rev-parse", "--show-toplevel")), requests=RepairRequests(REPAIRS), claude=claude, usage=claude,
        notifier=MacNotifier(), tracker=live_tracker, branch=branch or policy.get("branch") or git("branch", "--show-current"),
        policy=policy, push=push,
    )


def live_machine(profile: Path, usage: bool = False) -> doctor.Machine:
    """What `apply doctor` checks: this Mac's own setup, and with `usage` the Max plan's usage. A profile
    that doesn't load is one failed check: every other check still runs."""
    return doctor.Machine(profile=doctor.load_profile(profile), usage=ClaudeCLI() if usage else None)


def _records(profile: ApplicantProfile):
    """policies.yaml's records_remote, a git repo of the applicant's own; unset, a folder in the data folder."""
    remote = profile.policy("records_remote")
    return GitRecords(remote) if remote else FolderRecords(RECORDS)


def live_adapters(profile: ApplicantProfile, tracker=None, records=None, notifier=None, mailbox=None,
                  keychain=None, answer_bank=None, phone=None) -> Adapters:
    """The real systems a run touches, but for any adapter given. Building
    them connects to nothing (the Tracker is a file in the data folder); the
    Gmail app password is read from Keychain for the Applicant profile's
    email (unless a Mailbox is given), and so is the ntfy topic (unless a
    phone Notifier is given)."""
    claude = ClaudeCLI()  # also reads usage, off every call's rate-limit events
    site = live_site(profile.policies())  # policies.yaml: worker_mode (cdp, plain or protected)
    return Adapters(
        feed=live_feed(),
        tracker=live_tracker() if tracker is None else tracker,
        site=site,
        claude=claude,
        mailbox=live_mailbox(profile.get("identity.email")) if mailbox is None else mailbox,
        usage=claude,
        clock=SystemClock(),
        records=_records(profile) if records is None else records,
        notifier=MacNotifier() if notifier is None else notifier,
        phone=live_phone() if phone is None else phone,
        keychain=MacKeychain() if keychain is None else keychain,
        repairs=RepairRequests(REPAIRS),
        answer_bank=AnswerBank(profile.folder / ANSWER_BANK) if answer_bank is None else answer_bank,
        signed_in=site.signed_in(),  # by apply sign-in
        tailored=tailored.from_workit(),  # the student's tailored resume for each Posting (KAN-547)
        everyday=captcha.to_everyday_chrome,  # a bot-blocked posting goes to the student's own Chrome (KAN-590)
        applied_before=already_applied.Check(),  # never fill a form already sent (KAN-621)
    )


if __name__ == "__main__":  # `python -m apply.cli`: how a run starts `apply repair` in the background
    main()
