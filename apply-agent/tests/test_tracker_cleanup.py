"""`apply clean-tracker` (KAN-546): delete the saved and queued applications on WorkIt's Applications Tracker
of jobs the student did not apply to, against a fake WorkIt (fake_workit.py, fake_tracker.py)."""

import io

import pytest
from fake_tracker import FakeTracker
from fake_workit import FakeWorkIt

from apply import tracker_cleanup, workit
from apply.model import Status
from apply.tracker import FileTracker, Row
from apply.workit import WorkIt

# The Tracker Sheet: Iris was submitted with Apply (not imported yet), Gale was not.
CELLS = [
    ["Application ID", "Company", "Role", "Posting", "Status", "Date applied", "Outcome"],
    ["request-1", "Iris", "Infra Intern", "https://job-boards.greenhouse.io/embed/job_app?for=iris&token=9000009",
     "submitted", "2026-11-02", ""],
    ["request-2", "Gale", "Robotics Intern", "https://boards.greenhouse.io/gale/jobs/7000007", "missing fact", "", ""],
]

DRY_RUN = """\
Dry run: nothing is deleted yet. 12 applications on your Applications Tracker.

Delete (3): saved or queued, and you did not apply:
  Gale | Robotics Intern | saved | https://boards.greenhouse.io/gale/jobs/7000007
  Kite | Mobile Intern | queued | https://jobs.lever.co/kite/1
  Lumen | Data Intern | saved | https://jobs.ashbyhq.com/lumen/2

Keep (9):
  Acme | Intern | applied
  Bolt | Intern | interviewing
  Cobalt | Intern | offer
  Dynamo | Intern | rejected
  Ember | Intern | needs_you: only saved and queued applications are deleted
  Flux | Intern | skipped: only saved and queued applications are deleted
  Acme | Intern | saved: you applied to this job (Acme | Intern, at applied)
  Iris | Infra Intern | saved: you applied to this job (Tracker Sheet row 2). Run `uv run apply import-sheet` first
  Jade | Intern | queued: you asked to keep it
"""


@pytest.fixture
def workit_tracker(tmp_path):
    """A signed-in student with an application at each stage. One saved Acme posting is the same job as the
    applied one, on the other Greenhouse host."""
    with FakeWorkIt() as fake:
        tracker = FakeTracker(fake)
        for company, url, stage in [
            ("Acme", "https://boards.greenhouse.io/acme/jobs/8000001", "applied"),
            ("Bolt", "https://bolt.eightfold.ai/careers/job/1", "interviewing"),
            ("Cobalt", "https://jobs.ashbyhq.com/cobalt/1", "offer"),
            ("Dynamo", "https://jobs.lever.co/dynamo/1", "rejected"),
            ("Ember", "https://ember.wd5.myworkdayjobs.com/x/job/1", "needs_you"),
            ("Flux", "https://careers.flux.com/job/1", "skipped"),
            ("Acme", "https://job-boards.greenhouse.io/acme/jobs/8000001?gh_src=x", "saved"),
            ("Iris", "https://boards.greenhouse.io/iris/jobs/9000009", "saved"),
            ("Jade", "https://jobs.lever.co/jade/1", "queued"),
        ]:
            tracker.applied_before(tracker.listed(url, company, "Intern"), stage)
        tracker.postings[tracker.find("https://boards.greenhouse.io/iris/jobs/9000009").id].title = "Infra Intern"
        for company, title, url, stage in [
            ("Gale", "Robotics Intern", "https://boards.greenhouse.io/gale/jobs/7000007", "saved"),
            ("Kite", "Mobile Intern", "https://jobs.lever.co/kite/1", "queued"),
            ("Lumen", "Data Intern", "https://jobs.ashbyhq.com/lumen/2", "saved"),
        ]:
            tracker.applied_before(tracker.listed(url, company, title), stage)
        client = WorkIt(fake.site, tmp_path / "workit-login.json")
        workit.login(client, lambda url, accept: accept(fake.cookies(fake.session())))
        fake.requests.clear()
        yield fake, tracker, client


def run(client, answer="yes", dry_run=False, cells=CELLS):
    out = io.StringIO()
    jade = "https://jobs.lever.co/jade/1"
    status = tracker_cleanup.run(client, cells, keep=[jade], approve=lambda prompt: answer, out=out, dry_run=dry_run)
    return status, out.getvalue()


def stages(tracker):
    return sorted((tracker.postings[job].company, a.stage) for job, a in tracker.applications.items())


BEFORE = [("Acme", "applied"), ("Acme", "saved"), ("Bolt", "interviewing"), ("Cobalt", "offer"),
          ("Dynamo", "rejected"), ("Ember", "needs_you"), ("Flux", "skipped"), ("Gale", "saved"),
          ("Iris", "saved"), ("Jade", "queued"), ("Kite", "queued"), ("Lumen", "saved")]


def test_the_dry_run_lists_only_saved_and_queued_applications_not_applied_and_writes_nothing(workit_tracker):
    fake, tracker, client = workit_tracker
    status, out = run(client, dry_run=True)

    assert status == 0
    assert out == DRY_RUN
    assert [seen for seen in fake.requests if seen.method != "GET"] == []
    assert stages(tracker) == BEFORE


def test_no_approval_deletes_nothing(workit_tracker):
    _, tracker, client = workit_tracker
    status, out = run(client, answer="no")

    assert status == 0
    assert out.endswith("Nothing deleted.\n")
    assert stages(tracker) == BEFORE


def test_after_approval_it_deletes_them_and_the_applied_applications_stay(workit_tracker):
    _, tracker, client = workit_tracker
    status, out = run(client)

    assert status == 0
    assert stages(tracker) == [s for s in BEFORE if s not in {("Gale", "saved"), ("Kite", "queued"),
                                                                 ("Lumen", "saved")}]
    assert out.endswith(
        "  Gale | Robotics Intern: deleted\n"
        "  Kite | Mobile Intern: deleted\n"
        "  Lumen | Data Intern: deleted\n"
        "Done: 3 deleted, 0 failed.\n"
        "Applied applications: 4 before, 4 after. None is lost.\n")


def test_a_second_run_deletes_nothing(workit_tracker):
    fake, _, client = workit_tracker
    run(client)
    fake.requests.clear()

    status, out = run(client)
    assert status == 0
    assert "Delete (0)" in out
    assert out.endswith("Nothing to delete.\n")
    assert [seen for seen in fake.requests if seen.method != "GET"] == []


def test_without_the_sheet_only_workit_says_what_is_applied(workit_tracker):
    _, _, client = workit_tracker
    _, out = run(client, dry_run=True, cells=None)

    assert "  Iris | Infra Intern | saved | https://boards.greenhouse.io/iris/jobs/9000009\n" in out
    assert "Delete (4)" in out


def test_an_application_applied_between_the_dry_run_and_the_delete_stays(workit_tracker):
    fake, tracker, client = workit_tracker
    kite = tracker.find("https://jobs.lever.co/kite/1").id
    me = fake.account["id"]
    delete = fake._routes[("DELETE", f"/applicants/{me}/applications/{kite}")]

    def applied_meanwhile(seen, fake):
        tracker.applications[kite].stage = "applied"  # the extension, meanwhile
        return delete(seen, fake)

    fake.route("DELETE", f"/applicants/{me}/applications/{kite}", applied_meanwhile)
    status, out = run(client)

    assert status == 1
    assert tracker.applications[kite].stage == "applied"
    assert ("  Kite | Mobile Intern: FAILED: DELETE /applicants/" in out
            and "409 That application is applied, so it is no longer in the queue." in out)
    assert "Done: 2 deleted, 1 failed." in out
    assert out.endswith("Applied applications: 4 before, 5 after. None is lost.\n")


def test_it_says_so_when_an_applied_application_is_gone_after_the_deletes(workit_tracker):
    fake, tracker, client = workit_tracker
    gale = tracker.find("https://boards.greenhouse.io/gale/jobs/7000007").id
    acme = tracker.find("https://boards.greenhouse.io/acme/jobs/8000001").id
    delete = fake._routes[("DELETE", f"/jobs/{gale}/saved")]

    def loses_acme(seen, fake):
        del tracker.applications[acme]  # something else, meanwhile
        return delete(seen, fake)

    fake.route("DELETE", f"/jobs/{gale}/saved", loses_acme)
    status, out = run(client)

    assert status == 1
    assert out.endswith("Applied applications: 4 before, 3 after. NOT FOUND after the deletes:\n"
                        "  Acme | Intern | applied | https://boards.greenhouse.io/acme/jobs/8000001\n")


def test_workit_refuses_to_delete_an_applied_application(workit_tracker):
    """The routes the cleanup uses refuse an application past saved or queued, as WorkIt's do."""
    _, tracker, client = workit_tracker
    acme = tracker.find("https://boards.greenhouse.io/acme/jobs/8000001").id
    me = client.me().id
    for remove in (lambda: client.unsave(acme), lambda: client.dequeue(me, acme)):
        with pytest.raises(workit.WorkItError) as refused:
            remove()
        assert refused.value.status == 409
    assert tracker.applications[acme].stage == "applied"


def test_it_keeps_a_job_apply_is_holding_or_waits_on_you_for(workit_tracker, tmp_path):
    """Apply writes a Hold and a Missing fact as needs_you (KAN-544). Its write may still wait while WorkIt has the
    job at saved or queued: a cleanup must not delete them."""
    _, tracker, client = workit_tracker
    apply_tracker = FileTracker(tmp_path / "tracker.json")
    for number, (company, url, status) in enumerate([
        ("Kite", "https://jobs.lever.co/kite/1", Status.HELD),
        ("Lumen", "https://jobs.ashbyhq.com/lumen/2?utm_source=x", Status.MISSING_FACT),
        ("Gale", "https://boards.greenhouse.io/gale/jobs/7000007", Status.FAILED),
    ]):
        apply_tracker.add(Row(f"run-{number}", company, "Intern", url, "greenhouse", status))
    out = io.StringIO()
    status = tracker_cleanup.run(client, CELLS, keep=[], apply_rows=apply_tracker.rows(),
                                 approve=lambda prompt: "yes", out=out)

    assert status == 0
    text = out.getvalue()
    assert "  Kite | Mobile Intern | queued: Apply is waiting for you on it (held)\n" in text
    assert "  Lumen | Data Intern | saved: Apply is waiting for you on it (missing fact)\n" in text
    assert "Done: 2 deleted, 0 failed." in text  # Gale (failed in Apply) and Jade (no --keep here)
    assert ("Kite", "queued") in stages(tracker) and ("Lumen", "saved") in stages(tracker)
    assert ("Gale", "saved") not in stages(tracker)
