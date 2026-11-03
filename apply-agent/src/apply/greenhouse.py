"""The Greenhouse Filler: has the Fill engine (apply.fill_engine) read a
Posting's Question set from the public Job Board API, fill its form, attach the
one-pager and read every field back. Submitting stays here.

Before it takes some applications, Greenhouse emails an 8-character security
code and shows a step for it after Submit: the code is read from Gmail, typed
and the form sent again. Without Gmail, or with no code, it is a Handoff.
"""

import json
import re
from dataclasses import replace
from urllib.parse import urlsplit

from playwright.sync_api import Page

from apply import bot_signals, fill_engine
from apply.accounts import Accounts
from apply.adapters import JobSite
from apply.confirmation import wait_for_confirmation
from apply.model import Answers, Handoff, Posting, QuestionSet, Readback

API = "https://boards-api.greenhouse.io/v1/boards"
GH_JID = re.compile(r"[?&]gh_jid=(\d+)")
# A careers page that names its Greenhouse job in its path, not in ?gh_jid= (Roblox's /jobs/8072713).
PATH_JID = re.compile(r"/(\d{7,})/?(?:[?#].*)?$")
# Greenhouse's security code: who mails it, and the step that asks for it (the
# job-boards form's box per character, or the older boards form's one box).
SECURITY_CODE_SEARCH = "from:(greenhouse-mail.io OR us.greenhouse-mail.io)"
SECURITY_BOXES = 'input[id^="security-input-"]'
SECURITY_BOX = 'input#security_code, input[name="security_code"]'
NO_SECURITY_CODE = ("Greenhouse asked for the security code it emails before it takes this application, and {why}. "
                    "Apply yourself from the posting link; the Record has every answer")
NOT_SET_UP = "Apply can't read Gmail here"
NOT_A_BOARD = {"www", "careers", "career", "jobs", "job", "join", "apply", "work", "com", "io", "co", "ai", "org", "net"}


def board_behind(posting: Posting, site: JobSite) -> Posting:
    """A company careers page that embeds a Greenhouse form (its link carries
    ?gh_jid=, as Waymo's and Epic's do, or the job id in its path, as Roblox's
    does) as that form's own Greenhouse link, so
    the Greenhouse Filler fills it instead of Claude fill. The board's name is
    guessed from the company and the host, and kept only if Greenhouse has the job."""
    if posting.job_system == "greenhouse" and "for=" not in posting.url and (token := re.search(r"[?&]token=(\d+)", posting.url)):
        # An embed link without its board (seen in the Feed): the page Greenhouse sends it to names the board.
        try:
            board = re.search(r"[?&]for=([\w-]+)", site.fetch(posting.url).decode("utf-8", "replace"))
        except Exception:
            return posting
        return replace(posting, url=f"https://job-boards.greenhouse.io/embed/job_app?for={board[1]}&token={token[1]}") if board else posting
    if hosted := re.search(r"greenhouse\.io/([\w-]+)/jobs/(\d+)", posting.url):
        # A board with its own careers site sends its hosted page there (Roblox's, Waymo's), so its
        # form is filled embedded; the job API names the page each job is shown on.
        board, job = hosted[1], hosted[2]
        try:
            shown_on = json.loads(site.fetch(f"{API}/{board}/jobs/{job}")).get("absolute_url") or ""
        except Exception:
            return posting
        on_greenhouse = (urlsplit(shown_on).hostname or "greenhouse.io").endswith("greenhouse.io")
        return posting if on_greenhouse else replace(posting, url=f"https://job-boards.greenhouse.io/embed/job_app?for={board}&token={job}")
    if posting.job_system != "other":
        return posting
    if jid := GH_JID.search(posting.url):
        shown_here = False
    elif jid := PATH_JID.search(posting.url):
        shown_here = True  # an id in the path may be another system's: Greenhouse must show the job on this host
    else:
        return posting
    for board in _board_guesses(posting):
        try:
            job = site.fetch(f"{API}/{board}/jobs/{jid[1]}")
        except Exception:
            continue
        if shown_here and urlsplit(_shown_on(job)).hostname != urlsplit(posting.url).hostname:
            continue
        # The embedded form: a board with its own careers site sends its hosted job page back there.
        return replace(posting, url=f"https://job-boards.greenhouse.io/embed/job_app?for={board}&token={jid[1]}")
    return posting


def _shown_on(job: bytes) -> str:
    """The page the job API says a job is shown on, else ""."""
    try:
        return str(json.loads(job).get("absolute_url") or "")
    except Exception:
        return ""


def _board_guesses(posting: Posting) -> list[str]:
    name = re.sub(r"\(.*?\)", "", posting.company).casefold()
    words = re.findall(r"[a-z0-9]+", name)
    host = [w for w in (urlsplit(posting.url).hostname or "").split(".") if w not in NOT_A_BOARD]
    bases = ["".join(words), *words[:1], *host, *(h.removeprefix("with").removeprefix("fly") for h in host)]
    # Zipline's board is flyzipline, Optiver's optiverus, Stoke Space's stokespacetechnologies.
    guesses = [*bases, *(affix.format(b) for affix in ("fly{}", "{}us", "{}technologies") for b in bases)]
    return [g for g in dict.fromkeys(guesses) if g]


def confirmed(page: Page) -> bool:
    """Whether Greenhouse shows its page for a submitted application."""
    return page.url.split("?")[0].endswith("/confirmation")


class GreenhouseFiller:
    def __init__(self, accounts: Accounts | None = None):
        """`accounts` reads the security code Greenhouse may mail before it takes the form."""
        self._accounts = accounts

    def with_accounts(self, accounts: Accounts) -> "GreenhouseFiller":
        """This Filler for one Application, reading its mail."""
        return GreenhouseFiller(accounts)

    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        """The engine reads the Job Board API's answer, and the education block, which only the
        posting page describes, with Greenhouse's degree and discipline lists."""
        return fill_engine.fetched_question_set(url, site)

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        """A question the form never shows (it depends on another's answer) is
        left out, and reads back blank."""
        return fill_engine.fill(page, "greenhouse", questions, answers)

    def submit(self, page: Page) -> tuple[str, ...]:
        """Returns the security code step as a Bot signal when Greenhouse
        asked for its code; a Handoff after that step carries it too."""
        since = self._accounts.clock.now() if self._accounts else None
        page.get_by_role("button", name="Submit application").click()
        wait_for_confirmation(page, lambda: confirmed(page) or _asks_security_code(page))
        if confirmed(page):
            return ()
        try:
            _type_security_code(page, self._security_code(page, since))
            page.get_by_role("button", name="Submit application").click()
            wait_for_confirmation(page, lambda: confirmed(page))
        except Handoff as handoff:
            handoff.bot_signal = handoff.bot_signal or bot_signals.SECURITY_CODE
            raise
        return (bot_signals.SECURITY_CODE,)

    def _security_code(self, page: Page, since) -> str:
        """The code Greenhouse mailed since `since`, else a Handoff saying why not."""
        if self._accounts is None:
            raise Handoff(NO_SECURITY_CODE.format(why=NOT_SET_UP))
        if why := self._accounts.mail_unavailable():
            raise Handoff(NO_SECURITY_CODE.format(why=why.rstrip(".")))
        return self._accounts.code(SECURITY_CODE_SEARCH, since)


def _asks_security_code(page: Page) -> bool:
    return any(box.is_visible() for box in page.locator(f"{SECURITY_BOXES}, {SECURITY_BOX}").all())


def _type_security_code(page: Page, code: str) -> None:
    boxes = page.locator(SECURITY_BOXES)
    if boxes.count() >= len(code):
        for i, char in enumerate(code):
            boxes.nth(i).fill(char)
    else:
        page.locator(SECURITY_BOX).first.fill(code)
