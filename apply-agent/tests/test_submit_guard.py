"""Seam 2 for the submit guard: the in-page script a rehearsal puts on every
page, against each job system's fake. With the guard on, a filled form whose
submit is forced (its button clicked, its form sent, its final POST made by
hand) records no Submission, while résumé uploads and the rest still work.

The drive guard, on every page Claude fill drives, is the same script, which
also blocks the other controls Claude must never use and is lifted only for
Claude fill's own submit click."""

import json
from contextlib import contextmanager

import pytest
from conftest import (
    ARC_FORM,
    ARC_URL,
    IMMUTA_FORM,
    IMMUTA_URL,
    PERRY_FORM,
    PERRY_URL,
    SKYDIO_FORM,
    SKYDIO_URL,
)
from fake_accounts_site import LOGIN as ACCOUNT_LOGIN
from fake_accounts_site import REGISTER as ACCOUNT_REGISTER
from fake_accounts_site import FakeAccountsSite
from fake_bamboohr import ANCHOR, FakeBambooServer, tick_the_box, ticked
from fake_jobvite import URL as JOBVITE_URL
from fake_jobvite import FakeJobviteServer
from fake_lever import FakeLeverServer
from fake_workable import FakeWorkableServer
from fake_workday import FakeWorkdayServer
from fakes import FakeClock, FakeJobServer, FakeMailbox
from playwright.sync_api import Error as PlaywrightError
from test_claude_fill import LUNAR_FORM, LUNAR_URL
from test_workday_filler import CACI_FORM, CACI_URL, NOW, ONE_PAGER, fill_all

from apply.accounts import Accounts
from apply.ashby import AshbyFiller
from apply.claude_fill import OnePage
from apply.greenhouse import GreenhouseFiller
from apply.keychain import InMemoryKeychain
from apply.lever import LeverFiller
from apply.submit_guard import CAPTCHA_TRY, DriveGuard, guard, lift, renote
from apply.workday import WorkdayFiller

SKYDIO_JOB = "79fdda46-4ff5-42c7-b208-55f2084cdb8c"

# Each system's final application request, made by hand from the page: what
# the form's own code sends once its submit button is clicked.
FINAL_POST = {
    "greenhouse": (lambda: FakeJobServer(ARC_FORM), ARC_URL, """
        fetch('https://boards.greenhouse.io/arcboatcompany/jobs/5442881008',
              {method: 'POST', body: JSON.stringify({job_application: {first_name: 'Test'}})})"""),
    "ashby": (lambda: FakeJobServer(SKYDIO_FORM), SKYDIO_URL, """
        fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitMultipleFormsAction', {method: 'POST',
              body: JSON.stringify({operationName: 'ApiSubmitMultipleFormsAction', variables: {
                jobPostingId: %s, applicationFormRenderIdentifier: 'render', surveyIdentifiers: []}})})""" % json.dumps(SKYDIO_JOB)),
    "ashby, by a Request": (lambda: FakeJobServer(SKYDIO_FORM), SKYDIO_URL, """
        fetch(new Request('https://jobs.ashbyhq.com/api/non-user-graphql', {method: 'POST',
              body: JSON.stringify({operationName: 'ApiSubmitMultipleFormsAction', variables: {
                jobPostingId: %s, applicationFormRenderIdentifier: 'render', surveyIdentifiers: []}})}))""" % json.dumps(SKYDIO_JOB)),
    "lever": (lambda: FakeLeverServer(IMMUTA_FORM, parse_delay=0), IMMUTA_URL, """
        (() => { const form = document.createElement('form');
                 form.method = 'post'; form.enctype = 'multipart/form-data'; form.action = location.href;
                 form.innerHTML = '<input name="name" value="Test Person">';
                 document.body.appendChild(form); form.submit(); })()"""),
    "bamboohr": (lambda: FakeBambooServer(LUNAR_FORM), LUNAR_URL, """
        new Promise(done => { const xhr = new XMLHttpRequest();
          xhr.open('POST', location.origin + '/careers/398/add'); xhr.onloadend = done;
          const form = new FormData(); form.append('firstName', 'Test'); xhr.send(form); })"""),
    "workable": (lambda: FakeWorkableServer(PERRY_FORM), PERRY_URL, """
        fetch('https://apply.workable.com/api/v1/jobs/D309E69A5B/apply', {method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({candidate: [{name: 'firstname', value: 'Test'}]})})"""),
    "jobvite": (lambda: FakeJobviteServer(), JOBVITE_URL, """
        new Promise(done => { const xhr = new XMLHttpRequest();
          xhr.open('POST', '/tylertech/job/oAVOAfwD/submitApplication'); xhr.onloadend = done;
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.send(JSON.stringify({fields: {first: 'Test'}, files: {}})); })"""),
}


def _post(page, script: str) -> None:
    try:
        page.evaluate(f"Promise.resolve({script}).catch(() => null)")
    except Exception:
        pass  # a navigation (Lever's native form) or a refusal ends the evaluation
    page.wait_for_timeout(1000)


@pytest.mark.parametrize("system", FINAL_POST)
def test_the_final_application_post_never_leaves_a_guarded_page(system):
    server, url, script = FINAL_POST[system]
    with server() as fake:
        with fake.open(url) as page:
            guard(page)
            _post(page, script)
        assert fake.submissions == []


@pytest.mark.parametrize("system", FINAL_POST)
def test_without_the_guard_the_same_post_reaches_the_job_system(system):
    server, url, script = FINAL_POST[system]
    with server() as fake:
        with fake.open(url) as page:
            _post(page, script)
        assert len(fake.submissions) == 1


@pytest.mark.parametrize("system", FINAL_POST)
def test_once_the_guard_is_lifted_for_lisul_the_final_post_reaches_the_job_system(system):
    server, url, script = FINAL_POST[system]
    with server() as fake:
        with fake.open(url) as page:
            guard(page)
            lift(page)
            _post(page, script)
        assert len(fake.submissions) == 1


def test_a_lifted_guard_stays_lifted_on_the_pages_lisul_loads_next():
    server, url, script = FINAL_POST["greenhouse"]
    with server() as fake:
        with fake.open(url) as page:
            guard(page)
            lift(page)
            page.reload()
            _post(page, script)
        assert len(fake.submissions) == 1


def test_lisuls_own_click_on_submit_sends_a_filled_greenhouse_form_once_the_guard_is_lifted(job_server, one_pager):
    filler = GreenhouseFiller()
    questions = filler.question_set(ARC_URL, job_server)
    answers = {"first_name": "Test", "last_name": "Person", "email": "test.person@example.com",
               "phone": "+1 555 010 0199", "question_18871502008": "Yes", "question_18871503008": "No", "resume": one_pager}

    with job_server.open(ARC_URL) as page:
        guard(page)
        filler.fill(page, questions, answers)
        lift(page)
        page.get_by_role("button", name="Submit application").click()
        page.wait_for_timeout(1500)

    assert len(job_server.submissions) == 1


def test_a_lifted_page_tells_apply_when_lisul_clicks_a_button_that_sends(job_server):
    pressed, again = [], []
    with job_server.open(ARC_URL) as page:
        guard(page)
        lift(page, pressed=pressed.append, again=lambda: again.append(True))
        page.evaluate("""() => { const next = document.createElement('button');
            next.type = 'button'; next.textContent = 'Next'; document.body.appendChild(next); }""")
        page.get_by_role("button", name="Next").click()
        page.get_by_role("button", name="Submit application").click()
        page.wait_for_timeout(500)

    assert pressed == ["Submit application"]  # a Next sends nothing
    assert again == []


def test_the_note_on_a_lifted_page_has_a_button_to_fill_the_form_again(job_server):
    again = []
    with job_server.open(ARC_URL) as page:
        guard(page)
        lift(page, again=lambda: again.append(True))
        page.get_by_role("button", name="Fill again").click()
        page.wait_for_timeout(300)
        page.reload()  # on every page Lisul loads from it
        page.get_by_role("button", name="Fill again").click()
        page.wait_for_timeout(300)

    assert again == [True, True]
    assert job_server.submissions == []


def test_the_note_sits_under_a_captcha_and_its_close_button_hides_it(job_server):
    with job_server.open(ARC_URL) as page:
        guard(page)
        lift(page, again=lambda: None)
        note = page.locator("#apply-rehearsal-blocked")
        z = int(note.evaluate("e => getComputedStyle(e).zIndex"))
        page.get_by_role("button", name="Hide this note").click()
        hidden = note.is_hidden()

    assert z < 2000000000  # reCAPTCHA's challenge frame, whose Verify Lisul must press
    assert hidden


def test_a_held_page_with_something_to_fix_says_so_in_red(job_server):
    with job_server.open(ARC_URL) as page:
        guard(page)
        lift(page, warning="Pre-submit review: Postgrad Discipline(s) ticked, but he is an undergraduate")
        note = page.locator("#apply-rehearsal-blocked")
        text, color = note.inner_text(), note.evaluate("e => getComputedStyle(e).backgroundColor")

    assert text.startswith("Apply rehearsal: fix this before you submit. Pre-submit review: Postgrad Discipline(s)")
    assert color == "rgb(176, 0, 32)"


US_PERSON_WRONG = ('The U.S. Person status question is answered "No", but the profile says he is a U.S. citizen, '
                   'so the answer should be "Yes".')


def test_a_legal_answer_the_review_found_wrong_holds_lisuls_submit_until_he_dismisses_it(job_server, one_pager):
    # Saronic's U.S. Person "No" (live, 2026-11-04): a note alone let him send it. Held, his Submit and the final
    # request are blocked under a red note, until he presses its Dismiss; then Submit is his again.
    filler = GreenhouseFiller()
    questions = filler.question_set(ARC_URL, job_server)
    answers = {"first_name": "Test", "last_name": "Person", "email": "test.person@example.com",
               "phone": "+1 555 010 0199", "question_18871502008": "Yes", "question_18871503008": "No", "resume": one_pager}
    pressed, dismissed = [], []

    with job_server.open(ARC_URL) as page:
        guard(page)
        filler.fill(page, questions, answers)
        lift(page, pressed=pressed.append, warning=f"Pre-submit review: {US_PERSON_WRONG}", held=US_PERSON_WRONG,
             dismiss=lambda: dismissed.append(True))
        note = page.locator("#apply-rehearsal-blocked")
        page.get_by_role("button", name="Submit application").click()
        page.wait_for_timeout(1000)
        _post(page, FINAL_POST["greenhouse"][2])
        held = (note.inner_text(), note.evaluate("e => getComputedStyle(e).backgroundColor"), len(job_server.submissions))
        page.get_by_role("button", name="Dismiss").click()
        page.wait_for_timeout(300)
        renote(page, held="")  # what the hold's loop does once the dismissal is saved
        page.get_by_role("button", name="Submit application").click()
        page.wait_for_timeout(1500)

    text, color, sent = held
    assert text.startswith("Apply rehearsal: Submit is held. Fix this answer, then press Dismiss: The U.S. Person")
    assert color == "rgb(176, 0, 32)" and sent == 0 and pressed == ["Submit application"]
    assert dismissed == [True]
    assert len(job_server.submissions) == 1


def test_a_held_submit_stays_held_on_the_pages_lisul_loads_next():
    server, url, script = FINAL_POST["ashby"]
    with server() as fake:
        with fake.open(url) as page:
            guard(page)
            lift(page, held=US_PERSON_WRONG)
            page.reload()
            _post(page, script)
            shown = page.locator("#apply-rehearsal-blocked").inner_text()
        assert fake.submissions == []
    assert "Submit is held" in shown


def test_a_held_page_with_only_a_field_left_blank_says_so_in_amber(job_server):
    with job_server.open(ARC_URL) as page:
        guard(page)
        lift(page, warning="Left blank: If referred by an employee, their name", wrong=False)
        note = page.locator("#apply-rehearsal-blocked")
        text, color = note.inner_text(), note.evaluate("e => getComputedStyle(e).backgroundColor")

    assert text.startswith("Apply rehearsal: check before you submit. Left blank:")
    assert color == "rgb(138, 90, 0)"


class _Guarded:
    """A job site whose every page gets the guard, as a rehearsal's does."""

    def __init__(self, site):
        self._site = site

    def fetch(self, url, body=None):
        return self._site.fetch(url, body)

    @contextmanager
    def open(self, url, worker=0):
        with self._site.open(url, worker) as page:
            guard(page)
            yield page


def _force_submit(page, button) -> None:
    """Click the submit button, then send its form by script, as a stray click or a confused driver might."""
    button.click()
    try:
        page.evaluate("""() => { for (const form of document.forms) {
            try { form.requestSubmit(); } catch (e) {} try { form.submit(); } catch (e) {} } }""")
    except PlaywrightError:
        pass  # an unguarded click's submit is already navigating away
    page.wait_for_timeout(1500)


def test_a_filled_greenhouse_form_forced_to_submit_on_a_guarded_page_sends_nothing(job_server, one_pager):
    filler = GreenhouseFiller()
    questions = filler.question_set(ARC_URL, job_server)
    answers = {"first_name": "Test", "last_name": "Person", "email": "test.person@example.com",
               "phone": "+1 555 010 0199", "question_18871502008": "Yes", "question_18871503008": "No", "resume": one_pager}

    with job_server.open(ARC_URL) as page:
        guard(page)
        readback = filler.fill(page, questions, answers)
        _force_submit(page, page.get_by_role("button", name="Submit application"))

    assert readback["resume"] == "one-pager.pdf"  # the upload still went through
    assert job_server.submissions == []


def test_a_filled_ashby_form_forced_to_submit_on_a_guarded_page_sends_nothing(ashby_server, one_pager):
    filler = AshbyFiller()
    questions = filler.question_set(SKYDIO_URL, ashby_server)
    answers = {"_systemfield_name": "Test Person", "_systemfield_email": "test.person@example.com",
               "_systemfield_resume": one_pager}

    with ashby_server.open(SKYDIO_URL) as page:
        guard(page)
        readback = filler.fill(page, questions, answers)
        _force_submit(page, page.locator(".ashby-application-form-submit-button"))

    assert readback == {**answers, "_systemfield_resume": "one-pager.pdf"}  # answers were saved to Ashby as typed
    assert ashby_server.submissions == []


def test_a_filled_lever_form_forced_to_submit_on_a_guarded_page_sends_nothing(one_pager):
    filler = LeverFiller()
    answers = {"resume": one_pager, "name": "Test Person", "email": "test.person@example.com",
               "consent[store]": "Yes"}

    with FakeLeverServer(IMMUTA_FORM, parse_delay=0) as lever_server:
        questions = filler.question_set(IMMUTA_URL, lever_server)
        with lever_server.open(IMMUTA_URL) as page:
            guard(page)
            readback = filler.fill(page, questions, answers)
            _force_submit(page, page.get_by_role("button", name="Submit application"))

        assert lever_server.parsed == [one_pager.read_bytes()]  # the résumé parse still ran
        assert readback["resume"] == "one-pager.pdf"
        assert lever_server.submissions == []


def test_a_filled_workday_application_forced_to_submit_on_a_guarded_page_sends_nothing():
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain) as server, OnePage(_Guarded(server)) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            _, _, readback = fill_all(filler, page, questions)  # every step saved, the résumé attached
            _force_submit(page, page.locator("[data-automation-id=pageFooterNextButton]"))

    assert "one-pager.pdf" in readback.values()
    assert server.submissions == []


def test_without_the_guard_the_forced_workday_submit_goes_through():
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))

    with FakeWorkdayServer(CACI_FORM, keychain=keychain) as server, OnePage(server) as site:
        questions = filler.question_set(CACI_URL, site)
        with site.open(CACI_URL) as page:
            fill_all(filler, page, questions)
            _force_submit(page, page.locator("[data-automation-id=pageFooterNextButton]"))

    assert len(server.submissions) == 1
    assert ONE_PAGER.name in server.submissions[0].application.values()


def _fill_jobvite(page) -> None:
    for label, value in [("First Name*", "Test"), ("Last Name*", "Person"), ("Email*", "test.person@example.com")]:
        page.get_by_label(label).fill(value)


def test_enter_in_a_field_on_jobvites_last_step_sends_nothing_from_a_guarded_page():
    # Jobvite's form is ng-submit="submitApplication()": Enter in a text field on its
    # last step runs the page's own send, an XHR, whatever the button click guard does.
    with FakeJobviteServer() as server:
        with server.open(JOBVITE_URL) as page:
            guard(page)
            _fill_jobvite(page)
            page.get_by_label("Email*").press("Enter")
            page.evaluate("document.getElementById('form').requestSubmit()")
            _post(page, "send()")  # the page's own send, as a script calls it
        assert server.submissions == []


def test_without_the_guard_enter_on_jobvites_last_step_sends_the_application():
    with FakeJobviteServer() as server:
        with server.open(JOBVITE_URL) as page:
            _fill_jobvite(page)
            page.get_by_label("Email*").press("Enter")
            page.wait_for_timeout(1000)
        assert len(server.submissions) == 1


def test_next_still_goes_to_the_next_step_of_a_guarded_jobvite_form():
    with FakeJobviteServer(steps=('<label for="gender">Gender*</label><input id="gender" name="gender" required>',)) as server:
        with server.open(JOBVITE_URL) as page:
            guard(page)
            _fill_jobvite(page)
            page.get_by_role("button", name="Next").click()
            assert page.get_by_label("Gender*").is_visible()


@contextmanager
def _account_page(url):
    """The fake site's sign-in or create-account page, its email and password typed."""
    server = FakeAccountsSite(FakeMailbox())
    with server.open(url) as page:
        page.get_by_label("Email").fill("test.person@example.com")
        for box in page.locator("input[type=password]").all():
            box.fill("Pa55word!")
        yield page, server


def test_a_sign_in_or_new_accounts_button_claude_clicks_does_nothing_on_a_page_it_drives():
    with _account_page(ACCOUNT_REGISTER) as (page, server):
        drive = DriveGuard(page)
        page.get_by_role("button", name="Create Account").click()
        page.wait_for_timeout(500)
        assert server.created == []
        assert drive.blocked() == ['the "Create Account" click']
    with _account_page(ACCOUNT_LOGIN) as (page, server):
        drive = DriveGuard(page)
        page.get_by_label("Password").press("Enter")  # the browser clicks its Sign In
        page.evaluate("document.getElementById('login').requestSubmit()")
        page.wait_for_timeout(500)
        assert server.sign_ins == []
        assert drive.blocked() == ['the "Sign In" click', "a sign-in"]


def test_while_claude_drives_no_click_or_key_reaches_a_captchas_box_and_lisuls_do_once_it_stops():
    with FakeBambooServer(LUNAR_FORM, recaptcha=True) as server, server.open(LUNAR_URL) as page:
        page.get_by_role("button", name="Apply for This Job").first.click()
        page.frame_locator(ANCHOR).locator("#recaptcha-anchor").wait_for()
        drive = DriveGuard(page)
        drive.arm()  # Claude drives
        tick_the_box(page)
        page.frame_locator(ANCHOR).locator("#recaptcha-anchor").press("Space")
        page.wait_for_timeout(300)
        assert not ticked(page) and server.challenges == 0
        assert CAPTCHA_TRY in drive.blocked()
        drive.rest()  # Claude stopped: the captcha wait, and Lisul's own click
        tick_the_box(page)
        page.wait_for_timeout(300)
        assert ticked(page) and server.challenges == 1


def test_plain_codes_account_click_goes_through_the_drive_guard_and_a_rehearsals():
    with _account_page(ACCOUNT_REGISTER) as (page, server):
        guard(page)  # the page is loaded again under it
        page.get_by_label("Email").fill("test.person@example.com")
        for box in page.locator("input[type=password]").all():
            box.fill("Pa55word!")
        drive = DriveGuard(page)
        drive.let_account_click()
        page.get_by_role("button", name="Create Account").click()
        page.wait_for_load_state()
        assert [made["email"] for made in server.created] == ["test.person@example.com"]
        assert drive.blocked() == []



def test_plain_codes_click_on_a_sign_in_button_named_submit_goes_through_a_rehearsals_guard():
    # Workday names its email Sign In's button "Submit" (Sonos's, live): Apply's own click signs in.
    with _account_page(ACCOUNT_LOGIN) as (page, server):
        guard(page)
        page.get_by_label("Email").fill("test.person@example.com")
        page.get_by_label("Password").fill("Pa55word!")
        page.evaluate("document.querySelector('#login button').textContent = 'Submit'")
        page.get_by_role("button", name="Submit").click()  # not plain code's: blocked
        page.wait_for_timeout(500)
        assert server.sign_ins == []
        page.evaluate("window.__applyAccountClick = true")
        page.get_by_role("button", name="Submit").click()
        page.wait_for_load_state()
        page.wait_for_timeout(500)
        assert len(server.sign_ins) == 1


def test_a_blocked_application_request_is_named_with_its_method_and_link():
    submit = "https://apply.workable.com/api/v1/jobs/D309E69A5B/apply"
    with FakeWorkableServer(PERRY_FORM) as fake:
        with fake.open(PERRY_URL) as page:
            drive = DriveGuard(page)
            page.evaluate(f"fetch('{submit}', {{method: 'POST', body: '{{}}'}}).catch(() => null)")
            assert drive.blocked() == [f"the application request (POST {submit})"]
        assert fake.submissions == []


def test_eightfolds_click_logging_is_not_taken_for_the_application_request():
    """Eightfold's page posts /api/user_interaction/submit as it loads (seen live on Netflix's form)."""
    with FakeWorkableServer(PERRY_FORM) as fake:
        with fake.open(PERRY_URL) as page:
            drive = DriveGuard(page)
            page.evaluate("fetch(location.origin + '/api/user_interaction/submit', {method: 'POST', body: '{}'})"
                          ".catch(() => null)")
            assert drive.blocked() == []


def test_a_post_the_pages_own_script_makes_before_any_click_is_blocked_without_a_note():
    server, url, script = FINAL_POST["greenhouse"]
    with server() as fake:
        with fake.open(url) as page:
            guard(page)
            _post(page, script)  # no click or key on the page yet: its own script (a cookie banner, analytics)
            quiet = page.locator("#apply-rehearsal-blocked").count()
            page.mouse.click(5, 5)  # a click, then a block: noted
            _post(page, script)
            shown = page.locator("#apply-rehearsal-blocked").count()
        assert fake.submissions == []
    assert (quiet, shown) == (0, 1)


def test_a_rehearsal_hides_levers_apply_with_linkedin_button_and_keeps_the_linkedin_field():
    with FakeLeverServer(IMMUTA_FORM, parse_delay=0) as fake:
        with fake.open(IMMUTA_URL) as page:
            page.evaluate("""() => { const row = document.createElement('li');
                row.className = 'application-question awli-application-row'; row.textContent = 'LinkedIn profile';
                document.body.appendChild(row); }""")
            guard(page)
            page.evaluate("""() => { const row = document.createElement('li');
                row.className = 'application-question awli-application-row'; row.textContent = 'LinkedIn profile';
                document.body.appendChild(row); }""")
            assert page.locator(".awli-application-row").first.is_hidden()
            assert page.locator("input[name='urls[LinkedIn]']").count() in (0, 1)


STEP = """<form method="post" action="/step"><input name="first" value="Test"><button>{button}</button></form>"""


@pytest.mark.parametrize("button, goes", [("Save and Continue", True), ("Submit application", False)])
def test_plain_codes_next_click_posts_a_step_but_never_a_form_that_sends(button, goes):
    # TAL.net's every page posts natively (Bank of America's, live): its Next must go on, a Submit never.
    from playwright.sync_api import sync_playwright

    posts = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        def serve(route):
            if route.request.method == "POST":
                posts.append(route.request.url)
                return route.fulfill(body="<p>Step 2</p>", content_type="text/html")
            return route.fulfill(body=STEP.format(button=button), content_type="text/html")
        page.route("https://form.example/**", serve)
        page.goto("https://form.example/step")
        guard(page)
        drive = DriveGuard(page)
        page.get_by_role("button", name=button).click()  # Claude's own click, say: blocked
        page.wait_for_timeout(300)
        assert posts == []
        drive.let_account_click()  # plain code's click on the Next Claude named
        page.get_by_role("button", name=button).click()
        page.wait_for_timeout(500)
        assert posts == (["https://form.example/step"] if goes else [])
        browser.close()


@pytest.mark.parametrize("html", [
    '<form method="post" action="/step"><input type="submit" value="Submit application" aria-label="Next"></form>',
    '<h1>Review your application</h1><form method="post" action="/step"><button>Next</button></form>',
])
def test_a_next_that_is_a_submit_or_on_a_review_page_is_never_clicked_or_let_through(html):
    # Claude names a Submit button, or the review page's button, as the step's Next: plain code refuses it.
    from playwright.sync_api import sync_playwright

    from apply.claude_fill import ClaudeFill
    from apply.model import Handoff

    posts = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        def serve(route):
            if route.request.method == "POST":
                posts.append(route.request.url)
            return route.fulfill(body=html, content_type="text/html")
        page.route("https://form.example/**", serve)
        page.goto("https://form.example/step")
        guard(page)
        filler = ClaudeFill(claude=None)
        filler._guard = DriveGuard(page)
        with pytest.raises(Handoff, match="may send the form"):
            filler._next_step(page, "Next")
        page.wait_for_timeout(300)
        assert posts == [] and page.evaluate("window.__applyAccountClick") is not True
        browser.close()


# A last step that posts natively to a job system's final application URL, behind a button that says only
# Continue. A CDP Worker has no route for these URLs (they are page URLs too), so only the in-page guard stops
# the POST. Plain code's step click (KAN-639) and a profile pop-up's click (KAN-647) must not let it through.
FINAL_POSTS = {
    "step's own form": '<form method="post" action="{action}"><input name="first"><button>Continue</button></form>',
    # A field named "action" shadows form.action: the guard reads the attribute.
    "form with an action field": '<form method="post" action="{action}"><input name="action" value="next">'
                                 '<button>Continue</button></form>',
    "script's form.submit()": '<form id="app" method="post" action="{action}"><input name="first">'
                              '<button type="button">Submit application</button></form>'
                              '<button onclick="document.getElementById(\'app\').submit()">Continue</button>',
}


def _posts_to(page, posts):
    def serve(route):
        if route.request.method == "POST":
            posts.append(route.request.url)
            return route.fulfill(body="<p>Thank you for applying</p>", content_type="text/html")
        return route.fallback()
    page.route("**/*", serve)


@pytest.mark.parametrize("shape", list(FINAL_POSTS))
@pytest.mark.parametrize("action", ["https://jobs.example.com/careers/jobs/123/apply",
                                    "https://job-boards.greenhouse.io/acme/jobs/123"])
def test_plain_codes_next_click_never_lets_a_post_to_the_final_url_through(monkeypatch, shape, action):
    from playwright.sync_api import sync_playwright

    from apply import claude_fill
    from apply.claude_fill import ClaudeFill
    from apply.model import Handoff

    monkeypatch.setattr(claude_fill, "STEP_SHOWS_MS", 1_000)
    posts = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        html = FINAL_POSTS[shape].format(action=action)
        page.route("https://jobs.example.com/careers/jobs/123/step",
                   lambda route: route.fulfill(body=html, content_type="text/html")
                   if route.request.method == "GET" else route.fallback())
        _posts_to(page, posts)
        page.goto("https://jobs.example.com/careers/jobs/123/step")
        guard(page)
        filler = ClaudeFill(claude=None)
        filler._guard = DriveGuard(page)
        with pytest.raises(Handoff, match="didn't go on"):
            filler._next_step(page, "Continue")
        page.wait_for_timeout(300)
        browser.close()
    assert posts == []


def test_a_profile_pop_ups_click_never_lets_a_post_to_the_final_url_through():
    from playwright.sync_api import sync_playwright

    posts = []
    html = ('<div role="dialog" aria-modal="true" aria-label="Create your profile">'
            '<form method="post" action="https://job-boards.greenhouse.io/acme/jobs/123"><input name="first">'
            '<button>Submit</button></form></div>')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("https://jobs.example.com/profile",
                   lambda route: route.fulfill(body=html, content_type="text/html")
                   if route.request.method == "GET" else route.fallback())
        _posts_to(page, posts)
        page.goto("https://jobs.example.com/profile")
        guard(page)
        drive = DriveGuard(page)
        drive.let_profile_click()
        page.get_by_role("button", name="Submit").click()
        page.wait_for_timeout(500)
        browser.close()
    assert posts == []
