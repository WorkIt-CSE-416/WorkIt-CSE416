"""`apply doctor`: fast, read-only checks of the setup a run needs, one line
each (ok, warn or fail, and how to fix it), so a missing Gmail app password
or a signed-out Worker profile shows before a run instead of as its Handoffs."""

import base64
import io
import json
import os
import plistlib
import subprocess
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from fake_workit import FakeWorkIt
from fakes import FakeMailbox, ScriptedUsage

from apply import doctor, native_host, workit
from apply.adapters import UsageReading
from apply.model import Status
from apply.orchestrator import SUBMITTING
from apply.profile import ApplicantProfile
from apply.tracker import InMemoryTracker, Row
from apply.workit import WorkIt


def chrome(tmp_path, version="141.0.7390.55"):
    info = tmp_path / "Info.plist"
    info.write_bytes(plistlib.dumps({"CFBundleShortVersionString": version}))
    return info


def filled(tmp_path):
    """Every fact a form needs, filled in: a dummy person, never Lisul's data."""
    (tmp_path / "resume.pdf").write_bytes(b"%PDF-1.4")
    return {
        "identity": {"legal_first_name": "Test", "legal_last_name": "Person", "email": "test.person@example.com",
                     "phone": "+15550100199", "current_location": {"city": "Columbus", "state": "OH", "country": "USA"}},
        "files": {"resume_pdf": "resume.pdf"},
        "links": {"linkedin_url": "https://www.linkedin.com/in/test-person"},
        "education": {"school": "Ohio State University", "degree": "Bachelor's Degree", "expected_graduation": "2028-05"},
        "work_authorization": {"authorized_to_work_us": True, "requires_sponsorship_now_or_future": False},
    }


def profile(tmp_path, facts=None, **policies):
    return ApplicantProfile(filled(tmp_path) if facts is None else facts, tmp_path, {"live_runs": True} | policies)


def claude_status(**status):
    """`claude auth status` as the claude CLI prints it."""
    shown = {"loggedIn": True, "authMethod": "claude.ai", "email": "test.person@example.com",
             "subscriptionType": "max"} | status
    return lambda: json.dumps(shown, indent=2)


def list_accounts(email: str) -> str:
    """Google's ListAccounts answer as Chrome keeps it in Preferences: a
    protobuf, base64, with the account's name, email and photo."""
    def text(field, value: bytes) -> bytes:
        return bytes([field << 3 | 2, len(value)]) + value
    account = b"\x08\x01" + text(2, b"Test Person") + text(3, email.encode()) + text(4, b"https://lh3.example/p.jpg")
    return base64.b64encode(text(1, account)).decode()


def worker(profiles, name, account=None, busy=False, web=None):
    """A Worker profile on disk as Chrome leaves it: signed in to Google as
    `account` (Chrome's own sign-in), or only on Google's web pages as `web`,
    and with `busy` a live browser's SingletonLock (this process)."""
    folder = profiles / name / "Default"
    folder.mkdir(parents=True)
    accounts = [{"email": account, "gaia": "1"}] if account else []
    preferences = {"account_info": accounts}
    if web:
        preferences["gaia_cookie"] = {"last_list_accounts_binary_data": list_accounts(web)}
    (folder / "Preferences").write_text(json.dumps(preferences))
    if busy:
        os.symlink(f"host.local-{os.getpid()}", profiles / name / "SingletonLock")
    return profiles


def signed_in(tmp_path, folder="profiles"):
    return worker(tmp_path / folder, "worker-1", "test.person@example.com")


def git(*args) -> str:
    return subprocess.run(["git", "-c", "user.name=T", "-c", "user.email=t@example.com", *args],
                          check=True, capture_output=True, text=True).stdout


def records(folder, commit=True):
    """apply-records as GitRecords leaves it: a bare remote, and a clone that
    pushed a Record (with `commit`). Returns (remote, clone)."""
    remote, clone = folder / "apply-records.git", folder / "clone"
    git("init", "-q", "--bare", "-b", "main", str(remote))
    git("clone", "-q", str(remote), str(clone))
    if commit:
        git("-C", str(clone), "commit", "-q", "--allow-empty", "-m", "submitted: Acme, Intern")
        git("-C", str(clone), "push", "-q", "origin", "HEAD:main")
    return str(remote), clone


def no_claude():
    raise FileNotFoundError("claude")


def bundle_and_chromium(tmp_path):
    """A built engine bundle, and Playwright's Chromium for the tests, as `uv run playwright install chromium` leaves it."""
    (tmp_path / "engine.js").write_text("//")
    (tmp_path / "ms-playwright" / "chromium-1248").mkdir(parents=True, exist_ok=True)
    return {"engine": tmp_path / "engine.js", "playwright": tmp_path / "ms-playwright"}


def hosts(folder):
    """Chrome's NativeMessagingHosts folder with the Apply accounts host installed."""
    native_host.install(folder / "NativeMessagingHosts", "/venv/bin/python", folder / "apply")
    return folder / "NativeMessagingHosts"


def machine(tmp_path, **overrides) -> doctor.Machine:
    """A machine where every check passes, but for `overrides`."""
    return replace(doctor.Machine(profile=profile(tmp_path), chrome=chrome(tmp_path), claude=claude_status(),
                                   profiles=signed_in(tmp_path, "every-check-passes"),
                                   mailbox=lambda address: FakeMailbox(), tracker=InMemoryTracker,
                                   records=records(tmp_path / "every-check-passes"),
                                   native_hosts=hosts(tmp_path / "every-check-passes"),
                                   **bundle_and_chromium(tmp_path / "every-check-passes")),
                   **overrides)


def check(m: doctor.Machine, name: str) -> doctor.Check:
    return next(c for c in doctor.diagnose(m) if c.name == name)


def test_chrome_says_its_version(tmp_path):
    assert check(machine(tmp_path), "Chrome") == doctor.Check("Chrome", doctor.OK, "141.0.7390.55")


def test_no_chrome_fails_with_how_to_install_it(tmp_path):
    found = check(machine(tmp_path, chrome=tmp_path / "missing.plist"), "Chrome")
    assert found.level == doctor.FAIL
    assert "google.com/chrome" in found.fix


def test_live_runs_on_warns_that_a_run_submits_for_real_as_the_applicant(tmp_path):
    found = check(machine(tmp_path), "live_runs")
    assert found.level == doctor.WARN
    assert "submits real applications as Test Person" in found.detail
    assert "live_runs: false" in found.fix and str(tmp_path / "policies.yaml") in found.fix


def test_live_runs_off_is_ok_and_says_rehearsals_still_work(tmp_path):
    found = check(machine(tmp_path, profile=profile(tmp_path, live_runs=False)), "live_runs")
    assert found.level == doctor.OK
    assert "rehearsals still work" in found.detail


def test_prints_a_line_per_check_and_exits_zero_with_no_failure(tmp_path):
    out = io.StringIO()
    code = doctor.run(machine(tmp_path), out)
    lines = out.getvalue().splitlines()
    assert code == 0
    assert "ok    Chrome: 141.0.7390.55" in lines
    assert any(line.startswith("warn  live_runs: ") and "; fix: " in line for line in lines)


def test_any_failure_exits_non_zero(tmp_path):
    assert doctor.run(machine(tmp_path, chrome=tmp_path / "missing.plist"), io.StringIO()) == 1


def test_claude_logged_in_says_whose_login(tmp_path):
    found = check(machine(tmp_path), "claude")
    assert found.level == doctor.OK
    assert "test.person@example.com" in found.detail and "max" in found.detail


def test_a_claude_login_with_no_email_says_none(tmp_path):
    found = check(machine(tmp_path, claude=claude_status(email=None)), "claude")
    assert found.level == doctor.OK
    assert found.detail.startswith("logged in (max)") and "None" not in found.detail


def test_claude_logged_out_fails_with_how_to_log_in(tmp_path):
    found = check(machine(tmp_path, claude=claude_status(loggedIn=False)), "claude")
    assert found.level == doctor.FAIL
    assert "claude auth login" in found.fix and "your own Claude plan" in found.fix


def test_no_claude_cli_fails_with_how_to_install_it(tmp_path):
    found = check(machine(tmp_path, claude=no_claude), "claude")
    assert found.level == doctor.FAIL
    assert "install" in found.fix.lower()


def test_claude_saying_something_else_fails_with_what_it_said(tmp_path):
    found = check(machine(tmp_path, claude=lambda: "claude not found in PATH"), "claude")
    assert found.level == doctor.FAIL
    assert "claude not found in PATH" in found.detail


def checks_named(m: doctor.Machine, prefix: str) -> list[doctor.Check]:
    return [c for c in doctor.diagnose(m) if c.name.startswith(prefix)]


def test_each_worker_profile_says_its_google_account(tmp_path):
    profiles = worker(signed_in(tmp_path), "worker-2", "test.person@example.com")
    found = checks_named(machine(tmp_path, profiles=profiles), "worker-")
    assert [(c.name, c.level) for c in found] == [("worker-1", doctor.OK), ("worker-2", doctor.OK)]
    assert "test.person@example.com" in found[0].detail


def test_a_worker_profile_in_use_is_skipped_not_read(tmp_path):
    profiles = worker(signed_in(tmp_path), "worker-2", busy=True)
    [busy] = [c for c in checks_named(machine(tmp_path, profiles=profiles), "worker-") if c.name == "worker-2"]
    assert busy.level == doctor.WARN
    assert "in use" in busy.detail and "skipped" in busy.detail


def test_a_signed_out_profile_beside_a_signed_in_one_only_warns(tmp_path):
    profiles = worker(signed_in(tmp_path), "worker-2")
    [out] = [c for c in checks_named(machine(tmp_path, profiles=profiles), "worker-") if c.name == "worker-2"]
    assert out.level == doctor.WARN
    assert "worker-1" in out.detail  # a run copies the signed-in one over it


def test_no_worker_profile_signed_in_fails_with_how_to_sign_in(tmp_path):
    profiles = worker(tmp_path / "profiles", "worker-1")
    [out] = checks_named(machine(tmp_path, profiles=profiles), "worker-")
    assert out.level == doctor.FAIL
    assert "--password-store=basic" in out.fix and str(profiles / "worker-1") in out.fix


def test_no_worker_profiles_at_all_fails(tmp_path):
    [found] = checks_named(machine(tmp_path, profiles=tmp_path / "none"), "Worker profiles")
    assert found.level == doctor.FAIL


def test_the_worker_extensions_folder_is_not_a_worker_profile(tmp_path):
    profiles = tmp_path / "profiles"
    (profiles / "worker-extension").mkdir(parents=True)
    found = {c.name: c.level for c in doctor.diagnose(machine(tmp_path, profiles=profiles))}
    assert found["Worker profiles"] == doctor.FAIL
    assert "worker-extension" not in found


def test_gmail_set_up_is_ok(tmp_path):
    asked = []
    found = check(machine(tmp_path, mailbox=lambda address: asked.append(address) or FakeMailbox()), "Gmail")
    assert found.level == doctor.OK
    assert asked == ["test.person@example.com"]  # the Applicant profile's email


def test_gmail_without_an_app_password_warns_saying_how_to_set_it_up(tmp_path):
    found = check(machine(tmp_path, mailbox=lambda address: FakeMailbox(set_up=False)), "Gmail")
    assert found.level == doctor.WARN  # optional: a new teammate's doctor does not fail on it
    assert "app password" in found.fix


def test_gmail_with_no_email_in_the_profile_fails(tmp_path):
    found = check(machine(tmp_path, profile=profile(tmp_path, facts={})), "Gmail")
    assert found.level == doctor.FAIL
    assert "identity.email" in found.fix


def workit_check(tmp_path, fake: FakeWorkIt) -> doctor.Check:
    return check(machine(tmp_path, workit=lambda: WorkIt(fake.site, tmp_path / "workit-login.json")), "WorkIt")


def logged_in(tmp_path, fake: FakeWorkIt) -> None:
    client = WorkIt(fake.site, tmp_path / "workit-login.json")
    workit.login(client, lambda url, accept: accept(fake.cookies(fake.session())))


def test_workit_logged_in_says_as_whom(tmp_path):
    with FakeWorkIt() as fake:
        logged_in(tmp_path, fake)
        assert workit_check(tmp_path, fake) == doctor.Check("WorkIt", doctor.OK, "logged in as test.person@example.com")


def test_workit_with_no_login_warns_and_says_rehearsals_still_work(tmp_path):
    with FakeWorkIt() as fake:
        found = workit_check(tmp_path, fake)
    assert found.level == doctor.WARN  # optional: a user with no WorkIt account still rehearses
    assert "rehearsals work without it" in found.detail
    assert "apply login" in found.fix
    assert fake.requests == []  # no login: nothing to ask WorkIt


def test_workit_expired_login_warns_to_log_in_again(tmp_path):
    with FakeWorkIt() as fake:
        logged_in(tmp_path, fake)
        fake.revoke()
        found = workit_check(tmp_path, fake)
    assert found.level == doctor.WARN
    assert "expired" in found.detail
    assert "apply login" in found.fix


def test_workit_unreachable_warns(tmp_path):
    with FakeWorkIt() as fake:
        logged_in(tmp_path, fake)
        fake.stop()
        found = workit_check(tmp_path, fake)
    assert found.level == doctor.WARN
    assert "can't reach WorkIt" in found.detail
    assert found.fix


def test_workit_company_account_warns(tmp_path):
    with FakeWorkIt(account_type="company") as fake:
        logged_in(tmp_path, fake)
        found = workit_check(tmp_path, fake)
    assert found.level == doctor.WARN
    assert "student account" in found.fix


def test_doctor_never_prints_the_workit_tokens(tmp_path):
    with FakeWorkIt() as fake:
        logged_in(tmp_path, fake)
        fake.expire()  # doctor refreshes it
        out = io.StringIO()
        doctor.run(machine(tmp_path, workit=lambda: WorkIt(fake.site, tmp_path / "workit-login.json")), out)
    assert "WorkIt: logged in as test.person@example.com" in out.getvalue()
    assert "access-" not in out.getvalue() and "refresh-" not in out.getvalue()


def tracker(*rows: tuple[Status, str]):
    """A Tracker holding a row of each (Status, Reason)."""
    sheet = InMemoryTracker()
    for n, (status, reason) in enumerate(rows):
        sheet.add(Row(f"app-{n}", "Acme", "Intern", f"https://jobs.example/{n}", "greenhouse", status, reason=reason))
    return lambda: sheet


def test_the_tracker_says_how_many_applications_it_holds(tmp_path):
    found = check(machine(tmp_path, tracker=tracker((Status.HELD, ""), (Status.HANDOFF, ""))), "Tracker")
    assert found == doctor.Check("Tracker", doctor.OK, "2 Applications")


def test_the_tracker_sheet_is_no_longer_checked(tmp_path):
    assert "Tracker Sheet" not in {c.name for c in doctor.diagnose(machine(tmp_path))}


def test_no_workit_write_waiting_is_ok(tmp_path):
    from apply.workit import WaitingWrites

    found = check(machine(tmp_path, waiting_writes=lambda: WaitingWrites(path=tmp_path / "workit-queue.json")), "WorkIt writes")
    assert found == doctor.Check("WorkIt writes", doctor.OK, "none waiting")


def test_workit_writes_waiting_are_listed_with_when_they_go(tmp_path):
    from fake_workit import FakeWorkIt

    from apply.workit import WaitingWrites, Write

    with FakeWorkIt() as fake:
        waiting_writes = WaitingWrites(WorkIt(fake.site, tmp_path / "workit-login.json"), tmp_path / "workit-queue.json")
        waiting_writes.send(Write("request-1", "https://jobs.example/1", "Lockheed Martin", "Intern", "applied"))
        waiting_writes.send(Write("request-2", "https://jobs.example/2", "Arc", "Intern", "needs_you"))  # not logged in

    found = check(machine(tmp_path, waiting_writes=lambda: WaitingWrites(path=tmp_path / "workit-queue.json")), "WorkIt writes")
    assert found.level == doctor.WARN
    assert found.detail == "2 waiting to send to your Applications Tracker: Lockheed Martin (Applied), Arc (Needs you)"
    assert "next run or rehearsal" in found.fix and "apply login" in found.fix


def test_a_workit_write_past_the_daily_cap_says_when_it_goes(tmp_path):
    import datetime

    from apply.workit import WaitingWrites, Write

    until = datetime.datetime(2099, 1, 2, 0, 0, tzinfo=datetime.UTC)
    waiting = WaitingWrites(path=tmp_path / "workit-queue.json")
    waiting._keep([Write("request-1", "https://jobs.example/1", "Arc", "Intern", "needs_you",
                         not_before=until.timestamp())])

    found = check(machine(tmp_path, waiting_writes=lambda: waiting), "WorkIt writes")
    assert found.level == doctor.WARN
    shown = until.astimezone().strftime("%Y-%m-%d %H:%M")
    assert found.detail == ("1 waiting to send to your Applications Tracker: "
                            f"Arc (Needs you, waits for WorkIt's daily cap of added jobs until {shown})")


def test_calibration_run_counts_held_and_submitted_applications(tmp_path):
    rows = tracker((Status.HELD, ""), (Status.SUBMITTED, ""), (Status.FILLING, SUBMITTING), (Status.HANDOFF, ""))
    found = check(machine(tmp_path, tracker=rows, profile=profile(tmp_path, calibration_run=10)), "Calibration run")
    assert found.level == doctor.OK
    assert "3 of 10" in found.detail


def test_calibration_run_done(tmp_path):
    rows = tracker(*[(Status.SUBMITTED, "")] * 3)
    found = check(machine(tmp_path, tracker=rows, profile=profile(tmp_path, calibration_run=2)), "Calibration run")
    assert "done" in found.detail


def test_calibration_run_unknown_when_the_tracker_does_not_read(tmp_path):
    found = check(machine(tmp_path, tracker=UnreadableRows, profile=profile(tmp_path, calibration_run=10)),
                  "Calibration run")
    assert found.level == doctor.WARN


def test_records_that_can_be_pushed_are_ok_and_nothing_is_pushed(tmp_path):
    remote, clone = records(tmp_path)
    git("-C", str(clone), "commit", "-q", "--allow-empty", "-m", "held: Acme, Intern")  # a Record waiting
    before = git("-C", remote, "rev-parse", "main")
    found = check(machine(tmp_path, records=(remote, clone)), "Records")
    assert found.level == doctor.OK
    assert git("-C", remote, "rev-parse", "main") == before


def test_a_clone_behind_its_remote_can_still_push(tmp_path):
    remote, clone = records(tmp_path)
    other = tmp_path / "other"
    git("clone", "-q", remote, str(other))
    git("-C", str(other), "commit", "-q", "--allow-empty", "-m", "from another Mac")
    git("-C", str(other), "push", "-q", "origin", "HEAD:main")
    git("-C", str(clone), "commit", "-q", "--allow-empty", "-m", "held: Acme, Intern")
    found = check(machine(tmp_path, records=(remote, clone)), "Records")
    assert found.level == doctor.OK
    assert "behind" in found.detail


def test_records_whose_remote_is_gone_fail_with_where_to_look(tmp_path):
    remote, clone = records(tmp_path)
    git("-C", str(clone), "remote", "set-url", "origin", str(tmp_path / "gone.git"))
    found = check(machine(tmp_path, records=(remote, clone)), "Records")
    assert found.level == doctor.FAIL
    assert "docs/records-setup.md" in found.fix


def test_no_clone_yet_checks_the_remote_is_readable_and_warns(tmp_path):
    remote, _ = records(tmp_path)
    found = check(machine(tmp_path, records=(remote, tmp_path / "no-clone")), "Records")
    assert found.level == doctor.WARN
    assert "first Record" in found.detail


def test_no_clone_and_no_remote_fails(tmp_path):
    found = check(machine(tmp_path, records=(str(tmp_path / "gone.git"), tmp_path / "no-clone")), "Records")
    assert found.level == doctor.FAIL


def test_a_clone_with_no_record_yet_warns_pushing_is_unchecked(tmp_path):
    found = check(machine(tmp_path, records=records(tmp_path, commit=False)), "Records")
    assert found.level == doctor.WARN
    assert "no Record yet" in found.detail


def test_a_profile_with_every_required_fact_is_ok(tmp_path):
    assert check(machine(tmp_path), "Applicant profile").level == doctor.OK


def test_blank_required_facts_fail_naming_each(tmp_path):
    facts = filled(tmp_path)
    facts["identity"]["phone"] = None
    facts["education"]["school"] = ""
    found = check(machine(tmp_path, profile=profile(tmp_path, facts)), "Applicant profile")
    assert found.level == doctor.FAIL
    assert "identity.phone" in found.detail and "education.school" in found.detail
    assert "identity.email" not in found.detail


def test_a_no_is_a_fact_not_a_blank(tmp_path):
    facts = filled(tmp_path)
    facts["work_authorization"]["authorized_to_work_us"] = False
    assert check(machine(tmp_path, profile=profile(tmp_path, facts)), "Applicant profile").level == doctor.OK


def test_a_resume_that_isnt_there_fails(tmp_path):
    facts = filled(tmp_path)
    facts["files"]["resume_pdf"] = "missing.pdf"
    found = check(machine(tmp_path, profile=profile(tmp_path, facts)), "Applicant profile")
    assert found.level == doctor.FAIL
    assert "missing.pdf" in found.detail


def text_pdf(path, text):
    """A one-page PDF whose page reads `text`."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
               b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    path.write_bytes(out)


def test_the_not_on_resume_gate_is_on_when_the_resume_pdf_reads(tmp_path):
    m = machine(tmp_path)
    text_pdf(tmp_path / "resume.pdf", "Built a line following robot for the state contest")
    found = check(m, "Not-on-resume gate")
    assert found.level == doctor.OK
    assert "9 words" in found.detail


def test_the_not_on_resume_gate_is_off_when_the_resume_pdf_has_no_text(tmp_path):
    found = check(machine(tmp_path), "Not-on-resume gate")  # resume.pdf is a bare PDF header
    assert found.level == doctor.WARN
    assert found.detail.startswith("off:")
    assert "resume.pdf" in found.detail


def test_the_not_on_resume_gate_is_off_with_no_resume_pdf(tmp_path):
    facts = filled(tmp_path)
    del facts["files"]
    found = check(machine(tmp_path, profile=profile(tmp_path, facts)), "Not-on-resume gate")
    assert found.level == doctor.WARN
    assert found.detail.startswith("off:")


def test_usage_is_read_only_when_asked(tmp_path):
    m = machine(tmp_path)
    assert "used" not in check(m, "claude").detail
    reading = UsageReading(five_hour=0.4, weekly=0.12)
    found = check(replace(m, usage=ScriptedUsage(lambda: reading)), "claude")
    assert found.level == doctor.OK
    assert "40% of the 5-hour window" in found.detail and "12% of the week" in found.detail


def test_usage_at_its_limit_warns_until_when(tmp_path):
    reading = UsageReading(five_hour=1.0, limited=True, resets_at=datetime(2026, 10, 16, 18, 0))
    found = check(machine(tmp_path, usage=ScriptedUsage(lambda: reading)), "claude")
    assert found.level == doctor.WARN
    assert "18:00" in found.detail


class UnreadableRows(InMemoryTracker):
    """A Tracker file whose rows don't read."""

    def rows(self):
        raise ValueError("'' is not a valid Status")


def test_a_tracker_that_doesnt_read_fails_saying_a_run_would_stop_too(tmp_path):
    found = check(machine(tmp_path, tracker=UnreadableRows), "Tracker")
    assert found.level == doctor.FAIL
    assert found.detail.startswith("its rows don't read")
    assert "not a valid Status" in found.detail
    assert "a run" in found.fix


def test_a_profile_signed_in_only_on_googles_web_pages_warns_it_cant_be_confirmed(tmp_path):
    profiles = worker(tmp_path / "profiles", "worker-1", web="test.person@example.com")
    [found] = checks_named(machine(tmp_path, profiles=profiles), "worker-")
    assert found.level == doctor.WARN
    assert "test.person@example.com" in found.detail


def test_with_no_profile_every_check_still_runs_and_the_profile_says_how_to_make_one(tmp_path):
    from apply import cli
    missing = tmp_path / "data" / "applicant-profile.yaml"
    m = replace(machine(tmp_path), profile=cli.live_machine(missing).profile)
    out = io.StringIO()
    code = doctor.run(m, out)
    lines = out.getvalue().splitlines()
    assert code == 1
    assert "ok    Chrome: 141.0.7390.55" in lines
    profile_line = next(line for line in lines if line.startswith("fail  Applicant profile:"))
    assert str(missing) in profile_line and "applicant-profile.template.yaml" in profile_line
    assert "uv run apply rehearse <url>" in profile_line and "Test Person sample data" in profile_line
    assert not any("Traceback" in line or "Error" in line for line in lines)


def test_no_engine_bundle_fails_with_how_to_get_it(tmp_path):
    found = check(machine(tmp_path, engine=tmp_path / "fill-engine" / "dist" / "engine.js"), "Fill engine")
    assert found.level == doctor.FAIL
    assert "git submodule update --init" in found.fix


def test_the_engine_bundle_there_is_ok(tmp_path):
    bundle = tmp_path / "engine.js"
    bundle.write_text("//")
    assert check(machine(tmp_path, engine=bundle), "Fill engine").level == doctor.OK


def test_no_chromium_for_the_tests_warns_with_how_to_install_it(tmp_path):
    found = check(machine(tmp_path, playwright=tmp_path / "ms-playwright"), "Chromium for tests")
    assert found.level == doctor.WARN
    assert "playwright install chromium" in found.fix and "apply-agent/" in found.fix


def test_chromium_for_the_tests_installed_is_ok(tmp_path):
    assert check(machine(tmp_path), "Chromium for tests").level == doctor.OK


def test_no_records_remote_set_says_records_are_off_and_how_to_turn_them_on(tmp_path):
    found = check(machine(tmp_path, records=None), "Records")
    assert found.level == doctor.WARN
    assert "off" in found.detail and "records_remote" in found.fix


def test_a_new_data_folder_has_an_empty_tracker(tmp_path):
    from apply.tracker import FileTracker

    found = check(machine(tmp_path, tracker=lambda: FileTracker(tmp_path / "tracker.json")), "Tracker")
    assert found == doctor.Check("Tracker", doctor.OK, "0 Applications")


def test_the_apply_accounts_host_installed_for_the_workit_extension_is_ok(tmp_path):
    assert check(machine(tmp_path), "Apply accounts host").level == doctor.OK


def test_no_apply_accounts_host_only_warns_with_how_to_install_it(tmp_path):
    found = check(machine(tmp_path, native_hosts=tmp_path / "none"), "Apply accounts host")

    assert found.level == doctor.WARN and "apply chrome-passwords" in found.fix


def test_an_apply_accounts_host_whose_wrapper_is_gone_warns(tmp_path):
    m = machine(tmp_path)
    wrapper = Path(json.loads((m.native_hosts / "com.workit.apply_accounts.json").read_text())["path"])
    wrapper.unlink()

    assert check(m, "Apply accounts host").level == doctor.WARN


def plain_seed(profiles: Path, installed=True, developer=True) -> Path:
    """A plain seed profile, its Preferences as Chrome writes them after Load unpacked of the worker extension."""
    from apply.plain.extension import EXTENSION_ID

    folder = profiles / "worker-extension"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "manifest.json").write_text("{}")
    prefs = {"extensions": {"ui": {"developer_mode": developer},
                            "settings": {EXTENSION_ID: {"path": str(folder)}} if installed else {}}}
    (profiles / "plain-seed" / "Default").mkdir(parents=True)
    (profiles / "plain-seed" / "Default" / "Preferences").write_text(json.dumps(prefs))
    return profiles


def test_plain_worker_mode_checks_the_plain_seed_and_its_extension_not_the_cdp_worker_profiles(tmp_path):
    plain = profile(tmp_path, worker_mode="plain", plain_chrome="chrome")
    m = machine(tmp_path, profile=plain, profiles=plain_seed(tmp_path / "profiles"))

    found = {c.name: c for c in doctor.diagnose(m)}

    assert "Worker profiles" not in found and not checks_named(m, "worker-")
    assert found["Plain seed"].level == doctor.OK and "worker extension is installed" in found["Plain seed"].detail
    assert doctor.run(m, io.StringIO()) == 0


def test_a_plain_seed_without_the_worker_extension_fails_with_how_to_seed_it(tmp_path):
    plain = profile(tmp_path, worker_mode="plain", plain_chrome="chrome")

    (tmp_path / "other").mkdir()
    missing = check(machine(tmp_path, profile=plain, profiles=tmp_path / "none"), "Plain seed")
    bare = check(machine(tmp_path / "other", profile=plain, profiles=plain_seed(tmp_path / "p", installed=False)),
                 "Plain seed")

    assert missing.level == bare.level == doctor.FAIL and "apply plain seed" in missing.fix
    assert "isn't installed" in bare.detail


def test_protected_worker_mode_checks_both_kinds_of_worker(tmp_path):
    m = machine(tmp_path, profile=profile(tmp_path, worker_mode="protected", plain_chrome="chrome"))
    assert checks_named(m, "worker-") and checks_named(m, "Plain seed")
