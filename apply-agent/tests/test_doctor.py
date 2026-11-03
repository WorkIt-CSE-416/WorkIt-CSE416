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

from fakes import FakeMailbox, ScriptedUsage

from apply import doctor
from apply.adapters import UsageReading
from apply.model import Status
from apply.orchestrator import SUBMITTING
from apply.profile import ApplicantProfile
from apply.tracker import InMemoryTracker, Row


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


def machine(tmp_path, **overrides) -> doctor.Machine:
    """A machine where every check passes, but for `overrides`."""
    return replace(doctor.Machine(profile=profile(tmp_path), chrome=chrome(tmp_path), claude=claude_status(),
                                   profiles=signed_in(tmp_path, "every-check-passes"),
                                   mailbox=lambda address: FakeMailbox(), tracker=InMemoryTracker,
                                   records=records(tmp_path / "every-check-passes"),
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


def test_gmail_set_up_is_ok(tmp_path):
    asked = []
    found = check(machine(tmp_path, mailbox=lambda address: asked.append(address) or FakeMailbox()), "Gmail")
    assert found.level == doctor.OK
    assert asked == ["test.person@example.com"]  # the Applicant profile's email


def test_gmail_without_an_app_password_fails_saying_how_to_set_it_up(tmp_path):
    found = check(machine(tmp_path, mailbox=lambda address: FakeMailbox(set_up=False)), "Gmail")
    assert found.level == doctor.FAIL
    assert "app password" in found.detail


def test_gmail_with_no_email_in_the_profile_fails(tmp_path):
    found = check(machine(tmp_path, profile=profile(tmp_path, facts={})), "Gmail")
    assert found.level == doctor.FAIL
    assert "identity.email" in found.fix


def tracker(*rows: tuple[Status, str]):
    """A Tracker holding a row of each (Status, Reason)."""
    sheet = InMemoryTracker()
    for n, (status, reason) in enumerate(rows):
        sheet.add(Row(f"app-{n}", "Acme", "Intern", f"https://jobs.example/{n}", "greenhouse", status, reason=reason))
    return lambda: sheet


def no_sheet():
    raise FileNotFoundError("~/.config/apply/sheet-id")


def test_the_sheet_reachable_says_how_many_applications_it_holds(tmp_path):
    found = check(machine(tmp_path, tracker=tracker((Status.HELD, ""), (Status.HANDOFF, ""))), "Tracker Sheet")
    assert found == doctor.Check("Tracker Sheet", doctor.OK, "reachable; 2 Applications")


def test_no_sheet_set_up_fails_with_how_to_set_it_up(tmp_path):
    found = check(machine(tmp_path, tracker=no_sheet), "Tracker Sheet")
    assert found.level == doctor.FAIL
    assert "docs/tracker-setup.md" in found.fix


def test_calibration_run_counts_held_and_submitted_applications(tmp_path):
    rows = tracker((Status.HELD, ""), (Status.SUBMITTED, ""), (Status.FILLING, SUBMITTING), (Status.HANDOFF, ""))
    found = check(machine(tmp_path, tracker=rows, profile=profile(tmp_path, calibration_run=10)), "Calibration run")
    assert found.level == doctor.OK
    assert "3 of 10" in found.detail


def test_calibration_run_done(tmp_path):
    rows = tracker(*[(Status.SUBMITTED, "")] * 3)
    found = check(machine(tmp_path, tracker=rows, profile=profile(tmp_path, calibration_run=2)), "Calibration run")
    assert "done" in found.detail


def test_calibration_run_unknown_without_the_sheet(tmp_path):
    found = check(machine(tmp_path, tracker=no_sheet, profile=profile(tmp_path, calibration_run=10)), "Calibration run")
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
    """A Sheet that opens, but whose Applications tab doesn't read as rows."""

    def rows(self):
        raise ValueError("'' is not a valid Status")


def test_a_sheet_that_opens_but_doesnt_read_fails_saying_a_run_would_stop_too(tmp_path):
    found = check(machine(tmp_path, tracker=UnreadableRows), "Tracker Sheet")
    assert found.level == doctor.FAIL
    assert found.detail.startswith("reachable, but its rows don't read")
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


def test_no_tracker_sheet_set_says_it_is_off_with_how_to_set_it_up(tmp_path, monkeypatch):
    from apply import sheet
    monkeypatch.setattr(sheet, "SHEET_ID", tmp_path / "sheet-id")
    checks = {c.name: c for c in doctor.diagnose(machine(tmp_path, tracker=sheet.live_tracker))}
    assert checks["Tracker Sheet"].level == doctor.WARN
    assert "off" in checks["Tracker Sheet"].detail and "docs/tracker-setup.md" in checks["Tracker Sheet"].fix
    assert checks["Calibration run"].level == doctor.WARN
