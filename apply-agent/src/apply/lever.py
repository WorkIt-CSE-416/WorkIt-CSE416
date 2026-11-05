"""The Lever Filler: has the Fill engine (apply.fill_engine) read a Posting's
Question set from its /apply page's HTML, fill the form, attach the one-pager
and read every field back. Submitting stays here.
"""

from playwright.sync_api import Page

from apply import fill_engine
from apply.adapters import JobSite
from apply.confirmation import wait_for_confirmation
from apply.model import Answers, QuestionSet, Readback


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
        # Lever's "There was an error verifying your application", when its invisible hCaptcha turns the sent form
        # down, is a bot block (apply.captcha.BLOCKS): wait_for_confirmation raises it.
        wait_for_confirmation(page, lambda: confirmed(page))


def confirmed(page: Page) -> bool:
    """Whether Lever shows its page for a submitted application."""
    return page.url.split("?")[0].endswith("/thanks")

