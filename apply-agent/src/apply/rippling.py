"""The Rippling Filler: has the Fill engine (apply.fill_engine) read a
Posting's Question set from its job API (public, no login), opens the form and
has the engine fill it, attach the files and read every
field back. Submitting stays here.

The submit sits behind Cloudflare Turnstile, so the form is always filled in
the page and never posted to the API.
"""

from playwright.sync_api import Page

from apply import bot_signals, fill_engine
from apply.adapters import JobSite
from apply.confirmation import wait_for_confirmation
from apply.model import Answers, Handoff, QuestionSet, Readback

class RipplingFiller:
    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        return fill_engine.fetched_question_set(url, site)

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        _open_form(page)
        return fill_engine.fill(page, "rippling", questions, answers)

    def submit(self, page: Page) -> None:
        page.locator('[data-testid="Apply"]').click()
        wait_for_confirmation(page, lambda: _confirmed(page))


def _open_form(page: Page) -> None:
    """The Posting's page shows the role; its form is one step on."""
    if "/apply" not in page.url:
        page.goto(page.url.split("?")[0].rstrip("/") + "/apply?step=application")


TURNSTILE = (
    "Cloudflare asked to prove a human is applying at the submit click, so the form was not sent. "
    "Apply yourself from the posting link; the Record has every answer"
)


def _confirmed(page: Page) -> bool:
    """Rippling's thanks; Cloudflare's Turnstile shows its box only when it
    wants the visitor to solve a challenge."""
    challenge = page.locator('[data-testid="TurnstileContainer"]')
    if challenge.count() and challenge.first.is_visible():
        raise Handoff(TURNSTILE, bot_signal=bot_signals.CAPTCHA)
    return page.get_by_text("You have successfully applied").count() > 0
