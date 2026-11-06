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


ASK_FORM = """<!doctype html><title>Step</title><form>
  <label>GPA <input id=gpa></label><label>Password <input id=pw type=password></label>
  <input id=otp name="otp_code" aria-label="Enter it"><label>Zip code <input id=zip></label>
  <label><input id=native type=checkbox> I certify that my answers are true</label>
  <label for=forlabel>I agree to the terms of use</label><input id=forlabel type=checkbox>
  <label><input id=plain type=checkbox> New York</label>
  <div id=custom style="width:20px;height:20px" role=checkbox aria-checked=false tabindex=0 aria-label="I acknowledge the privacy notice"></div>
  <div id=wordy role=checkbox aria-checked=false tabindex=0>I certify the above</div>
  <div id=city role=checkbox aria-checked=false tabindex=0>Boston</div>
  <button type=button id=resend>Resend code</button>
</form><script>
for (const box of document.querySelectorAll('[role=checkbox]')) box.addEventListener('click', () =>
  box.setAttribute('aria-checked', box.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
document.getElementById('resend').addEventListener('click', () => { window.resent = true; });
</script>"""


@contextmanager
def _ask_page(may_tick=False):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("https://jobs.example.com/**", lambda route: route.fulfill(body=ASK_FORM, content_type="text/html"))
        page.goto("https://jobs.example.com/step")
        guard = DriveGuard(page)
        guard.arm()
        guard.asking(True, may_tick)
        yield page, guard
        browser.close()


def test_ask_s_drive_types_in_no_password_or_code_field_by_its_attributes():
    with _ask_page() as (page, guard):
        page.locator("#pw").fill("hunter2")
        page.locator("#otp").press_sequentially("123456")
        page.locator("#gpa").fill("3.7")
        page.locator("#zip").fill("11111")
        assert page.locator("#pw").input_value() == "" and page.locator("#otp").input_value() == ""
        assert page.locator("#gpa").input_value() == "3.7" and page.locator("#zip").input_value() == "11111"
        assert guard.blocked().count("typing in a password or code field") >= 2


def test_ask_s_drive_ticks_no_attestation_box_of_any_kind_and_asks_for_no_code():
    with _ask_page() as (page, guard):
        page.locator("#native").click(force=True)
        page.get_by_text("I agree to the terms of use").click()
        page.locator("#custom").click()
        page.locator("#wordy").click()
        page.locator("#resend").click()
        page.locator("#plain").click()
        page.locator("#city").click()
        assert not page.locator("#native").is_checked() and not page.locator("#forlabel").is_checked()
        assert page.locator("#custom").get_attribute("aria-checked") == "false"
        assert page.locator("#wordy").get_attribute("aria-checked") == "false"
        assert page.evaluate("window.resent") is None
        # The ordinary ones go on.
        assert page.locator("#plain").is_checked() and page.locator("#city").get_attribute("aria-checked") == "true"
        assert len(guard.blocked()) == 5


def test_ask_s_section_is_off_when_ask_claude_is_not_driving_and_holds_in_a_page_loaded_meanwhile():
    with _ask_page() as (page, guard):
        page.reload()  # going back a step loads a new document: still judged
        page.locator("#custom").click()
        assert page.locator("#custom").get_attribute("aria-checked") == "false"
        guard.asking(False)
        page.locator("#custom").click()
        assert page.locator("#custom").get_attribute("aria-checked") == "true"
        page.locator("#pw").fill("his own")
        assert page.locator("#pw").input_value() == "his own"


def test_the_read_back_sees_a_custom_box_ticked_and_undo_unticks_it():
    from apply import ask
    with _ask_page() as (page, guard):
        guard.asking(False)
        before = ask.state(page)
        page.locator("#custom").click()
        page.locator("#city").click()
        found = ask.changes(before, ask.state(page))
        assert [(c["label"], c["type"], c["now"]) for c in found] == [("I acknowledge the privacy notice", "checkbox", True),
                                                                      ("Boston", "checkbox", True)]
        assert ask._attests(found[0]) and not ask._attests(found[1])
        assert ask.undo(page, found[0]) is True
        assert page.locator("#custom").get_attribute("aria-checked") == "false"
        assert ask.changes(before, ask.state(page))[0]["label"] == "Boston"


# A form whose steps post natively, as TAL.net's do: each step's button posts to the next document. The guards
# stop Claude's own click on it (KAN-638), so plain code presses it for Ask Claude (KAN-655).
STEPS = {
    "/app/1": '<title>One</title><form method="post" action="/app/2"><label>City <input id=city name=city></label>'
              '<button>Next</button></form>',
    "/app/2": '<title>Two</title><form method="post" action="/app/1"><label>GPA <input id=gpa name=gpa></label>'
              '<button>Back</button></form><form method="post" action="/app/3"><button>Continue</button></form>',
    "/app/3": '<title>Three</title><form method="post" action="/app/apply"><label>Why <input id=why name=why></label>'
              '<button>Continue</button></form>',
    "/app/4": '<title>Four</title><form method="post" action="/app/thanks"><button>Continue</button>'
              '<button>Submit application</button></form>',
}


@contextmanager
def _steps(start):
    from playwright.sync_api import sync_playwright

    from apply.submit_guard import rearm
    posts = []

    def serve(route):
        path = route.request.url.split("example.com")[1]
        if route.request.method == "POST":
            posts.append(path)
        return route.fulfill(body=STEPS.get(path, "<p>Thank you for applying</p>"), content_type="text/html")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("https://jobs.example.com/**", serve)
        page.goto(f"https://jobs.example.com{start}")
        guard(page)
        drive = DriveGuard(page)
        lift(page)  # held for Lisul
        rearm(page)  # the Ask message: hold() puts both guards back on
        yield page, drive, posts
        browser.close()


def _asked(page, drive, message, turns):
    """ask.ask with a fake Claude that acts on the real page and says what each turn gives."""
    from types import SimpleNamespace

    from apply import ask
    from apply.adapters import Drive
    from apply.model import Posting

    turns = iter(turns)

    def act(**given):
        step, answer = next(turns)
        step(given["page"])
        return Drive(answer, 2, 100)

    return ask.ask(SimpleNamespace(drive=act), page, message, [], ask.Form(Posting(id="1", company="A", title="B", url="https://jobs.example.com")),
                   "", guard=drive)


def _said(**over):
    return {"blocked": False, "why": "", "press": "", "reply": "Done.", "changed": [], "couldnt": [], "waiting": [],
            "ticked": [], "remember": [], "apply_bug": []} | over


def test_claude_s_own_next_on_a_native_post_step_is_blocked_under_ask():
    with _steps("/app/1") as (page, drive, posts):
        drive.arm()
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(300)
        assert posts == [] and page.title() == "One" and any("form submission" in b for b in drive.blocked())


def test_ask_goes_on_and_back_on_native_post_steps_by_plain_code_s_own_click():
    with _steps("/app/1") as (page, drive, posts):
        reply = _asked(page, drive, "page 2's GPA is 3.7, then come back", [
            (lambda p: p.get_by_role("button", name="Next").click(), _said(press="Next", couldnt=["GPA: page 2 didn't open"])),
            (lambda p: p.locator("#gpa").fill("3.7"), _said(press="Back")),
            (lambda p: None, _said(reply="Set it and came back.")),
        ])
        assert posts == ["/app/2", "/app/1"] and page.title() == "One"
        assert reply.reply == "Set it and came back." and reply.couldnt == []  # Claude's blocked click isn't his to read
        assert page.evaluate("window.__applyAccountClick") is not True  # the flag is gone in the step it led to


def test_ask_s_press_never_lets_a_post_to_the_final_url_through(monkeypatch):
    from apply import claude_fill
    monkeypatch.setattr(claude_fill, "STEP_SHOWS_MS", 500)
    with _steps("/app/3") as (page, drive, posts):
        reply = _asked(page, drive, "go on", [(lambda p: None, _said(press="Continue"))])
        assert posts == [] and "didn't press 'Continue'" in reply.couldnt[0]


@pytest.mark.parametrize("named", ["Submit application", "Continue & Submit", "Finish"])
def test_ask_s_press_never_presses_what_names_a_send(named):
    with _steps("/app/4") as (page, drive, posts):
        reply = _asked(page, drive, "go on", [(lambda p: None, _said(press=named))])
        assert posts == [] and "didn't press" in reply.couldnt[0]


def test_ask_stops_pressing_at_its_cap(monkeypatch):
    from apply import ask
    monkeypatch.setattr(ask, "MAX_PRESSES", 1)
    with _steps("/app/1") as (page, drive, posts):
        _asked(page, drive, "go on", [(lambda p: None, _said(press="Next")), (lambda p: None, _said(press="Back"))])
        assert posts == ["/app/2"]


# Every step form's URL Apply has met live or saved (KAN-656), and the Next that posts from it. None may be stopped.
TAL = "https://bankcampuscareers.tal.net/vx/lang-en-GB/mobile-0/brand-4"
REAL_STEPS = {
    "TAL.net eform page": (f"{TAL}/user-1/candidate/eform/123/page/1", ""),
    "TAL.net eform's save_page": (f"{TAL}/user-1/candidate/eform/123/page/12", f' action="{TAL}/user-1/candidate/eform/123/save_page"'),
    "TAL.net's apply page": (f"{TAL}/candidate/so/pm/1/pl/1/opp/123-Intern/apply/en-GB", ""),
    "Oracle section": ("https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123/apply/section/1", ""),
    "Oracle email": ("https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123/apply/email", ""),
    "iCIMS candidate": ("https://careers-acme.icims.com/jobs/1234/software-intern/candidate?in_iframe=1", ""),
    "iCIMS questions": ("https://careers-acme.icims.com/jobs/1234/software-intern/questions?in_iframe=1", ""),
    "Workday manual": ("https://acme.wd1.myworkdayjobs.com/en-US/External/job/Intern_R1/apply/applyManually", ""),
    "Microsoft job": ("https://apply.careers.microsoft.com/careers/job/1970393556625703", ""),
    # A path ending in /apply, final by its name alone: a page that says steps remain.
    "/apply, Step 2 of 5": ("https://jobs.example.com/acme/apply", "", "<p>Step 2 of 5</p>"),
    "/apply?pid, Step 1 of 3": ("https://acme.eightfold.ai/careers/apply?pid=1", "", "<p>STEP 1 / 3</p>"),
    "/apply, step list": ("https://jobs.example.com/acme/apply", "",
                          '<ol><li><a aria-current="step">You</a></li><li>Questions</li></ol>'),
}
REAL_SENDS = {
    "no word of steps": ("https://jobs.example.com/acme/apply", "", ""),
    "last step": ("https://jobs.example.com/acme/apply", "", "<p>Step 5 of 5</p>"),
    "the step list's last": ("https://jobs.example.com/acme/apply", "", '<ol><li>You</li><li><a aria-current="step">Questions</a></li></ol>'),
    "a Submit beside it": ("https://jobs.example.com/acme/apply", "", "<p>Step 2 of 5</p>", "<button>Submit application</button>"),
    "action to /apply": ("https://jobs.example.com/acme/start", ' action="/acme/apply"', ""),
    # Known final URLs: what the page says never lets them through. Lever's real form has no action.
    "Lever's own": ("https://jobs.lever.co/acme/b9b21075-74a4-4b64-8f1b-f0be1fb0b24d/apply", "", "<p>Step 1 of 2</p>"),
    "Greenhouse's own": ("https://job-boards.greenhouse.io/acme/jobs/123", "", "<p>Step 1 of 2</p>"),
    "a submit in its path": ("https://jobs.example.com/acme/submitApplication", "", "<p>Step 1 of 2</p>"),
}


def _step_on(url, action="", before="", more=""):
    return f'{before}<form method="post"{action}><input name="first"><button>Continue</button>{more}</form>'


def _press_next(url, html):
    from playwright.sync_api import sync_playwright

    from apply import claude_fill
    posts = []

    def serve(route):
        if route.request.method == "POST":
            posts.append(route.request.url)
            return route.fulfill(body="<input name=next>", content_type="text/html")
        return route.fulfill(body=html, content_type="text/html")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route(lambda url: True, serve)  # every request: no real site is ever reached
        page.goto(url)
        guard(page)
        drive = DriveGuard(page)
        try:
            claude_fill.press_step(page, drive, "Continue")
        except claude_fill.Handoff:
            pass
        page.wait_for_timeout(300)
        browser.close()
    return posts


@pytest.mark.parametrize("name", list(REAL_STEPS))
def test_plain_codes_next_goes_on_from_every_real_step_form(monkeypatch, name):
    from apply import claude_fill
    monkeypatch.setattr(claude_fill, "STEP_SHOWS_MS", 2_000)
    url, *rest = REAL_STEPS[name]
    assert len(_press_next(url, _step_on(url, *rest))) == 1


@pytest.mark.parametrize("name", list(REAL_SENDS))
def test_plain_codes_next_never_posts_what_may_be_the_last_step(monkeypatch, name):
    from apply import claude_fill
    monkeypatch.setattr(claude_fill, "STEP_SHOWS_MS", 800)
    url, *rest = REAL_SENDS[name]
    assert _press_next(url, _step_on(url, *rest)) == []


@pytest.mark.parametrize("name", [n for n in REAL_STEPS if "/apply" not in n])
def test_the_plain_rules_stop_no_real_step_url(name):
    from apply.plain import guards as plain
    url, action, *_ = REAL_STEPS[name]
    target = action.split('"')[1] if action else url
    assert not plain.PATTERN.search(target), target


PROFILE = """<div role="dialog" aria-label="Create your profile"><form method="post"{action}><input name="first">
<button>Submit</button></form></div>"""


@pytest.mark.parametrize(("url", "action", "goes"), [
    ("https://acme.eightfold.ai/careers/apply?pid=1", "", True),
    ("https://acme.eightfold.ai/careers/apply?pid=1", ' action="/careers/apply"', False),
    ("https://jobs.lever.co/acme/b9b21075-74a4-4b64-8f1b-f0be1fb0b24d/apply", "", False),
])
def test_a_profile_pop_up_posts_to_its_own_page_but_never_to_a_final_url(url, action, goes):
    from playwright.sync_api import sync_playwright
    posts = []

    def serve(route):
        if route.request.method == "POST":
            posts.append(route.request.url)
        return route.fulfill(body=PROFILE.format(action=action), content_type="text/html")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route(lambda url: True, serve)  # every request: no real site is ever reached
        page.goto(url)
        guard(page)
        drive = DriveGuard(page)
        drive.let_profile_click()
        page.get_by_role("button", name="Submit").click()
        page.wait_for_timeout(400)
        browser.close()
    assert bool(posts) is goes


# A one-page application that makes an account as it applies: a password box, and a Continue bound for the
# final URL (KAN-681). The account click lets a sign-in post; it must never let this one.
MAKES_AN_ACCOUNT = """<form method="post" action="{action}"><label>Email <input name="email"></label>
<label>Password <input type="password" name="pw"></label><button>Continue</button></form>"""


@pytest.mark.parametrize("action", ["https://jobs.example.com/careers/jobs/123/apply",
                                    "https://job-boards.greenhouse.io/acme/jobs/123"])
@pytest.mark.parametrize("by", ["press_step", "the account click", "a script's form.submit()"])
def test_an_application_with_a_password_box_never_posts_under_the_account_click(monkeypatch, action, by):
    from playwright.sync_api import sync_playwright

    from apply import claude_fill

    monkeypatch.setattr(claude_fill, "STEP_SHOWS_MS", 800)
    posts = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("https://jobs.example.com/careers/jobs/123/start",
                   lambda route: route.fulfill(body=MAKES_AN_ACCOUNT.format(action=action), content_type="text/html")
                   if route.request.method == "GET" else route.fallback())
        _posts_to(page, posts)
        page.goto("https://jobs.example.com/careers/jobs/123/start")
        guard(page)
        drive = DriveGuard(page)
        if by == "press_step":
            try:
                claude_fill.press_step(page, drive, "Continue")
            except claude_fill.Handoff:
                pass
        else:
            drive.let_account_click()
            if by == "the account click":
                page.get_by_role("button", name="Continue").click()
            else:
                page.evaluate("document.querySelector('form').submit()")
        page.wait_for_timeout(500)
        browser.close()
    assert posts == []


def test_a_sign_in_with_a_password_box_still_posts_under_the_account_click():
    from playwright.sync_api import sync_playwright

    posts = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("https://jobs.example.com/login",
                   lambda route: route.fulfill(body=MAKES_AN_ACCOUNT.format(action="/session"), content_type="text/html")
                   if route.request.method == "GET" else route.fallback())
        _posts_to(page, posts)
        page.goto("https://jobs.example.com/login")
        guard(page)
        drive = DriveGuard(page)
        drive.let_account_click()
        page.get_by_role("button", name="Continue").click()
        page.wait_for_timeout(500)
        browser.close()
    assert posts == ["https://jobs.example.com/session"]


# A sign-in relay that posts itself as it loads (Amazon's idp.federate "Signing you in...", live 2026-11-06):
# hidden fields only, a Continue for a page whose script didn't run, bound for no final URL.
SIGN_IN_RELAY = """<p>Signing you in...</p><form method="post" action="{action}">{fields}
<input type="hidden" name="id_token" value="t"><input type="hidden" name="state" value="s">
<button>{button}</button></form><script>{post}</script>"""


@pytest.mark.parametrize("post", ["document.forms[0].submit()", "document.forms[0].requestSubmit()"])
@pytest.mark.parametrize("action, fields, button, through", [
    ("https://jobs.example.com/auth/callback", "", "Continue", True),
    ("https://jobs.example.com/careers/jobs/123/apply", "", "Continue", False),  # bound for a final URL
    ("https://jobs.example.com/auth/callback", '<input name="email">', "Continue", False),  # a field to fill
    ("https://jobs.example.com/auth/callback", "", "Submit", False),  # a button that sends
])
def test_a_sign_in_relay_posts_itself_through_the_drive_guard(post, action, fields, button, through):
    from playwright.sync_api import sync_playwright

    relay = "https://idp.example.com/api/v1/intermediate?id_token=t&state=s"
    posts = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route(relay, lambda route: route.fulfill(
            body=SIGN_IN_RELAY.format(action=action, fields=fields, button=button, post=post), content_type="text/html"))
        _posts_to(page, posts)
        drive = DriveGuard(page)
        page.goto(relay)
        page.wait_for_timeout(500)
        blocked = drive.blocked()
        browser.close()
    assert posts == ([action] if through else [])
    assert bool(blocked) is not through


# LinkedIn's Apply with LinkedIn widget on Microsoft's form (Eightfold, live 2026-11-06, KAN-711): its xdoor SDK
# makes an iframe named for itself, then posts a form of hidden fields into it with form.submit(), as the form
# loads and after the page's "Apply now" click.
WIDGET_FRAME = """<form id="application"><input name="first"><button type="submit">Submit application</button></form>
<button id="go">Apply now</button><div style="display:none"><iframe name="{frame}" id="{frame}"></iframe></div>
<script>
document.getElementById('go').addEventListener('click', () => setTimeout(() => {{
  const form = document.createElement('form');
  form.method = 'POST'; form.action = '{action}'; form.target = '{target}';
  form.innerHTML = '{fields}<input type="hidden" name="api_key" value="k"><input type="hidden" name="xdOrigin" value="o">{button}';
  document.body.appendChild(form);
  form.submit();
}}, 10));
</script>"""


@pytest.mark.parametrize("action, target, fields, button, through", [
    ("https://www.linkedin.com/talentwidgets/apply-with-linkedin", "li-1", "", "", True),
    ("https://www.linkedin.com/talentwidgets/apply-with-linkedin", "", "", "", False),  # no frame: the page goes
    ("https://www.linkedin.com/talentwidgets/apply-with-linkedin", "_blank", "", "", False),
    ("https://www.linkedin.com/talentwidgets/apply-with-linkedin", "nowhere", "", "", False),  # names no iframe
    ("https://jobs.example.com/widget", "li-1", "", "", False),  # the page's own site
    ("https://www.linkedin.com/talentwidgets/apply-with-linkedin", "li-1", '<input name="email">', "", False),
    ("https://ats.example.net/api/application/v2/submit", "li-1", "", "", False),  # a final URL
    ("https://www.linkedin.com/talentwidgets/apply-with-linkedin", "li-1", "", "<button>Submit</button>", False),
])
def test_a_widget_loading_into_its_own_frame_goes_through_the_drive_guard(action, target, fields, button, through):
    from playwright.sync_api import sync_playwright

    url = "https://jobs.example.com/careers/apply?pid=1"
    posts = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route(url, lambda route: route.fulfill(body=WIDGET_FRAME.format(
            frame="li-1", action=action, target=target, fields=fields, button=button), content_type="text/html"))
        _posts_to(page, posts)
        drive = DriveGuard(page)
        page.goto(url)
        page.click("#go")  # a real click first, as Claude's "Apply now": the relay exemption no longer holds
        page.wait_for_timeout(500)
        page.click("button[type=submit]")  # the application's own Submit stays blocked
        page.wait_for_timeout(300)
        blocked = drive.blocked()
        browser.close()
    assert posts == ([action] if through else [])
    assert ('the "Submit application" click' in blocked) and (("a form submission" in blocked) is not through)
