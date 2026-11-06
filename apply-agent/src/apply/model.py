"""Domain types shared by every module. Names follow apply/GLOSSARY.md."""

import html
import re
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

# A US phone number's format as a form spells it out: "###-###-####", "(###) ###-####".


def one_line(text: str) -> str:
    """`text` with each run of whitespace (newlines too) made one space, and none at the ends."""
    return " ".join(text.split())


def plain_text(markup: str) -> str:
    """HTML as one line of text. A link keeps its address after its words, so
    a page a question links to can still be read (apply.company)."""
    markup = re.sub(r"""<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>(.*?)</a>""",
                    lambda m: m[2] if m[1] in m[2] else f"{m[2]} ({m[1]})", markup, flags=re.IGNORECASE | re.DOTALL)
    return one_line(html.unescape(re.sub(r"<[^>]+>", " ", markup)))


def is_company(company: str, name: str) -> bool:
    """Whether `company` is the one `name` names: its name starts with that word
    or those words ("Amazon" names "Amazon Web Services", but not "Amazonia")."""
    return bool(re.match(rf"{re.escape(name)}\b", company.strip(), re.IGNORECASE))


# Job sites whose links and pages often name no company, by host: the company each is for.
HOST_COMPANIES = {
    "amazon.jobs": "Amazon",
    "jpmc.fa.oraclecloud.com": "JPMorgan Chase",
    "careers.amd.com": "Advanced Micro Devices",
    "apply.careers.microsoft.com": "Microsoft",
    "nvidia.wd5.myworkdayjobs.com": "NVIDIA",
    "bankcampuscareers.tal.net": "Bank of America",
}


def host_company(url: str) -> str:
    """The company a known job site's link is for (HOST_COMPANIES; an iCIMS host naming AMD), else ""."""
    host = (urlsplit(url).hostname or "").casefold().removeprefix("www.")
    if host.endswith(".icims.com") and "amd" in re.split(r"[.-]", host.removesuffix(".icims.com")):
        return "Advanced Micro Devices"
    return next((name for known, name in HOST_COMPANIES.items() if host == known or host.endswith("." + known)), "")


# An Eightfold careers site's Posting or form: on eightfold.ai, or on a company's own host (Netflix's).
EIGHTFOLD = re.compile(r"https?://([^/]+\.eightfold\.ai|explore\.jobs\.netflix\.net)/careers/(job/\d+|apply\?(.*&)?pid=\d+)")


# The kinds of form field every job system's questions are reduced to.
Kind = Literal["text", "textarea", "file", "select", "multi_select"]
# The job systems the Fill engine fills (fill-engine src/model.ts's Site).
Site = Literal["greenhouse", "ashby", "lever", "rippling", "workable", "eightfold", "workday"]


@dataclass(frozen=True)
class Question:
    """One field of a Posting's form. `name` is the job system's own field id.
    `description` is the help text the form shows under the label ("3-4
    sentences"), as plain text; `max_length` the most characters the field
    takes, when the form says; `section` the heading or intro the form shows
    just before it, when the form reader finds one. None tells two Questions apart."""

    name: str
    label: str
    kind: Kind
    required: bool = False
    options: tuple[str, ...] = ()
    description: str = field(default="", compare=False)
    max_length: int | None = field(default=None, compare=False)
    section: str = field(default="", compare=False)


# Every question one Posting's form asks, read before the form is opened.
QuestionSet = list[Question]

# Planned answers by Question name: text or an option label, a file to attach,
# or the option labels to tick on a multi-select.
Answers = dict[str, str | Path | list[str]]

# What each answered field shows on the page: text, an option label, a file
# name, or a multi-select's ticked option labels.
Readback = dict[str, str | list[str]]


@dataclass(frozen=True)
class Posting:
    """One open internship role at one company, with a link to its form."""

    id: str
    company: str
    title: str
    url: str

    @property
    def job_system(self) -> str:
        if "greenhouse.io/" in self.url:
            return "greenhouse"
        if "ashbyhq.com/" in self.url:
            return "ashby"
        if "jobs.lever.co/" in self.url:
            return "lever"
        if "myworkdayjobs.com/" in self.url or "myworkdaysite.com/" in self.url:
            return "workday"
        if "apply.workable.com/" in self.url:
            return "workable"
        if "oraclecloud.com/hcmUI/CandidateExperience" in self.url:
            return "oracle"
        if "ats.rippling.com/" in self.url:
            return "rippling"
        if EIGHTFOLD.match(self.url):
            return "eightfold"
        return "other"


class Status(StrEnum):
    """An Application's status in the Tracker."""

    QUEUED = "queued"
    FILLING = "filling"
    HELD = "held"
    SUBMITTED = "submitted"
    HANDOFF = "handoff"
    MISSING_FACT = "missing fact"
    NOT_ELIGIBLE = "not eligible"
    PAUSED = "paused"
    FAILED = "failed"
    CLOSED = "closed"


class Outcome(StrEnum):
    """What came of a submitted Application. Lisul sets it in the Tracker."""

    REJECTED = "rejected"
    OA = "OA"
    INTERVIEW = "interview"
    OFFER = "offer"
    GHOSTED = "ghosted"


class FillError(Exception):
    """A Filler could not drive a field. It never skips one silently."""


class NoForm(Exception):
    """The page shows no form, only the job system's notice; the message is its words (the Fill engine's NoForm)."""


class Handoff(Exception):
    """The form can't be finished without Lisul (a sign-in wall, a captcha, a
    cap reached). The message, for the Tracker row, says why; `bot_signal`
    names the Bot signal behind it, if any (apply.bot_signals)."""

    def __init__(self, why: str = "", bot_signal: str = ""):
        super().__init__(why)
        self.bot_signal = bot_signal


class Captcha(Handoff):
    """A captcha's challenge stopped the fill on `page` (apply.captcha). Apply
    never solves it: it waits for Lisul to, then goes on from that page."""

    def __init__(self, why: str, page):
        super().__init__(why, bot_signal="captcha")
        self.page = page


class Blocked(Handoff):
    """A page refused Apply's Chrome as a bot (apply.captcha.BLOCKS), with
    nothing on it to solve. Apply hands it off at once, with no retry: the
    student finishes it in their own Chrome, where the extension fills it.
    `company` is who blocked it; `url`, the posting to open there; `said`,
    the page's own words. A Filler that knows neither gives only `said`."""

    def __init__(self, why: str, company: str = "", url: str = "", said: str = ""):
        super().__init__(why, bot_signal="blocked")
        self.company, self.url, self.said = company, url, said


class Closed(Exception):
    """The Posting no longer takes applications (see GLOSSARY: Closed). The
    message says how that showed."""


# Starts the reason of a Request whose link leads to no one Posting.
NOT_A_POSTING = "Not a link to a job posting"


class NotAPosting(Exception):
    """The link leads to no one Posting: a careers home page, a list of jobs.
    The message says what it is instead."""


class MoreQuestions(Exception):
    """Raised by fill() on a form that shows its questions a step at a time
    (Workday once signed in): the step the page has reached asks `questions`,
    which the Question set didn't hold. The page stays on that step; the
    Worker plans them and calls fill() again to go on from there."""

    def __init__(self, questions: QuestionSet):
        super().__init__(", ".join(q.label for q in questions))
        self.questions = questions
