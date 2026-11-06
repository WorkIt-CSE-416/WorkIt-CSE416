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

Signing in, per policies.yaml's workday_sign_in: with email and password
(`email`, the default), even where the tenant offers Sign in with Google,
since Google may ask for a passkey after the account pick (ASML's, KLA's);
or Sign in with Google where offered (`google`: picking Lisul's account is
the only click allowed in Google's pages). By email: Sign In with the
Keychain password of the account Apply made there before; otherwise Create
Account, with a new password saved to Keychain before the form is sent, and
the verification link from Gmail when the tenant mails one. Some tenants answer Create Account with their bare
Sign In view (Northrop's and Zillow's, live): where the account is to be
verified, by way of their "verify your account" page (`/login/warning`,
Zillow's), and Apply then waits for the link. Workday's code loads that
Sign In view only when its answer made the account (Visa's, Northrop's,
live), so Apply signs in there with the new password; refused, an account
was there already (ASML's, live, which Workday answers as a new one): a run
resets its password once, and a rehearsal stops (`MAY_EXIST`). No answer at
all is handled the same way. A sign-in to an account that an
earlier run made but never verified opens the link Workday mailed then, if
Gmail still has it, once. Where Lisul made an account himself ("already exists"),
a real run resets its password: the new one is saved to Keychain first and
set through the reset link from Gmail (never in a rehearsal, which stops at
the sign-in page). But on a tenant that offers Google, that account was made
with Google: Needs sign-in, and Apply never presses Forgot your password?.
Workday accounts are per tenant (the host, or the tenant's path on
myworkdaysite.com).

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
from datetime import datetime, timedelta
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from playwright.sync_api import Locator, Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from apply import feed, fill_engine, trace
from apply.accounts import HANDS_OFF, NEEDS_SIGN_IN, Accounts
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
    one_line,
)

if TYPE_CHECKING:
    from apply.rescue import (
        Rescue,  # which imports Claude fill, which imports the job systems' modules
    )

MAIL_SEARCH = "from:(myworkday.com OR otp.workday.com)"  # Workday mails from both
WORKDAY = "myworkday.com"  # Workday's own hosts, which a mailed link may go to besides the tenant's
SIGN_IN_STEP = re.compile(r"sign in|create account", re.IGNORECASE)
NEXT_BUTTON = "[data-automation-id=pageFooterNextButton]"  # the step's footer button; at Review, its Submit
BACK_BUTTON = "[data-automation-id=pageFooterBackButton]"  # back a step: to fill again an answer planned anew
MAX_BACK = 10  # steps back at most: more than any application has
SUBMITTED = re.compile(r"application (has been |was )?(submitted|received)|congratulations|thank(s| you) for applying"
                       r"|successfully (submitted|applied)", re.IGNORECASE)
TIMEOUT = 30.0
GOOGLE_BUTTON = "[data-automation-id=GoogleSignInButton]"
SIGN_INS = ("email", "google")  # policies.yaml: workday_sign_in
GOOGLE_WAIT = 60.0  # s for Workday to come back from Sign in with Google
FOLLOW_UP_WAIT = 300  # ms for a follow-up question to show once its question is answered
REFUSED = "won't leave its"  # the engine's Handoff when Save and Continue doesn't leave the step
REFILL_WAIT = 1_000  # ms for a step Workday refused to settle before it is filled again
SEND_WAIT = 10.0  # s for an auth form's click to send it, before it is clicked again
SEND_CLICKS = 3  # clicks on an auth form's button at most
# The page Workday answers a new account with when it mails a link to verify it (Zillow's, live): its notice
# may never show, since Workday then loads its bare Sign In view.
VERIFY_WARNING = "/login/warning"
# Create Account's own request (POST <site>/register, live), answered with JSON: a root (or redirect) widget
# when the account is made, a message of type ERROR when refused (Workday's cx-jobs code, 2026.44).
REGISTER = "/register"
UNVERIFIED = re.compile(r"verif", re.IGNORECASE)  # Workday's refusal of a sign-in to an account not verified yet
# How far back Gmail is read for the link of an account an earlier run made (Gmail's own search reads a day).
VERIFY_LOOKBACK = timedelta(days=1)
# Each tenant's nested prompts as last read: "<tenant> / <label>" -> its categories and each choice's category.
TREES = HOME / "workday-trees.json"


def site_of(url: str) -> str:
    """The Workday tenant a Posting belongs to, which an Employer account is for."""
    return fill_engine.job_of(url)["tenant"]


def names(url: str, site: JobSite) -> tuple[str, str]:
    """The company and role the Feed lists for a Workday Posting: Workday's own
    pages name no company, or a legal entity ("2100 NVIDIA USA", live). One the
    Feed lacks is named by Workday's job API, its legal entity trimmed to the
    company (ASML's "ASML US, LP. (US30)", live): unnamed, its Record had no company."""
    try:
        if found := feed.names(url, site.fetch(feed.LIVE)):
            return found
    except Exception:
        pass  # the Feed unreachable: the job API still names it
    entity, title = fill_engine.job_names(url, site)
    return company_of(entity), title


# What a legal entity adds to the company's name: a code in brackets, a legal form, a country.
LEGAL_PART = re.compile(r"\s*\([^)]*\)$|,?\s+(LP|LLP|LLC|L\.L\.C|Inc|Corp|Corporation|Co|Ltd|GmbH|B\.V|N\.V|S\.A|PLC)\.?$"
                        r"|\s+(US|USA|U\.S\.A?)\.?$", re.IGNORECASE)


def company_of(entity: str) -> str:
    """The company a Workday legal entity names: "ASML US, LP. (US30)" is ASML."""
    name = entity.strip()
    while (shorter := LEGAL_PART.sub("", name).strip()) and shorter != name:
        name = shorter
    return name


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
    """Whether Workday shows its notice of a submitted application: any of its
    words in sight, not only the first (a hidden live region can say them first)."""
    found = page.get_by_text(SUBMITTED)
    return any(found.nth(i).is_visible() for i in range(min(found.count(), 20)))


class WorkdayFiller:
    """A Filler for one Workday Application: it signs in, then fills the
    application step by step. Built per Application with its Accounts."""

    signs_in_to_read = True  # its Question set is read only once it has signed in

    def __init__(self, accounts: Accounts, rescue: "Rescue | None" = None, sign_in: str = "email"):
        """`sign_in` is policies.yaml's workday_sign_in: "email" or "google"."""
        if sign_in not in SIGN_INS:
            raise ValueError(f"policies.yaml: workday_sign_in is {sign_in!r}, not one of {', '.join(SIGN_INS)}")
        self._accounts = accounts
        self._with_google = sign_in == "google"
        self._rescue = rescue
        self._url = ""
        self._readback: Readback = {}
        self._given: Answers = {}  # the answers the last fill was given, to tell one planned anew
        self._known: QuestionSet = []  # the questions fill() was given, which the engine fills against
        self._state: dict = {}  # the engine's memory of this Application, kept between its calls
        self._his: tuple[str, set[str]] = ("", set())  # (step, fields) Lisul filled before Resume: not filled again
        # The step a fill stopped on for Lisul, and what its fields showed then: on Resume, only a value he changed
        # from it is his (KAN-676). An untouched box (read "No") or one the page pre-ticked stays the page's.
        self._paused_step = ""
        self.paused: dict | None = None
        self._link_opened = False  # a verification link was opened: one that didn't verify is never opened again

    # --- The Filler ------------------------------------------------------------------

    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        self._url = url
        with site.open(url) as page:
            self._start(page)
            return self._shown(page)["questions"]

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        try:
            return self._fill_steps(page, questions, answers)
        except Handoff:
            self._read_pause(page)  # what the step shows as it stops for Lisul, to tell what he changes before Resume
            raise

    def _read_pause(self, page: Page) -> None:
        try:
            shown = self._shown(page)
            self._paused_step, self.paused = shown["step"], self._values(page, shown)
        except Exception:
            self._paused_step, self.paused = "", None  # unread: on Resume no attestation counts as his

    def _values(self, page: Page, shown: dict) -> dict:
        """What each field of the step shown holds, by Question name (no file, no section)."""
        names = [q.name for q in shown["questions"] if q.kind != "file" and q.name not in shown["sections"]]
        return fill_engine.call(page, "readback", "workday", [], names, self._engine_state()) if names else {}

    def _fill_steps(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        known = {q.name for q in questions}
        self._known = list(questions)
        self._back_to_changed(page, questions, answers)
        refilled: set[str] = set()  # the steps Workday refused once, filled again
        attests = {name for name in fill_engine.attestations(questions) if name not in answers}  # Lisul's to tick
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
            # A required attestation or signature on this step is Lisul's (KAN-676): Save and Continue would refuse
            # it blank, so the form stops here for him to tick it. Resume goes on with what he put on the step.
            if unticked := [q.label for q in fields if q.required and q.name in attests and q.name not in kept]:
                raise Handoff(fill_engine.tick_ask(unticked))
            try:
                next_step(page, shown["step"])
            except Handoff as refused:
                # Workday may drop a step's picks as it loads the step's questions again: ASML's Application
                # Questions showed each pick, yet Save and Continue found two required answers empty, while the
                # same picks made by hand then took (live). So a refused step is filled once more, then refused for good.
                if REFUSED not in str(refused) or shown["step"] in refilled:
                    raise
                refilled.add(shown["step"])
                page.wait_for_timeout(REFILL_WAIT)
        return dict(self._readback)

    def _back_to_changed(self, page: Page, questions: QuestionSet, answers: Answers) -> None:
        """Back to the first step holding an answer other than the one the last fill was given there (the
        plan's answer replanned, or the Pre-submit review's fix), from the step the draft opens on (its Review,
        once filled), so the fill goes on from there and puts it. Workday keeps each step saved, so a fill
        again opens past them."""
        changed = [q for q in questions if q.name in answers and q.name in self._given and q.name in self._readback
                   and answers[q.name] != self._given[q.name]]
        self._given = dict(answers)
        if not changed:
            return
        wanted = changed[0].name.split(" / ", 1)[0]  # a Question's name starts with its step
        for _ in range(MAX_BACK):
            step = self._shown(page)["step"]
            back = page.locator(BACK_BUTTON).first
            if step == wanted or not back.count() or not back.is_visible():
                return
            back.click()
            _until(page, lambda: _on_step(page) and _step(page) != step)

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

    def signed_in(self, page: Page) -> bool:
        """Whether the page is past sign-in, on an application step: `_start`'s own check, so a fill from
        there signs in no more."""
        return _on_step(page)

    def resumed(self, page: Page) -> dict:
        """The values on the step shown that Lisul changed before pressing Resume, by Question name: fill() leaves
        those fields as they are. Only a value other than the one the step showed when the fill stopped is his: an
        untouched box reads "No", and a box the page ticked reads "Yes", and neither is his (KAN-676). With no read of
        the pause on this step, every value counts but an attestation's, which stays his to tick."""
        shown = self._shown(page)
        values = self._values(page, shown)
        at_pause = self.paused if self.paused is not None and self._paused_step == shown["step"] else None
        attests = fill_engine.attestations(shown["questions"]) if at_pause is None else set()
        kept = {name: value for name, value in values.items() if value not in (None, "", [])
                and (value != at_pause.get(name) if at_pause is not None else name not in attests)}
        self._his = (shown["step"], set(kept))
        if at_pause is None:
            self.paused = None
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
            if getattr(self._accounts, "hands_off", False):  # a reopened form: Lisul signs in himself (KAN-720)
                raise Handoff(HANDS_OFF)
            self._sign_in(page)

    def _sign_in(self, page: Page) -> None:
        site = site_of(self._url)
        google = page.locator(GOOGLE_BUTTON)
        offers_google = google.is_visible()
        if offers_google and self._with_google:
            return self._google(page, google)
        _by_email(page)
        password = self._accounts.password(site)
        if password:
            return self._password(page, site, password)
        self._create_account(page, site, offers_google)

    def _password(self, page: Page, site: str, password: str, made_since: datetime | None = None) -> None:
        """Sign In with the account's password. A refusal for want of
        verifying the account opens the link Workday mailed, if Gmail has it.
        `made_since`: Create Account was sent then, and Workday answered with
        its Sign In page (`_create_account`): signed in, the account is made;
        refused as not verified, it is made and its link is waited for; any
        other refusal means an account was there already (`_may_exist`)."""
        _by_email(page)
        form = _auth_form(page, "signInLink", create=False)
        _type(form, {"email": self._accounts.login, "password": password})
        outcome = _send(page, form, lambda: "in" if _on_step(page) else _error(page) and "error")
        if made_since and outcome == "in":
            self._accounts.created(site)
        if outcome == "error":
            error = _error(page)
            if made_since:
                if UNVERIFIED.search(error):
                    self._accounts.created(site)
                    return self._verify(page, made_since)
                return self._may_exist(page, site)
            if UNVERIFIED.search(error):  # the password is right: never a failed sign-in
                if self._link_opened:
                    raise Handoff(f"{NEEDS_SIGN_IN}Workday at {site} still said: '{error}' after Apply opened the "
                                  "link it mailed. Verify the account yourself, then sign in and apply yourself.")
                # Made in an earlier run: its link may be in Gmail still (Zillow's, live).
                earlier = self._accounts.clock.now() - VERIFY_LOOKBACK
                if link := self._accounts.mailed_link(MAIL_SEARCH, earlier, (urlsplit(self._url).hostname or "",)):
                    return self._open_link(page, link)
                raise Handoff(f"{NEEDS_SIGN_IN}Workday at {site} said: '{error}' Verify the account through the "
                              "link Workday mailed when Apply made it, then sign in and apply yourself.")
            raise self._accounts.sign_in_failed(site, f"Workday said: {error}")

    def _create_account(self, page: Page, site: str, offers_google: bool = False) -> None:
        """`offers_google`: the tenant shows Sign in with Google, so an account
        that already exists for Lisul's email was made with Google."""
        form = _auth_form(page, "createAccountLink", create=True)
        password = self._accounts.new_password(site)  # in Keychain before the form is sent
        _type(form, {"email": self._accounts.login, "password": password, "verifyPassword": password})
        accept = form.locator("[data-automation-id=createAccountCheckbox]")
        if accept.count():
            accept.check()
        since = self._accounts.clock.now()
        verify = page.get_by_text(re.compile(r"verification (email|link)|verify your (account|email)", re.IGNORECASE))
        # Some tenants' Create Account view says so before it is sent ("a verification email will be sent",
        # Xcel's): only a notice shown after the click counts.
        notices = lambda: set(verify.evaluate_all("els => els.filter(e => e.checkVisibility()).map(e => e.innerText)"))
        before = notices()
        warned = []  # Workday went to its "verify your account" page, whose notice may never show
        on_request = lambda r: urlsplit(r.url).path.endswith(VERIFY_WARNING) and warned.append(r.url)
        answers: list[dict] = []  # Workday's answer to the form (`_register_answer`)
        on_response = lambda r: r.request.method == "POST" and urlsplit(r.url).path.endswith(REGISTER) \
            and answers.append(_register_answer(r))
        made = lambda: any(a.get("made") for a in answers)
        page.on("request", on_request)
        page.on("response", on_response)
        try:
            outcome = _send(page, form, lambda: "in" if _on_step(page) else _error(page) and "error"
                            or _refused(answers) and "error" or (warned or notices() - before or _says_verify(answers)) and "verify"
                            or (_sign_in_view(page) or made() and _signing_in(page)) and "sign in",
                            unanswered="unanswered")
        finally:
            page.remove_listener("request", on_request)
            page.remove_listener("response", on_response)
        trace.event("create_account", outcome=outcome, answers=[{k: v for k, v in a.items() if k != "info"} for a in answers])
        if outcome == "error":
            error = _error(page) or _refused(answers)
            if re.search(r"already", error, re.IGNORECASE):
                if offers_google:  # never Forgot your password?, which mails Lisul
                    self._accounts.not_made(site)
                    raise Handoff(MADE_WITH_GOOGLE.format(company=self._accounts.company or site))
                return self._reset_password(page, site)
            raise Handoff(f"Workday at {site} refused the new account: '{error}'")
        if outcome == "sign in" or outcome == "unanswered" and made():
            # Workday's code goes to Sign In only when its answer made the account (a root widget), and then the
            # new password signs in, or is refused as not verified yet (Visa's, Northrop's, live). It answers an
            # email that has an account the same way (ASML's, live): there the new password is refused.
            return self._password(page, site, password, made_since=since)
        if outcome == "unanswered":
            return self._may_exist(page, site)
        self._accounts.created(site)
        if outcome == "verify":
            return self._verify(page, since)

    def _may_exist(self, page: Page, site: str) -> None:
        """Create Account was sent, and Workday answered nothing, or went to
        Sign In and the new password was refused there: the account existed
        already (ASML's, live: Lisul made it with Google), and Workday answers
        that as it answers a new account (no error status, the same Sign In
        page). So a run resets the password once, as for "already
        exists": the reset mails nothing where no account is. A reset that does
        not finish forgets the password, so no later run signs in with it. A
        rehearsal stops and says so."""
        if self._accounts.rehearsal:
            self._accounts.not_made(site)
            raise Handoff(MAY_EXIST.format(company=self._accounts.company or site, site=site))
        _by_email(page)
        try:
            return self._reset_password(page, site)
        except Handoff:
            self._accounts.not_made(site)
            raise

    def _verify(self, page: Page, since: datetime) -> None:
        """Open the verification link mailed since `since` (never asked for
        again), then start the application over, signing in."""
        self._open_link(page, self._accounts.link(MAIL_SEARCH, since, self._link_hosts()))

    def _open_link(self, page: Page, link: str) -> None:
        self._link_opened = True
        page.goto(link)
        page.goto(self._url)
        self._start(page)

    def _reset_password(self, page: Page, site: str) -> None:
        """Lisul made the account himself, so Keychain has no password for it:
        a new one goes to Keychain first, then Forgot your password? mails a
        reset link (read from Gmail, to this tenant's host or Workday's), whose
        page takes the new password; then Apply signs in with it. Should the
        reset not finish, that password is never tried (a sign-in failure). Both
        forms go through _send, since Workday may drop a click that comes
        straight after typing (Visa's and Northrop's, live)."""
        password = self._accounts.reset_password(site)  # in Keychain; a rehearsal or no Gmail stops here
        form = _auth_form(page, "signInLink", create=False)
        page.locator("[data-automation-id=forgotPasswordLink]").click()
        _until(page, lambda: form.locator("[data-automation-id=resetPasswordButton]").count() > 0)
        _type(form, {"email": self._accounts.login})
        since = self._accounts.clock.now()
        if _send(page, form, lambda: _error(page) and "error" or _alert(page) and "sent") == "error":
            raise self._accounts.sign_in_failed(site, f"Workday wouldn't reset the password: {_error(page)}")
        try:
            link = self._accounts.link(MAIL_SEARCH, since, self._link_hosts())
        except Handoff as no_mail:
            raise self._accounts.sign_in_failed(site, f"the password reset didn't finish. {str(no_mail).removeprefix(NEEDS_SIGN_IN)}") from None
        page.goto(link)
        form = page.locator("[data-automation-id=signInFormo]")
        form.locator("[data-automation-id=verifyPassword]").wait_for(timeout=TIMEOUT * 1000)
        _type(form, {"password": password, "verifyPassword": password})
        # Workday may answer a reset with its notice or by going back to Sign In (Northrop's, live).
        if _send(page, form, lambda: _error(page) and "error" or (_alert(page) or _sign_in_view(page)) and "reset") == "error":
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
        self.step = str(shown.get("step") or "")  # the step shown, for the tile's line (apply.stuck)
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
        except (FillError, PlaywrightTimeoutError) as error:
            # An engine call a plain Worker didn't answer in time (PortTimeoutError, NVIDIA's My Information, live,
            # KAN-702) is this field's failure, not the fill's: rescued, or else a FillError naming the field, which
            # a rehearsal skips and goes on without.
            if self._rescue and self._rescue.field(page, q.label, value, error):
                return
            if isinstance(error, FillError):
                raise
            raise FillError(f"{q.label}: the Fill engine didn't finish it in time ({one_line(str(error))[:200]})") from error

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


def _send(page: Page, form: Locator, outcome, unanswered: str = "") -> str:
    """Click the auth form's button and wait for `outcome`. Workday may drop a
    click that comes straight after typing, sending nothing and showing
    nothing (Axiom's Create Account, live); such a click is made again. One
    that sent the form is never repeated: a second Create Account would find
    the account made. A Handoff if Workday never answers; `unanswered`
    instead, when given and the form was sent."""
    host = urlsplit(page.url).hostname
    sent = []
    # The form goes to the tenant's host outside its /wday/ API (.../register, live).
    on_request = lambda r: r.method != "GET" and urlsplit(r.url).hostname == host \
        and not urlsplit(r.url).path.startswith("/wday/") and sent.append(r.url)
    page.on("request", on_request)
    try:
        for _ in range(SEND_CLICKS):
            _let_account_click(page)
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
        _let_account_click(page, False)
    if sent and unanswered:
        return unanswered
    raise Handoff(f"Workday didn't answer its sign-in form ({page.url}): sign in and apply yourself.")


def _let_account_click(page: Page, let: bool = True) -> None:
    """Let Apply's clicks on the auth form's button through a rehearsal's
    guard (apply.submit_guard), which would take Workday's "Submit" (its
    label in the Sign in with email view, Sonos's, live) for the application's;
    `let=False` puts the guard back."""
    try:
        page.evaluate(f"window.__applyAccountClick = {'true' if let else 'false'}")
    except Exception:
        pass  # the page navigating: its next document has no guard state to set yet


def _by_email(page: Page) -> None:
    """On a tenant that offers other sign-ins, open its email one (Workday's Sign in with email)."""
    with_email = page.locator("[data-automation-id=SignInWithEmailButton]")
    if with_email.is_visible():
        with_email.click()


def _register_answer(response) -> dict:
    """What Workday's answer to Create Account says: `made` (a root or
    redirect widget), `error` (its message of type ERROR), `info` (the
    notice it keeps for its Sign In page), and the `status`. A redirect, or
    a body that can't be read, says only its status."""
    answer: dict = {"status": response.status}
    try:
        body = response.json() if response.status < 300 else None
    except Exception:
        body = None
    if not isinstance(body, dict):
        return answer
    if body.get("type") == "ERROR" or ("message" in body and "widget" not in body):
        answer["error"] = str(body.get("message") or "").strip()
    elif body.get("widget") in ("root", "redirect"):
        answer["made"], answer["widget"] = True, body["widget"]
        children = (body.get("body") or {}).get("children") or [{}]
        info = children[0].get("infoText") if isinstance(children[0], dict) else None
        if info:
            answer["info"] = str(info)
    return answer


def _says_verify(answers: list[dict]) -> bool:
    """Whether Workday's answer to Create Account says the new account is to be verified first."""
    return any(UNVERIFIED.search(a.get("info", "")) for a in answers)


def _refused(answers: list[dict]) -> str:
    """Workday's message refusing Create Account, from its answer, or ""."""
    return next((a["error"] for a in answers if a.get("error")), "")


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


def _sign_in_view(page: Page) -> bool:
    """Whether the auth form shown is Sign In, not Create Account."""
    form = page.locator("[data-automation-id=signInFormo]")
    return form.is_visible() and not form.locator("[data-automation-id=verifyPassword]").count()


def _error(page: Page) -> str:
    errors = page.locator("[data-automation-id=errorMessage]")
    return errors.first.inner_text().strip() if errors.count() and errors.first.is_visible() else ""


def _alert(page: Page) -> str:
    """Workday's notice on the auth form, such as "we've sent an email"."""
    alerts = page.locator("[data-automation-id=alertMessage]")
    return alerts.first.inner_text().strip() if alerts.count() and alerts.first.is_visible() else ""


def _google_asks(page: Page) -> bool:
    """Whether Google's page asks for something typed (a password, a code, a phone number), or is one of
    its challenges, such as a passkey, which has no box to type in (KLA, 2026-11-03)."""
    return _google_challenge(page) or \
        page.locator("input[type=password]:visible, input[type=tel]:visible, input[type=text]:visible").count() > 0


def _google_challenge(page: Page) -> bool:
    url = urlsplit(page.url)
    return url.hostname == "accounts.google.com" and "/signin/challenge/" in url.path


def _google_rejected(page: Page) -> bool:
    """Whether Google refused to sign in this browser ("This browser or app may not be secure")."""
    return urlsplit(page.url).hostname == "accounts.google.com" and "/signin/rejected" in urlsplit(page.url).path


# Create Account went back to Sign In, or unanswered, in a rehearsal: the account may exist already.
MAY_EXIST = (f"{NEEDS_SIGN_IN}{{company}} may already have an account for your email: reset its password once, or "
             "save it with security add-generic-password -U -s apply-ats -a {site} -w, then apply yourself.")

# An account exists for Lisul's email on a tenant that offers Google, and Keychain has no password for it.
MADE_WITH_GOOGLE = (
    f"{NEEDS_SIGN_IN}{{company}}'s Workday account was made with Google; sign in once yourself, or reset its password"
)

GOOGLE_REJECTED = (
    f"{NEEDS_SIGN_IN}Google refused Sign in with Google in the Worker's Chrome (\"This browser or app may not be "
    "secure\"). Sign in with Google in your own Chrome and apply yourself."
)


def _google_wants(page: Page) -> str:
    asked = "a password" if page.locator("input[type=password]").count() else "a passkey" if (
        "/signin/challenge/pk" in urlsplit(page.url).path) else (
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
