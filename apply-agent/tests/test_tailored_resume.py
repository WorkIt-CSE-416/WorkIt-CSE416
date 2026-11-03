"""The student's tailored resume for a Posting (KAN-547), against a fake WorkIt
(fake_workit.py, fake_tracker.py): with one, the Application's resume is the
tailored PDF under the profile's resume name; without one, or with no
WorkIt, it is the profile's resume as before. The rehearsal that sends it
and keeps it as the Sent resume is in test_rehearse.py (-k tailored_resume)."""

from pathlib import Path

import pytest
from fake_tracker import FakeTracker
from fake_workit import FakeWorkIt
from test_run_answers import profile_with

from apply import tailored, workit
from apply.model import Posting
from apply.profile import ApplicantProfile

URL = "https://job-boards.greenhouse.io/acme/jobs/4012345"
TAILORED_PDF = b"%PDF-1.7 the resume tailored to Acme"


@pytest.fixture
def fake():
    with FakeWorkIt() as fake:
        fake.tracker = FakeTracker(fake)
        yield fake


def logged_in(fake: FakeWorkIt, tmp_path: Path) -> workit.WorkIt:
    client = workit.WorkIt(fake.site, tmp_path / "workit-login.json")
    workit.login(client, lambda url, accept: accept(fake.cookies(fake.session())))
    return client


def posting(url: str = URL) -> Posting:
    return Posting(id="greenhouse-4012345", company="Acme", title="Intern", url=url)


def resume_of(tmp_path: Path, client: workit.WorkIt, url: str = URL) -> tuple[Path, ApplicantProfile]:
    profile = ApplicantProfile.load(profile_with(tmp_path))
    given = tailored.resume_for(posting(url), profile, tailored.from_workit(client), tmp_path / "tailored")
    return Path(given.get("files.resume_pdf")), profile


def test_a_posting_with_a_tailored_resume_gets_it_under_the_profiles_resume_name(fake, tmp_path):
    fake.tracker.tailored(fake.tracker.listed(URL, "Acme", "Intern"), TAILORED_PDF)

    resume, profile = resume_of(tmp_path, logged_in(fake, tmp_path))

    assert resume.read_bytes() == TAILORED_PDF
    assert resume.name == Path(profile.get("files.resume_pdf")).name
    assert Path(profile.get("files.resume_pdf")).read_bytes() != TAILORED_PDF  # the profile is unchanged


def test_a_posting_with_no_tailored_resume_gets_the_profiles_resume(fake, tmp_path):
    fake.tracker.tailored(fake.tracker.listed(URL, "Acme", "Intern"), TAILORED_PDF)
    fake.tracker.listed("https://jobs.lever.co/other/1", "Other", "Intern")

    resume, profile = resume_of(tmp_path, logged_in(fake, tmp_path), "https://jobs.lever.co/other/1")

    assert resume == profile.get("files.resume_pdf")


def test_a_job_workit_does_not_list_gets_the_profiles_resume(fake, tmp_path):
    resume, profile = resume_of(tmp_path, logged_in(fake, tmp_path))

    assert resume == profile.get("files.resume_pdf")


def test_with_no_login_the_profiles_resume_and_no_call(fake, tmp_path):
    fake.tracker.tailored(fake.tracker.listed(URL, "Acme", "Intern"), TAILORED_PDF)

    resume, profile = resume_of(tmp_path, workit.WorkIt(fake.site, tmp_path / "workit-login.json"))

    assert resume == profile.get("files.resume_pdf")
    assert fake.requests == []


def test_with_workit_down_the_profiles_resume_and_a_line_says_so(fake, tmp_path, capsys):
    client = logged_in(fake, tmp_path)
    fake.stop()

    resume, profile = resume_of(tmp_path, client)

    assert resume == profile.get("files.resume_pdf")
    assert "Acme: your tailored resume could not be read from WorkIt" in capsys.readouterr().err


def test_writes_through_the_tailored_view_reach_the_profile(fake, tmp_path):
    fake.tracker.tailored(fake.tracker.listed(URL, "Acme", "Intern"), TAILORED_PDF)
    profile = ApplicantProfile.load(profile_with(tmp_path))
    given = tailored.resume_for(posting(), profile, tailored.from_workit(logged_in(fake, tmp_path)),
                                tmp_path / "tailored")

    given.set_answered("Are you 18 or older?", "Yes")

    assert profile.answered("Are you 18 or older?") == "Yes"
