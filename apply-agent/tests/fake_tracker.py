"""WorkIt's Applications Tracker on a FakeWorkIt (fake_workit.py): job postings found by
link, the student's applications on them, and their Sent resumes, held in memory.

    with FakeWorkIt() as fake:
        tracker = FakeTracker(fake)
        tracker.listed("https://boards.greenhouse.io/acme/jobs/1", "Acme", "Intern")
        tracker.applied_before(job_id, "interviewing")   # an application made in WorkIt itself

It answers as WorkIt's routes do (backend/app/routers/applications.py, tracker.py,
auto_apply.py): a link matches a posting by the same Greenhouse job ID, else by the link
without scheme, www., query, fragment and trailing slash. Only the student's own
applications are kept; there is one student, the fake's account.
"""

import base64
import itertools
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlsplit

from fake_workit import FakeWorkIt, Reply, Seen

APPLIED = ("applied", "interviewing", "offer", "rejected")


@dataclass
class Posting:
    id: str
    url: str
    company: str
    title: str
    status: str  # "published" or "unlisted"


@dataclass
class Application:
    stage: str
    applied_at: str | None = None  # an ISO instant, as the API answers it
    sent_resume_id: str | None = None


@dataclass
class SentResume:
    id: str
    job_id: str
    file_name: str
    content: bytes


@dataclass
class FakeTracker:
    fake: FakeWorkIt
    postings: dict[str, Posting] = field(default_factory=dict)
    applications: dict[str, Application] = field(default_factory=dict)  # by job id
    sent: dict[str, SentResume] = field(default_factory=dict)

    def __post_init__(self):
        self._ids = itertools.count(1)
        me = self.fake.account["id"]
        for method, path, handler in [
            ("POST", "/jobs/listed-by-link", self._listed_by_link),
            ("POST", "/jobs/added-by-link", self._added_by_link),
            ("GET", f"/applicants/{me}/applications", self._list),
            ("POST", f"/applicants/{me}/sent-resumes/file", self._send_resume),
        ]:
            self.fake.route(method, path, self._signed_in(handler))

    def listed(self, url: str, company: str, title: str) -> str:
        """A job WorkIt lists: its id."""
        job_id = f"00000000-0000-4000-9000-{next(self._ids):012d}"
        self.postings[job_id] = Posting(job_id, url, company, title, "published")
        self._job_routes(job_id)
        return job_id

    def applied_before(self, job_id: str, stage: str, applied_at: str | None = "2026-09-01T15:00:00+00:00") -> None:
        """The student's application on a job, made in WorkIt itself (the extension, auto apply, Save)."""
        self.applications[job_id] = Application(stage, applied_at if stage in APPLIED else None)

    def find(self, url: str) -> Posting | None:
        return next((p for p in self.postings.values() if _same(p.url, url)), None)

    # --- routes

    def _signed_in(self, handler):
        return lambda seen, fake: handler(seen) if fake.signed_in(seen) else Reply(401, {"detail": "Not authenticated"})

    def _listed_by_link(self, seen: Seen) -> Reply:
        posting = self.find(seen.body["url"])
        if posting is None or posting.status != "published":
            return Reply(404, {"detail": "WorkIt doesn't list this job yet."})
        application = self.applications.get(posting.id)
        return Reply(200, {"job_id": posting.id, "stage": application and application.stage})

    def _added_by_link(self, seen: Seen) -> Reply:
        body = seen.body
        posting = self.find(body["url"])
        if posting is None:
            job_id = f"00000000-0000-4000-a000-{next(self._ids):012d}"
            posting = self.postings[job_id] = Posting(job_id, body["url"], body["company"], body["title"], "unlisted")
            self._job_routes(job_id)
        application = self.applications.setdefault(posting.id, Application("saved"))
        return Reply(200, {"job_id": posting.id, "status": posting.status, "stage": application.stage})

    def _list(self, seen: Seen) -> Reply:
        return Reply(200, [{
            "job": {"id": job_id, "title": self.postings[job_id].title, "company": self.postings[job_id].company,
                    "apply_url": self.postings[job_id].url},
            "stage": a.stage, "applied_at": a.applied_at,
            "sent_resume": {"id": a.sent_resume_id} if a.sent_resume_id else None,
            "open": self.postings[job_id].status == "published",
        } for job_id, a in self.applications.items()])

    def _send_resume(self, seen: Seen) -> Reply:
        job_id = seen.body["job_posting_id"]
        if job_id not in self.applications:
            return Reply(404, {"detail": "No such job posting."})
        sent_id = f"00000000-0000-4000-b000-{next(self._ids):012d}"
        self.sent[sent_id] = SentResume(sent_id, job_id, seen.body["file_name"], base64.b64decode(seen.body["content"]))
        return Reply(201, {"id": sent_id, "job_posting_id": job_id, "file_name": seen.body["file_name"]})

    def _job_routes(self, job_id: str) -> None:
        me = self.fake.account["id"]
        self.fake.route("PUT", f"/applicants/{me}/applications/{job_id}/stage",
                        self._signed_in(lambda seen: self._stage(job_id, seen)))
        self.fake.route("POST", f"/jobs/{job_id}/applied", self._signed_in(lambda seen: self._applied(job_id, seen)))

    def _stage(self, job_id: str, seen: Seen) -> Reply:
        application = self.applications.get(job_id)
        if application is None:
            return Reply(404, {"detail": "You have no application for that job."})
        if seen.body["stage"] not in APPLIED:
            return Reply(422, {"detail": "stage"})
        application.stage = seen.body["stage"]
        if seen.body.get("applied_on"):
            application.applied_at = f"{seen.body['applied_on']}T12:00:00+00:00"
        application.applied_at = application.applied_at or "2026-11-02T20:00:00+00:00"
        return Reply(200, {"job_id": job_id, "stage": application.stage})

    def _applied(self, job_id: str, seen: Seen) -> Reply:
        application = self.applications.get(job_id)
        if application is None and self.postings[job_id].status != "published":
            return Reply(404, {"detail": "Not Found"})
        application = self.applications.setdefault(job_id, Application("saved"))
        sent_id = (seen.body or {}).get("sent_resume_id")
        if sent_id is not None and (sent_id not in self.sent or self.sent[sent_id].job_id != job_id):
            return Reply(404, {"detail": "That sent resume isn't yours or didn't go to this job."})
        if application.stage not in APPLIED:
            application.stage = "applied"
        application.applied_at = application.applied_at or "2026-11-02T20:00:00+00:00"
        if seen.body and "sent_resume_id" in seen.body:
            application.sent_resume_id = sent_id
        return Reply(200, {"applied_at": application.applied_at, "sent_resume_id": application.sent_resume_id})


def _same(a: str, b: str) -> bool:
    """WorkIt's link rule (backend/app/queries/applications.py): the same Greenhouse job ID, else the same bare
    link."""
    if _greenhouse(a) or _greenhouse(b):
        return _greenhouse(a) == _greenhouse(b)
    return _bare(a) == _bare(b)


def _bare(url: str) -> str:
    return re.sub(r"^[a-z][a-z0-9+.-]*://(www\.)?", "", url, flags=re.IGNORECASE).split("#")[0].split("?")[0].rstrip("/").lower()


def _greenhouse(url: str) -> str | None:
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    if (parts.hostname or "").endswith("greenhouse.io"):
        if m := re.match(r"/[\w-]+/jobs/(\d+)", parts.path):
            return m[1]
        if parts.path.startswith("/embed/job_app"):
            return query.get("token", [None])[0]
    return query.get("gh_jid", [None])[0]
