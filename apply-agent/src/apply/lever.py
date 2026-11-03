"""The Lever Filler: has the Fill engine (apply.fill_engine) read a Posting's
Question set from its /apply page's HTML, fill the form, attach the one-pager
and read every field back. Submitting stays here.
"""

import re

from playwright.sync_api import Page

from apply import bot_signals, fill_engine
from apply.adapters import JobSite
from apply.confirmation import wait_for_confirmation
from apply.model import Answers, Handoff, QuestionSet, Readback

# Lever's notice when its invisible hCaptcha turned the sent form down: the token's score, not the
# answers (Simbe Robotics, 2026-11-03, on Lisul's own Submit from a held page). Sending it again from
# the same Chrome gets the same notice.
REFUSAL = re.compile(r"error verifying your application", re.IGNORECASE)
REFUSED = "Lever's captcha turned down Apply's Chrome at the submit (\"There was an error verifying your application\")"


class LeverFiller:
    def form_url(self, url: str) -> str:
        """The /apply page, where the form is: a posting link without /apply opens the job's
        description, which has no form (Hermeus's, live: "the form never finished loading")."""
        return (fill_engine.job_of(url) or {}).get("form") or url

    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        return fill_engine.fetched_question_set(url, site)

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        return fill_engine.fill(page, "lever", questions, answers)

    def submit(self, page: Page) -> None:
        page.get_by_role("button", name="Submit application").click()
        try:
            wait_for_confirmation(page, lambda: confirmed(page), refused=lambda: refusal(page))
        except Handoff as handoff:
            if not handoff.bot_signal and refusal(page):
                handoff.bot_signal = bot_signals.REFUSED
            raise


def confirmed(page: Page) -> bool:
    """Whether Lever shows its page for a submitted application."""
    return page.url.split("?")[0].endswith("/thanks")


def refusal(page: Page) -> str:
    """REFUSED when Lever shows that its captcha turned the sent form down, else ""."""
    try:
        return REFUSED if page.get_by_text(REFUSAL).filter(visible=True).count() else ""
    except Exception:
        return ""  # a page loading, or gone
