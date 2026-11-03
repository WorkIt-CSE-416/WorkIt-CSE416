"""WorkIt's Applications Tracker on a FakeWorkIt (fake_workit.py): job postings found by
link, the student's applications on them, and their Sent resumes, held in memory.

    with FakeWorkIt() as fake:
        tracker = FakeTracker(fake)
        tracker.listed("https://boards.greenhouse.io/acme/jobs/1", "Acme", "Intern")
        tracker.applied_before(job_id, "interviewing")   # an application made in WorkIt itself

It answers as WorkIt's routes do (backend/app/routers/applications.py, tracker.py,
auto_apply.py), with the two delete routes that refuse an application past saved or queued: a link matches a posting by the same Greenhouse job ID, else by the link
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
    added: bool = False  # a job WorkIt does not list, added by its link (added_by_student)


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
    tailored_resumes: dict[str, bytes] = field(default_factory=dict)  # the PDF of each tailored resume, by job id
    capped: bool = False  # WorkIt's daily cap of added jobs reached: a new added job is 429
    retry_after: str | None = None  # the 429's Retry-After header, when WorkIt sends one

    def __post_init__(self):
        self._ids = itertools.count(1)
        me = self.fake.account["id"]
        for method, path, handler in [
            ("POST", "/jobs/listed-by-link", self._listed_by_link),
            ("POST", "/jobs/added-by-link", self._added_by_link),
            ("GET", f"/applicants/{me}/applications", self._list),
            ("POST", f"/applicants/{me}/sent-resumes/file", self._send_resume),
            ("GET", f"/applicants/{me}/built-resumes", self._built_resumes),
        ]:
            self.fake.route(method, path, self._signed_in(handler))

    def listed(self, url: str, company: str, title: str) -> str:
        """A job WorkIt lists: its id."""
        job_id = f"00000000-0000-4000-9000-{next(self._ids):012d}"
        self.postings[job_id] = Posting(job_id, url, company, title)
        self._job_routes(job_id)
        return job_id

    def applied_before(self, job_id: str, stage: str, applied_at: str | None = "2026-09-01T15:00:00+00:00") -> None:
        """The student's application on a job, made in WorkIt itself (the extension, auto apply, Save)."""
        self.applications[job_id] = Application(stage, applied_at if stage in APPLIED else None)

    def tailored(self, job_id: str, pdf: bytes) -> None:
        """The student's tailored resume for the job (Tailor, KAN-217), which renders as `pdf`."""
        self.tailored_resumes[job_id] = pdf
        me = self.fake.account["id"]
        self.fake.route("GET", f"/applicants/{me}/built-resumes/tailored-{job_id}/render",
                        self._signed_in(lambda seen: Reply(200, {
                            "pdf": base64.b64encode(self.tailored_resumes[job_id]).decode(),
                            "file_name": f"{self.postings[job_id].company} - Intern.pdf", "page_count": 1})))

    def tracked(self) -> list[dict]:
        """The student's Applications Tracker as the page shows it: each job's link, company, stage and the
        Sent resume's file name."""
        return [{"link": self.postings[job].url, "company": self.postings[job].company, "stage": a.stage,
                 "sent_resume": self.sent[a.sent_resume_id].file_name if a.sent_resume_id else None}
                for job, a in self.applications.items()]

    def find(self, url: str) -> Posting | None:
        return next((p for p in self.postings.values() if _same(p.url, url)), None)

    # --- routes

    def _signed_in(self, handler):
        return lambda seen, fake: handler(seen) if fake.signed_in(seen) else Reply(401, {"detail": "Not authenticated"})

    def _listed_by_link(self, seen: Seen) -> Reply:
        posting = self.find(seen.body["url"])
        if posting is None or posting.added:
            return Reply(404, {"detail": "WorkIt doesn't list this job yet."})
        application = self.applications.get(posting.id)
        return Reply(200, {"job_id": posting.id, "stage": application and application.stage})

    def _added_by_link(self, seen: Seen) -> Reply:
        body = seen.body
        if body.get("track_only") is not True:  # Write with Claude's add, which Apply never makes
            return Reply(422, {"detail": "the fake serves Apply's adds only (track_only)"})
        posting = self.find(body["url"])
        if posting is None and self.capped:  # services/daily_caps.py, KAN-478
            return Reply(429, {"detail": "You added 50 jobs today. Try again tomorrow."},
                         {"Retry-After": self.retry_after} if self.retry_after else {})
        if posting is None:
            job_id = f"00000000-0000-4000-a000-{next(self._ids):012d}"
            posting = self.postings[job_id] = Posting(job_id, body["url"], body["company"], body["title"], added=True)
            self._job_routes(job_id)
        application = self.applications.setdefault(posting.id, Application("saved"))
        return Reply(200, {"job_id": posting.id, "stage": application.stage})

    def _list(self, seen: Seen) -> Reply:
        return Reply(200, [{
            "job": {"id": job_id, "title": self.postings[job_id].title, "company": self.postings[job_id].company,
                    "apply_url": self.postings[job_id].url},
            "stage": a.stage, "applied_at": a.applied_at,
            "sent_resume": {"id": a.sent_resume_id} if a.sent_resume_id else None,
            "open": True,  # the fake has no closed job; an added one is open
        } for job_id, a in self.applications.items()])

    def _send_resume(self, seen: Seen) -> Reply:
        job_id = seen.body["job_posting_id"]
        if job_id not in self.applications:
            return Reply(404, {"detail": "No such job posting."})
        content = base64.b64decode(seen.body["content"])
        if not content.startswith(b"%PDF"):
            return Reply(422, {"detail": "Only a PDF is kept as a sent file"})
        again = next((s for s in self.sent.values() if s.job_id == job_id and s.content == content), None)
        if again:  # the same file sent to the same job again: the same Sent resume
            return Reply(200, {"id": again.id, "job_posting_id": job_id, "file_name": again.file_name})
        sent_id = f"00000000-0000-4000-b000-{next(self._ids):012d}"
        self.sent[sent_id] = SentResume(sent_id, job_id, seen.body["file_name"], content)
        return Reply(201, {"id": sent_id, "job_posting_id": job_id, "file_name": seen.body["file_name"]})

    def _built_resumes(self, seen: Seen) -> Reply:
        """routers/built_resumes.py: the base resume, and a tailored one per job posting."""
        return Reply(200, [{"id": "base-1", "name": "Resume #1", "job_posting_id": None}] + [
            {"id": f"tailored-{job_id}", "name": "Tailored", "job_posting_id": job_id}
            for job_id in self.tailored_resumes])

    def _job_routes(self, job_id: str) -> None:
        me = self.fake.account["id"]
        self.fake.route("PUT", f"/applicants/{me}/applications/{job_id}/stage",
                        self._signed_in(lambda seen: self._stage(job_id, seen)))
        self.fake.route("POST", f"/jobs/{job_id}/applied", self._signed_in(lambda seen: self._applied(job_id, seen)))
        self.fake.route("DELETE", f"/jobs/{job_id}/saved", self._signed_in(lambda seen: self._unsave(job_id)))
        self.fake.route("DELETE", f"/applicants/{me}/applications/{job_id}",
                        self._signed_in(lambda seen: self._dequeue(job_id)))

    def _unsave(self, job_id: str) -> Reply:
        """routers/applications.py delete_saved: only a saved application goes; a job never saved is a 204 too."""
        application = self.applications.get(job_id)
        if application is not None and application.stage != "saved":
            return Reply(409, {"detail": f"That job is {application.stage}, so it stays in your applications."})
        self.applications.pop(job_id, None)
        return Reply(204)

    def _dequeue(self, job_id: str) -> Reply:
        """routers/auto_apply.py dequeue_job: only a queued application goes."""
        application = self.applications.get(job_id)
        if application is None:
            return Reply(404, {"detail": "That job isn't in your queue."})
        if application.stage != "queued":
            return Reply(409, {"detail": f"That application is {application.stage}, so it is no longer in the queue."})
        del self.applications[job_id]
        return Reply(204)

    def _stage(self, job_id: str, seen: Seen) -> Reply:
        application = self.applications.get(job_id)
        if application is None:
            return Reply(404, {"detail": "You have no application for that job."})
        stage = seen.body["stage"]
        if stage not in ("needs_you", *APPLIED):
            return Reply(422, {"detail": "stage"})
        if stage == "needs_you":  # Apply's (KAN-544): never on an application already applied
            if application.stage in APPLIED:
                return Reply(409, {"detail": "You already applied to that job."})
            application.stage = stage
            return Reply(200, {"job_id": job_id, "stage": stage})
        application.stage = stage
        if seen.body.get("applied_on"):
            application.applied_at = f"{seen.body['applied_on']}T12:00:00+00:00"
        application.applied_at = application.applied_at or "2026-11-02T20:00:00+00:00"
        return Reply(200, {"job_id": job_id, "stage": application.stage})

    def _applied(self, job_id: str, seen: Seen) -> Reply:
        application = self.applications.get(job_id)
        if application is None and self.postings[job_id].added:
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
