"""The Workday Filler: Apply's host for the Fill engine's Workday Filler.

Workday hides every question until the candidate signs in, then asks them a
step at a time (My Information, My Experience, Application Questions,
Voluntary Disclosures, Self Identify, then Review), saving each step on Save
and Continue. So one Application keeps one page open from sign-in to submit
(the Orchestrator runs it on OnePage), the Question set is the first step's
questions, and fill() raises MoreQuestions at each later step that asks
something new.

Reading, filling and leaving each step is the engine's (fill-engine's
src/workday.ts, through apply.fill_engine): this host signs in, walks the
steps, hands a field the engine fails on to its Rescue, keeps the engine's
memory of the Application between calls, and saves each tenant's nested
prompts (TREES) for the engine to reuse, since reading every category of
Workday's own How Did You Hear About Us? is slow (14 s on Adobe, live).

Signing in, per the sign-in research: Sign in with Google where the tenant
offers it (picking Lisul's account is the only click allowed in Google's
pages); otherwise Sign In with the Keychain password of the account Apply
made there before; otherwise Create Account, with a new password saved to
Keychain before the form is sent, and the verification link from Gmail when
the tenant mails one. Where Lisul made an account himself ("already exists"),
a real run resets its password: the new one is saved to Keychain first and
set through the reset link from Gmail (never in a rehearsal, which stops at
the sign-in page). Workday accounts are per tenant (the host, or the
tenant's path on myworkdaysite.com).

A field the engine fails to fill (a FillError) is handed to its Rescue, if
it has one (apply.rescue): Claude fills that field on the open page, and the
step goes on. It is read back like any other.

A rehearsal paused on a step (a step Workday won't leave, a sign-in Lisul
finishes) goes on from the step the page shows when he presses Resume: it
never clicks Apply or signs in again, and the values he put on that step
stay (`resumed`). Until the page shows an application step (on Workday's
or Google's sign-in page), Resume waits for him to sign in
(`resume_blocked`), so it never asks Workday for another code or link.
"""

import json
import re
import time
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from playwright.sync_api import Locator, Page

from apply import feed, fill_engine
from apply.accounts import NEEDS_SIGN_IN, Accounts
from apply.adapters import JobSite
from apply.confirmation import wait_for_confirmation
from apply.home import HOME
from apply.model import (
    Answers,
    FillError,
    Handoff,
    MoreQuestions,
    Question,
    QuestionSet,
    Readback,
)

if TYPE_CHECKING:
    from apply.rescue import (
        Rescue,  # which imports Claude fill, which imports the job systems' modules
    )

MAIL_SEARCH = "from:(myworkday.com OR otp.workday.com)"  # Workday mails from both
WORKDAY = "myworkday.com"  # Workday's own hosts, which a mailed link may go to besides the tenant's
SIGN_IN_STEP = re.compile(r"sign in|create account", re.IGNORECASE)
NEXT_BUTTON = "[data-automation-id=pageFooterNextButton]"  # the step's footer button; at Review, its Submit
SUBMITTED = re.compile(r"application (has been )?submitted|congratulations|thank you for applying", re.IGNORECASE)
TIMEOUT = 30.0
GOOGLE_WAIT = 60.0  # s for Workday to come back from Sign in with Google
FOLLOW_UP_WAIT = 300  # ms for a follow-up question to show once its question is answered
SEND_WAIT = 10.0  # s for an auth form's click to send it, before it is clicked again
SEND_CLICKS = 3  # clicks on an auth form's button at most
# Each tenant's nested prompts as last read: "<tenant> / <label>" -> its categories and each choice's category.
TREES = HOME / "workday-trees.json"


def site_of(url: str) -> str:
    """The Workday tenant a Posting belongs to, which an Employer account is for."""
    return fill_engine.job_of(url)["tenant"]


def names(url: str, site: JobSite) -> tuple[str, str]:
    """The company and role the Feed lists for a Workday Posting: Workday's own
    pages name no company, or a legal entity ("2100 NVIDIA USA", live)."""
    if found := feed.names(url, site.fetch(feed.LIVE)):
        return found
    raise LookupError(f"{url} isn't in the Feed")


def next_step(page: Page, step: str) -> None:
    """Save and Continue on `step`, through the engine, which never clicks a button that would send:
    a step that goes on only by sending is Lisul's to check and submit."""
    try:
        fill_engine.call(page, "next", "workday", step)
    except Handoff as handoff:
        if "would send the application" not in str(handoff):
            raise
        raise Handoff(f"{handoff}. Apply didn't click it: check the form and submit it yourself.") from None


def confirmed(page: Page) -> bool:
    """Whether Workday shows its notice of a submitted application."""
    return page.get_by_text(SUBMITTED).first.is_visible()


class WorkdayFiller:
    """A Filler for one Workday Application: it signs in, then fills the
    application step by step. Built per Application with its Accounts."""

    signs_in_to_read = True  # its Question set is read only once it has signed in

    def __init__(self, accounts: Accounts, rescue: "Rescue | None" = None):
        self._accounts = accounts
        self._rescue = rescue
        self._url = ""
        self._readback: Readback = {}
        self._known: QuestionSet = []  # the questions fill() was given, which the engine fills against
        self._state: dict = {}  # the engine's memory of this Application, kept between its calls
        self._his: tuple[str, set[str]] = ("", set())  # (step, fields) Lisul filled before Resume: not filled again

    # --- The Filler ------------------------------------------------------------------

    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        self._url = url
        with site.open(url) as page:
            self._start(page)
            return self._shown(page)["questions"]

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        known = {q.name for q in questions}
        self._known = list(questions)
        # The last step is Review, or whichever step's footer button sends (a tenant may name it
        # otherwise): filling stops there, and only submit() clicks that button.
        while not (shown := self._shown(page))["review"] and not (shown["sends"] and not shown["questions"]):
            fields = shown["questions"]
            new = [q for q in fields if q.name not in known]
            if new:
                raise MoreQuestions(new)
            kept = self._his[1] if shown["step"] == self._his[0] else set()
            if sections := {name: answers[name] for name in shown["sections"] if name in answers and name not in kept}:
                self._fill(page, sections)  # the step's new panels' fields are MoreQuestions
            for q in fields:
                if q.name in answers and q.name not in sections and q.name not in kept:
                    self._put_or_rescue(page, q, None, answers[q.name])
            answered = [q.name for q in fields if q.name in answers]
            self._readback |= fill_engine.call(page, "readback", "workday", [], answered, self._engine_state())
            page.wait_for_timeout(FOLLOW_UP_WAIT)
            if any(q.name not in known for q in self._shown(page)["questions"]):
                continue  # an answer brought up a follow-up question (Snap's H-4 one, live)
            if shown["sends"]:
                break
            next_step(page, shown["step"])
        return dict(self._readback)

    def resume_blocked(self, page: Page) -> str:
        """Why Resume can't go on from the page now, or "": only from an
        application step. On a sign-in page (Workday's or Google's), Lisul signs in first."""
        try:
            on_step = _on_step(page)
        except Exception:
            on_step = False  # the page navigating: not a step yet
        if not on_step:
            return "The form isn't on an application step yet: sign in on the page, then press Resume"
        return ""

    def resumed(self, page: Page) -> dict:
        """The values on the step shown, as Lisul left it before pressing
        Resume, by Question name: fill() leaves those fields as they are."""
        shown = self._shown(page)
        names = [q.name for q in shown["questions"] if q.kind != "file" and q.name not in shown["sections"]]
        values = fill_engine.call(page, "readback", "workday", [], names, self._engine_state()) if names else {}
        kept = {name: value for name, value in values.items() if value not in (None, "", [])}
        self._his = (shown["step"], set(kept))
        return kept

    def submit(self, page: Page) -> None:
        page.locator(NEXT_BUTTON).click()
        wait_for_confirmation(page, lambda: confirmed(page), TIMEOUT)

    # --- Signing in ----------------------------------------------------------------

    def _start(self, page: Page) -> None:
        """From the posting to the first application step, signed in. On a
        step already (a rehearsal resumed after Lisul signed in), nothing."""
        if _on_step(page):
            return
        # Continue Application, where the Worker profile started this application before.
        page.locator("[data-automation-id=adventureButton], [data-automation-id=continueButton]").first.click()
        manual = page.locator("[data-automation-id=applyManually]")
        _until(page, lambda: manual.is_visible() or _signing_in(page) or _on_step(page))
        if manual.is_visible():
            manual.click()
        _until(page, lambda: _signing_in(page) or _on_step(page))
        if _signing_in(page):  # else the Worker profile is still signed in
            self._sign_in(page)

    def _sign_in(self, page: Page) -> None:
        site = site_of(self._url)
        google = page.locator("[data-automation-id=GoogleSignInButton]")
        if google.is_visible():
            return self._google(page, google)
        with_email = page.locator("[data-automation-id=SignInWithEmailButton]")
        if with_email.is_visible():
            with_email.click()
        password = self._accounts.password(site)
        if password:
            return self._password(page, site, password)
        self._create_account(page, site)

    def _password(self, page: Page, site: str, password: str) -> None:
        form = _auth_form(page, "signInLink", create=False)
        _type(form, {"email": self._accounts.login, "password": password})
        outcome = _send(page, form, lambda: "in" if _on_step(page) else _error(page) and "error")
        if outcome == "error":
            raise self._accounts.sign_in_failed(site, f"Workday said: {_error(page)}")

    def _create_account(self, page: Page, site: str) -> None:
        form = _auth_form(page, "createAccountLink", create=True)
        password = self._accounts.new_password(site)  # in Keychain before the form is sent
        _type(form, {"email": self._accounts.login, "password": password, "verifyPassword": password})
        accept = form.locator("[data-automation-id=createAccountCheckbox]")
        if accept.count():
            accept.check()
        since = self._accounts.clock.now()
        verify = page.get_by_text(re.compile(r"verification (email|link)|verify your (account|email)", re.IGNORECASE))
        outcome = _send(page, form, lambda: "in" if _on_step(page) else
                        _error(page) and "error" or verify.first.is_visible() and "verify")
        if outcome == "error":
            error = _error(page)
            if re.search(r"already", error, re.IGNORECASE):
                return self._reset_password(page, site)
            raise Handoff(f"Workday at {site} refused the new account: '{error}'")
        self._accounts.created(site)
        if outcome == "verify":
            link = self._accounts.link(MAIL_SEARCH, since, self._link_hosts())
            page.goto(link)
            page.goto(self._url)
            self._start(page)

    def _reset_password(self, page: Page, site: str) -> None:
        """Lisul made the account himself, so Keychain has no password for it:
        a new one goes to Keychain first, then Forgot your password? mails a
        reset link (read from Gmail, to this tenant's host or Workday's), whose
        page takes the new password; then Apply signs in with it. Should the
        reset not finish, that password is never tried (a sign-in failure)."""
        password = self._accounts.reset_password(site)  # in Keychain; a rehearsal or no Gmail stops here
        form = _auth_form(page, "signInLink", create=False)
        page.locator("[data-automation-id=forgotPasswordLink]").click()
        _until(page, lambda: form.locator("[data-automation-id=resetPasswordButton]").count() > 0)
        _type(form, {"email": self._accounts.login})
        send = form.locator("[data-automation-id=click_filter]")
        since = self._accounts.clock.now()
        send.click()
        if _until(page, lambda: _error(page) and "error" or _alert(page) and "sent") == "error":
            raise self._accounts.sign_in_failed(site, f"Workday wouldn't reset the password: {_error(page)}")
        try:
            link = self._accounts.link(MAIL_SEARCH, since, self._link_hosts())
        except Handoff as no_mail:
            raise self._accounts.sign_in_failed(site, f"the password reset didn't finish. {str(no_mail).removeprefix(NEEDS_SIGN_IN)}") from None
        page.goto(link)
        form = page.locator("[data-automation-id=signInFormo]")
        form.locator("[data-automation-id=verifyPassword]").wait_for(timeout=TIMEOUT * 1000)
        _type(form, {"password": password, "verifyPassword": password})
        form.locator("[data-automation-id=click_filter]").click()
        if _until(page, lambda: _error(page) and "error" or _alert(page) and "reset") == "error":
            raise self._accounts.sign_in_failed(site, f"Workday refused the new password: {_error(page)}")
        self._accounts.created(site)  # Apply holds its password now: list it
        page.goto(self._url)
        self._start(page)

    def _link_hosts(self) -> tuple[str, ...]:
        """Where a link mailed for this tenant may go: its own host, or Workday's."""
        return (urlsplit(self._url).hostname or "", WORKDAY)

    def _google(self, page: Page, button: Locator) -> None:
        button.click()
        account = page.locator(f'[data-identifier="{self._accounts.login}"], [data-email="{self._accounts.login}"]')
        # A Worker profile that used it before may come straight back, signed in, without the
        # chooser; and Workday may take its time over that (over 20 s on Snap's tenant, live).
        on_google = lambda: page.url.startswith("https://accounts.google.com/")
        try:
            shown = _until(page, lambda: _on_step(page) and "in" or account.first.is_visible() and "chooser"
                           or on_google() and _google_asks(page) and "asks" or _google_rejected(page) and "rejected",
                           GOOGLE_WAIT)
        except TimeoutError:
            if on_google():
                raise Handoff(_google_wants(page)) from None
            raise Handoff(f"Workday didn't come back signed in from Sign in with Google within {GOOGLE_WAIT:.0f} s "
                          f"({page.url}): finish the application yourself.") from None
        if shown == "asks":
            raise Handoff(_google_wants(page))
        if shown == "rejected":
            raise Handoff(GOOGLE_REJECTED)
        if shown == "in":
            return
        account.first.click()
        _until(page, lambda: not on_google() or _google_asks(page) or _google_rejected(page))
        if _google_rejected(page):
            raise Handoff(GOOGLE_REJECTED)
        if on_google():
            raise Handoff(_google_wants(page))
        _until(page, lambda: _on_step(page))

    # --- Steps, through the engine ---------------------------------------------------

    def _shown(self, page: Page) -> dict:
        """The step shown: its name, its Questions, its repeating sections'
        names, and whether it is Review or a step whose button sends."""
        shown = self._kept(fill_engine.call(page, "readQuestions", "workday", self._engine_state()))
        if shown.get("wentWrong"):
            page.reload()  # as Workday's error page asks: its step showed on the next load (Salesforce, live)
            shown = self._kept(fill_engine.call(page, "readQuestions", "workday", self._engine_state()))
        shown["questions"] = fill_engine.question_set(shown["questions"])
        return shown

    def _fill(self, page: Page, answers: Answers) -> Readback:
        result = self._kept(fill_engine.call(page, "fill", "workday", fill_engine.questions_arg(self._known),
                                             fill_engine.answers_arg(answers), self._engine_state()))
        if "moreQuestions" in result:
            raise MoreQuestions(fill_engine.question_set(result["moreQuestions"]))
        return result["readback"]

    def _engine_state(self) -> dict:
        return {**self._state, "tenant": site_of(self._url), "trees": _saved_trees()}

    def _kept(self, result: dict) -> dict:
        """Keep the engine's state from a call's result, saving the trees it read."""
        self._state = result.pop("state")
        for key, tree in self._state.pop("saved", {}).items():
            _save_tree(key, tree)
        return result

    @property
    def shown_so_far(self) -> Readback:
        """What each field filled so far showed when read back: a Record's, should a step stop the fill."""
        return dict(self._readback)

    @property
    def rescued(self) -> list[str]:
        """Each field Claude filled for the Filler, for its Repair request."""
        return list(self._rescue.notes) if self._rescue else []

    def _put_or_rescue(self, page: Page, q: Question, box: Locator | None, value) -> None:
        try:
            self._put(page, q, box, value)
        except FillError as error:
            if not (self._rescue and self._rescue.field(page, q.label, value, error)):
                raise

    def _put(self, page: Page, q: Question, box: Locator | None, value, fresh: bool = False) -> None:
        """Fill one field through the engine."""
        self._fill(page, {q.name: value})


def _saved_trees() -> dict:
    try:
        return json.loads(TREES.read_text())
    except (OSError, ValueError):
        return {}


def _save_tree(key: str, tree: dict) -> None:
    """Save a nested prompt's tree for its tenant. Workers saving at once may
    keep one's alone: the other is only read again next time."""
    trees = _saved_trees() | {key: tree}
    TREES.parent.mkdir(parents=True, exist_ok=True)
    temp = TREES.with_suffix(f".{time.monotonic_ns()}.tmp")
    temp.write_text(json.dumps(trees, indent=2, ensure_ascii=False) + "\n")
    temp.replace(TREES)


def _auth_form(page: Page, switch: str, create: bool) -> Locator:
    """The Create Account (create) or Sign In form, switching views if the other is shown."""
    form = page.locator("[data-automation-id=signInFormo]")
    form.wait_for(timeout=TIMEOUT * 1000)
    title = page.locator("#authViewTitle")
    wanted = re.compile(r"create account" if create else r"sign in", re.IGNORECASE)
    if (form.locator("[data-automation-id=verifyPassword]").count() > 0) != create:
        page.locator(f"[data-automation-id={switch}]").click()
        _until(page, lambda: (form.locator("[data-automation-id=verifyPassword]").count() > 0) == create
               and (not title.count() or wanted.search(title.inner_text())))
    return form


def _type(form: Locator, values: dict[str, str]) -> None:
    """Type into the auth form's boxes, by automation id, and make sure each
    holds its value before the form is sent: a sign-in sent half-typed would
    count as a failed one, which is never retried."""
    def held() -> bool:
        return all(form.locator(f"[data-automation-id={a}]").input_value() == v for a, v in values.items())

    for _ in range(3):
        for automation_id, value in values.items():
            form.locator(f"[data-automation-id={automation_id}]").fill(value)
        if held():
            form.page.wait_for_timeout(300)  # a view switch may still re-render the boxes empty
            if held():
                return
        form.page.wait_for_timeout(500)  # Workday re-rendered the form under us
    raise RuntimeError("Workday's sign-in form kept losing what was typed; nothing was sent")


def _send(page: Page, form: Locator, outcome) -> str:
    """Click the auth form's button and wait for `outcome`. Workday may drop a
    click that comes straight after typing, sending nothing and showing
    nothing (Axiom's Create Account, live); such a click is made again. One
    that sent the form is never repeated: a second Create Account would find
    the account made. A Handoff if Workday never answers."""
    host = urlsplit(page.url).hostname
    sent = []
    # The form goes to the tenant's host outside its /wday/ API (.../register, live).
    on_request = lambda r: r.method != "GET" and urlsplit(r.url).hostname == host \
        and not urlsplit(r.url).path.startswith("/wday/") and sent.append(r.url)
    page.on("request", on_request)
    try:
        for _ in range(SEND_CLICKS):
            form.locator("[data-automation-id=click_filter]").click()
            try:
                return _until(page, outcome, SEND_WAIT)
            except TimeoutError:
                if sent:  # sent, so Workday is slow to answer: wait it out
                    return _until(page, outcome, TIMEOUT)
    except TimeoutError:
        pass
    finally:
        page.remove_listener("request", on_request)
    raise Handoff(f"Workday didn't answer its sign-in form ({page.url}): sign in and apply yourself.")


def _step(page: Page) -> str:
    """The title of the step the application is on ("" before it starts)."""
    active = page.locator("[data-automation-id=progressBarActiveStep]")
    if not active.count():
        return ""
    lines = [line.strip() for line in active.first.inner_text().splitlines() if line.strip()]
    return re.sub(r"^(current )?step \d+ of \d+\s*", "", lines[-1]) if lines else ""


def _on_step(page: Page) -> bool:
    step = _step(page)
    return bool(step) and not SIGN_IN_STEP.search(step)


def _signing_in(page: Page) -> bool:
    return page.locator("[data-automation-id=signInContent]").is_visible()


def _error(page: Page) -> str:
    errors = page.locator("[data-automation-id=errorMessage]")
    return errors.first.inner_text().strip() if errors.count() and errors.first.is_visible() else ""


def _alert(page: Page) -> str:
    """Workday's notice on the auth form, such as "we've sent an email"."""
    alerts = page.locator("[data-automation-id=alertMessage]")
    return alerts.first.inner_text().strip() if alerts.count() and alerts.first.is_visible() else ""


def _google_asks(page: Page) -> bool:
    """Whether Google's page asks for something typed: a password, a code, a phone number."""
    return page.locator("input[type=password]:visible, input[type=tel]:visible, input[type=text]:visible").count() > 0


def _google_rejected(page: Page) -> bool:
    """Whether Google refused to sign in this browser ("This browser or app may not be secure")."""
    return urlsplit(page.url).hostname == "accounts.google.com" and "/signin/rejected" in urlsplit(page.url).path


GOOGLE_REJECTED = (
    f"{NEEDS_SIGN_IN}Google refused Sign in with Google in the Worker's Chrome (\"This browser or app may not be "
    "secure\"). Sign in with Google in your own Chrome and apply yourself."
)


def _google_wants(page: Page) -> str:
    asked = "a password" if page.locator("input[type=password]").count() else (
        page.locator("h1").first.inner_text().strip() if page.locator("h1").count() else page.url)
    return (
        f"Google asked for more than an account pick ({asked}). Agents never type Google credentials: "
        "sign the Worker profiles in to Google again by hand (see the setup checklist), then apply yourself."
    )


def _until(page: Page, done, timeout: float = TIMEOUT):
    """Wait until `done()` is truthy (and return it), through navigations."""
    end = time.monotonic() + timeout
    while True:
        try:
            if result := done():
                return result
        except Exception:
            pass  # the page navigated mid-check
        if time.monotonic() > end:
            raise TimeoutError(f"Workday page didn't get there in {timeout:.0f} s: {page.url}")
        page.wait_for_timeout(200)
