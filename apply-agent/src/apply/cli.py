"""The `apply` command."""

import argparse
import imaplib
import os
import queue
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import yaml

from apply import (
    bot_signals,
    dashboard,
    doctor,
    employer_mail,
    essays,
    home,
    orchestrator,
    own_application,
    rehearsal,
    schedule,
    story_map,
    trace,
    walls,
)
from apply.adapters import Adapters
from apply.answer_bank import AnswerBank
from apply.answers_tab import AnswersTab
from apply.browsers import ProfileInUse, WorkerBrowsers
from apply.claude_cli import ClaudeCLI
from apply.clock import SystemClock
from apply.feed import live_feed
from apply.gmail import live_mailbox
from apply.home import HOME
from apply.keychain import MacKeychain
from apply.match_queue import match_queue
from apply.notify import SET_UP, TEST_PUSH, MacNotifier, RecordingNotifier, live_phone
from apply.profile import OVERRIDE, ApplicantProfile, load_policies
from apply.records import FolderRecords, GitRecords
from apply.repair import FOLDER as REPAIRS
from apply.repair import RepairRequests
from apply.repairer import Repairer, repair_later
from apply.sheet import SHEET_ID, live_tracker
from apply.tracker import InMemoryTracker

DEFAULT_PROFILE = HOME / "applicant-profile.yaml"
# The Answer bank's file, beside the Applicant profile.
ANSWER_BANK = "answer-bank.yaml"
# Where a rehearsal keeps its Records, one folder per day.
REHEARSALS = HOME / "rehearsals"
# Where a run keeps its Records while policies.yaml sets no records_remote.
RECORDS = HOME / "records"


def main(argv: list[str] | None = None, adapters: Adapters | None = None) -> None:
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
    for command in (run, approve_pass, rehearse):
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
    args = parser.parse_args(argv)
    if args.command != "doctor" and home.fill_from_sample():  # doctor only reads: it says the profile is missing
        print(f"No Applicant profile yet: copied the Test Person sample data into {HOME}. Apply runs as Test Person "
              "(the window says Sample data) until you put your own files there.", file=sys.stderr)

    if args.command in ("run", "approve-pass"):
        profile = ApplicantProfile.load(args.profile)
        kinds = {"matches": not args.requests_only} if args.command == "run" else {"matches": False, "requests": False}
        if adapters:
            orchestrator.run(adapters, profile, args.workers, **kinds)
        else:
            _refuse_unless_live_runs_on(profile, args.command)
            _refuse_busy_worker_profiles(args.command)
            adapters = live_adapters(profile, answer_bank=AnswerBank(args.profile.parent / ANSWER_BANK))
            WorkerBrowsers().seed(args.workers)
            with _dashboard(adapters, args.workers, profile):
                orchestrator.run(adapters, profile, args.workers, **kinds)
            repair_later(adapters.repairs, profile.policy("repair") or {})
    elif args.command == "rehearse":
        profile = ApplicantProfile.load(args.profile)
        live = adapters is None
        if live:
            _refuse_busy_worker_profiles(args.command)
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
            try:  # where an Application Lisul submits from a held page is kept
                sheet = live_tracker()
            except Exception as error:
                sheet = None
                print(f"No Tracker ({type(error).__name__}: {error}): add a row yourself for any you submit.")
            with _dashboard(adapters, len(args.urls), profile):  # a tile per link: each keeps its page open
                rehearsal.rehearse(args.urls, adapters, profile, args.workers, on_done=lambda: repair_later(adapters.repairs, profile.policy("repair") or {}),
                                   submitted_to=sheet, together=args.together)
        else:
            rehearsal.rehearse(args.urls, adapters, profile, args.workers, submitted_to=adapters.tracker,
                               together=args.together)
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


def _refuse_busy_worker_profiles(command: str) -> None:
    """One process per Worker profile: a second run or rehearsal would break the browsers of the one going."""
    try:
        WorkerBrowsers().refuse_in_use()
    except ProfileInUse as busy:
        sys.exit(f"apply {command}: {busy}")


# Beside the Worker profiles: the address of the dashboard of the run going, for `apply watch`.
DASHBOARD_URL = "dashboard.url"


@contextmanager
def _dashboard(adapters: Adapters, tiles: int, profile: ApplicantProfile):
    """Serve the dashboard (a live tile per Worker, and the Answers tab over
    the run's own Answer bank and profile) while a run goes, and open it in its own window."""
    site = adapters.site
    answers = AnswersTab(adapters.answer_bank, profile, held=adapters.tracker.rows)
    with dashboard.CdpFrames(tiles, site.endpoint) as frames, \
            dashboard.Dashboard(tiles, frames, answers, _applied(adapters), past=adapters.tracker.rows,
                                answer=_answering(lambda: adapters.tracker, answers), notify=adapters.notifier.notify,
                                show=getattr(site, "show", None), sample=profile.get("sample_data") is True,
                                **_window_context()) as board:
        adapters.board = board
        url = site.profiles / DASHBOARD_URL
        url.parent.mkdir(parents=True, exist_ok=True)
        url.write_text(board.url)
        dashboard.open_window(board.url, site.profiles / "dashboard", front=False)  # never pulls Lisul from his work
        print(f"Dashboard: {board.url} (open it from Apply in the Dock, or with: apply watch)")
        try:
            yield
        finally:
            url.unlink(missing_ok=True)


def _answers_window(profile: Path, window: Path) -> None:
    """With no run going, serve the Apply window's Answers tab alone, over
    the profile and the Answer bank beside it, till its window closes."""
    sheet = []  # the live Tracker, opened once the window needs it

    def tracker():
        sheet[:] = sheet or [live_tracker()]
        return sheet[0]

    tab = AnswersTab(AnswerBank(profile.parent / ANSWER_BANK), profile, held=lambda: tracker().rows())

    with dashboard.Dashboard(0, dashboard.NoFrames(), tab, _applied_live, past=lambda: tracker().rows(),
                             answer=_answering(tracker, tab), **_window_context()) as board:
        dashboard.open_window(board.url, window)
        print(f"Answers: {board.url} (no run is going; close the window or press Ctrl-C to stop)")
        try:
            while dashboard.window_open(window):
                time.sleep(1)
        except KeyboardInterrupt:
            pass


def _answering(tracker: Callable[[], object], tab: AnswersTab) -> Callable[[dict, str, str], str]:
    """Save Lisul's answer typed in the Inbox where Apply reads it: a run's
    Missing fact in its Tracker row's Answer cell, as if he typed it in the
    Sheet, so the next check fills that Application again with it; a
    rehearsal's into his Applicant profile, for every form after, or, for
    what an essay asked him, into the Story bank, for every essay after."""
    def answer(item: dict, question: str, text: str) -> str:
        if item.get("status") == "missing fact" and item.get("application_id"):
            tracker().answer(item["application_id"], text)
            return f"Saved your answer for {item.get('company') or 'it'}: it goes on at the next check."
        if question.startswith(essays.ASK):
            essays.remember_fact(question, text, item.get("company") or "", SystemClock().now().date())
            return "Saved to your Story bank: the essay is written with it next time."
        tab.save_answered(question, text)
        return "Saved to your facts: every form that asks it gets this answer."
    return answer


def _window_context() -> dict:
    """What the Apply window links and says beyond the run: the Tracker Sheet, and when the Daily sweep runs."""
    sheet = SHEET_ID.read_text().strip() if SHEET_ID.exists() else ""
    return {"tracker_url": f"https://docs.google.com/spreadsheets/d/{sheet}" if sheet else "",
            "sweep_at": schedule.daily_sweep_at()}


def _applied(adapters: Adapters) -> Callable[[str], str]:
    """Add the Own application a link leads to, to `adapters`' Tracker, and say how it went."""
    return lambda url: own_application.report(url, tracker=adapters.tracker, claude=adapters.claude,
                                              site=adapters.site, clock=adapters.clock)


def _applied_live(url: str) -> str:
    """An Own application pasted into the window with no run going, added to the live Sheet."""
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
    them connects to nothing but the Sheet (unless a Tracker is given); the
    Gmail app password is read from Keychain for the Applicant profile's
    email (unless a Mailbox is given), and so is the ntfy topic (unless a
    phone Notifier is given)."""
    claude = ClaudeCLI()  # also reads usage, off every call's rate-limit events
    site = WorkerBrowsers(headless=profile.policy("worker_headless") is not False)
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
    )


if __name__ == "__main__":  # `python -m apply.cli`: how a run starts `apply repair` in the background
    main()
