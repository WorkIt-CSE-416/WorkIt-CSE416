"""The student's tailored resume for a Posting (KAN-547).

A student can tailor a resume to a job posting on WorkIt (Tailor, KAN-217,
`docs/tailor_resume.md`). When the Posting has one, Apply gives the form
that resume in place of the profile's resume, and so keeps that same file
as the application's Sent resume (the Worker copies each file a form is
given to SENT; the write to the Applications Tracker sends that copy).

The tailored PDF is written to TAILORED/<application>/ under the profile's
resume file name, so the employer gets the name it always gets, and
`worker.sent_resume` finds it by that name. The profile itself never
changes: the Application gets a view of it (`_WithResume`) whose resume is
the tailored file; every other read and every write goes to the profile.

No WorkIt login, WorkIt down, a job WorkIt does not list, or no tailored
resume for it: the profile's resume, as before."""

import re
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from apply import workit
from apply.home import HOME
from apply.model import Posting
from apply.profile import ApplicantProfile

TAILORED = HOME / "tailored"
RESUME = "files.resume_pdf"

# The PDF of the tailored resume for a Posting, or None.
Tailored = Callable[[Posting], bytes | None]


def from_workit(client: workit.WorkIt | None = None) -> Tailored:
    """The student's tailored resumes on WorkIt. A failed read is said on stderr and gives None, so the
    Application goes on with the profile's resume."""
    client = client or workit.WorkIt()

    def tailored(posting: Posting) -> bytes | None:
        if not client.logged_in():
            return None
        try:
            pdf = client.tailored_resume(posting.url)
        except workit.WorkItError as error:
            print(f"{posting.company}: your tailored resume could not be read from WorkIt ({error}); "
                  "the profile's resume is used", file=sys.stderr)
            return None
        if pdf is not None and not pdf.startswith(b"%PDF"):
            return None
        return pdf
    return tailored


def resume_for(posting: Posting, profile: ApplicantProfile, tailored: Tailored, folder: Path | None = None
               ) -> ApplicantProfile:
    """`profile`, or, when the Posting has a tailored resume and the profile names a resume, the profile with
    the tailored resume in its place."""
    resume = profile.get(RESUME)
    if not resume:
        return profile
    pdf = tailored(posting)
    if pdf is None:
        return profile
    path = (folder or TAILORED) / re.sub(r"[^A-Za-z0-9_-]+", "-", posting.id) / Path(resume).name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pdf)
    return _WithResume(profile, path)  # type: ignore[return-value]


class _WithResume:
    """The profile, with `path` as its resume. Every other read and every write is the profile's own."""

    def __init__(self, profile: ApplicantProfile, path: Path):
        self._profile, self._path = profile, path

    def get(self, key: str) -> Any:
        return self._path if key == RESUME else self._profile.get(key)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._profile, name)
