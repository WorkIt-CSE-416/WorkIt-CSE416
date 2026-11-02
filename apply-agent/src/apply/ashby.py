"""The Ashby Filler: has the Fill engine (apply.fill_engine) read a Posting's
Question set with the query Ashby's own hosted page uses, fill its form, attach
the one-pager and read every field back. Submitting stays here.

The query (`non-user-graphql?op=ApiJobPosting`) needs no login but is
undocumented; Ashby's documented equivalent needs the employer's key. If it
fails, the engine reads the Question set from the rendered form instead.

Ashby saves each answer on its server as soon as it is entered, and the submit
only names the forms; the engine saves one answer at a time and reads an answer
Ashby's saved form lacks as blank.
"""

import re
from contextlib import contextmanager

from playwright.sync_api import Page

from apply import bot_signals, fill_engine
from apply.adapters import JobSite
from apply.confirmation import wait_for_confirmation
from apply.model import Answers, Handoff, NoForm, QuestionSet, Readback, one_line

# Where Ashby says it couldn't submit the form: its failure notice ("We couldn't
# submit your application": reCAPTCHA took the browser for a bot, or another
# error; a Bot signal) or an employer's block message.
FAILURE = ".ashby-application-form-failure-container"
REFUSAL = f"{FAILURE}, .ashby-application-form-blocked-application-container"
# Ashby's Education History, whose parts the engine names by the field's path (the save script reads it).
EDUCATION = "_systemfield_education_history"
UPLOAD_WAIT = 30_000  # ms for Ashby to save an uploaded file before the engine attaches it again


class AshbyFiller:
    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        try:
            return fill_engine.fetched_question_set(url, site)
        except Exception:  # the query is undocumented: any failure, from the network to a changed schema
            with site.open(url) as page, _no_form_is_a_handoff():
                return fill_engine.read_questions(page, "ashby")

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        with _no_form_is_a_handoff():
            return fill_engine.fill(page, "ashby", questions, answers, {"uploadWait": UPLOAD_WAIT})

    def unasked(self, page: Page, questions: QuestionSet) -> list[str]:
        """The labels of the required fields on the open form that `questions`
        lacks: a field the Question set missed is left empty."""
        return fill_engine.unasked(page, "ashby", questions)


    def submit(self, page: Page) -> None:
        page.locator(".ashby-application-form-submit-button").click()
        try:
            wait_for_confirmation(page, lambda: confirmed(page), refused=lambda: _refusal(page))
        except Handoff as handoff:
            if not handoff.bot_signal and page.locator(FAILURE).filter(visible=True).count():
                handoff.bot_signal = bot_signals.REFUSED
            raise


def confirmed(page: Page) -> bool:
    """Whether Ashby shows its notice of a submitted application."""
    return page.locator(".ashby-application-form-success-container").is_visible()


def _refusal(page: Page) -> str:
    """Why Ashby refused the submitted form, as its failure notice says, or ""."""
    notice = page.locator(REFUSAL).filter(visible=True)
    if not notice.count():
        return ""
    text = one_line(notice.first.inner_text())
    message = re.sub(r"^we couldn.t submit your application\W*", "", text, flags=re.IGNORECASE)
    return f"Ashby refused the submission: {message or text}"


@contextmanager
def _no_form_is_a_handoff():
    """A page Ashby serves no form (seen live on Base Power and Cohere,
    2026-10-19, after a burst of queries from one address; open or mid-fill, the
    form is gone) is a Handoff in Ashby's words, as a Bot signal: a later try may get the form."""
    try:
        yield
    except NoForm as notice:
        raise Handoff(f"Ashby showed no form: {notice}", bot_signals.REFUSED) from None
