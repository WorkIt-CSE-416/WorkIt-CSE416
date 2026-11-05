"""The submit guard: an in-page script on every rehearsal page, and a
Playwright route under it, the second line of defence behind a rehearsal
never calling a Filler's submit (it also stops Claude fill, which drives the
page itself, from sending a form).

It runs mostly in the page: a Python route handler can't answer while the
Worker's thread waits on `claude -p`, so a route would hold every request of
a page Claude drives. In each frame, before the page's own code, it blocks:

- a click on a button whose words send: submit, send, finish or complete
  anywhere in them ("Review and Submit", "Continue & Submit", "Complete
  application"), or apply on a form's button ("Apply"; a job page's Apply
  link that opens the form is no form's). Workday's Review Submit has no
  known endpoint, so this is its guard; every Filler's submit is such a
  click;
- a POST form's native submission (`form.submit()`, or a submit event's
  default action; the page's own submit handlers still run, so a "Next"
  that saves a step goes on);
- a submit event, page handlers and all, from a Submit/Send button, or with
  no button (a script's `requestSubmit()`, a page's own Enter key) from a form
  that has one: a form whose script sends the application itself;
- the final application request of each job system, by fetch (a Request
  object's body read too), XHR or beacon:
  Greenhouse `POST <board>/jobs/<id>`, Lever `POST .../<posting>/apply`,
  Ashby's `ApiSubmit...` mutation, BambooHR `POST /careers/<id>/add`,
  Workable `POST /api/v1/jobs/<shortcode>/apply`, Jobvite
  `POST <company>/job/<id>/submitApplication` (Enter in any field of its last
  step sends it, which the click guard alone can't stop), and on any job
  system (Claude fill's above all) a non-GET whose path ends in `/apply` or
  has a segment that names a submit (`/submit/123` too).

A worker (dedicated, shared or service) runs none of the page's script, so
the route stops its requests: a non-GET whose URL names a submit (ROUTED) is
aborted, from the page or any worker. Only those URLs are routed, matched
by Playwright itself, so every other request goes straight through even
while the Worker's thread is in `claude -p`; one that matches waits there
until the thread is back, unsent, then is aborted (a GET goes on then). A
page URL (Greenhouse's posting, Lever's and Jobvite's `/apply`) is never
routed, so a page Claude opens doesn't wait.

Everything else goes through: résumé uploads, Ashby's per-answer saves,
Lever's résumé parse, Workday's Save and Continue, a Next that saves its
step. A blocked attempt shows a small "Apply rehearsal" note on the page,
once the page has had a click or key: one its own script makes first (a
cookie banner, analytics) is blocked without one.

The drive guard (DriveGuard) is the same script on every page Claude fill
drives, in a live run too, so Haiku can't send the form though its prompt
fails: it also blocks a sign-in other than Google's (another site's, and a
sign-in or create-account form's own button or submission), a payment,
withdrawing or deleting the application, account or profile (a file's
Delete goes on), ticking an opt-in to texts or marketing, and, while Claude
drives, every click, tap or key in a captcha's own frame (an "I'm not a
robot" box, its picture challenge): Apply never touches a captcha, and
Lisul's own clicks there go through once Claude stops. Unlike the
rehearsal's, it is lifted for Claude fill's own submit click, and says what
it blocked, so Claude fill makes a blocked attempt a Handoff (but for a
click on the submit button Claude names on the form's last step: nothing
went, and the form is left filled). Plain code's
click on a sign-in or account page's button (apply.account_pages) goes
through it, and that button's POST form through a rehearsal's guard too; a
button that sends and the application request stay blocked. On a rehearsal's page it hears what
the rehearsal's guard blocked too, so a click Claude makes there that would
send the form is the same Handoff, and still sends nothing.

Once a rehearsed link has ended, its page is held open for Lisul and lift()
takes both guards off: Apply no longer drives it, so his own Submit goes
through, and a green note says so, with a Fill again button. The page tells
Apply when he clicks a button that sends, so a rehearsal can keep his
submission in the Tracker. A rehearsal paused mid-form is lifted the same
way while Lisul fixes its page; Resume puts both guards back on with
rearm(), without a reload, so his fixes stay, before Apply drives it again."""

import json
import re
from collections.abc import Callable

from playwright.sync_api import Page, Route

from apply import captcha

# The final requests the route stops, from the page or a worker: a path segment that names a
# submit (Jobvite's .../submitApplication among them), Ashby's ApiSubmit, BambooHR's and Workable's.
ROUTED = re.compile(
    r"^https?://[^/?#]+/(?:[^?#]*/)?[^/?#]*submit[^/?#]*(?:[/?#].*)?$"
    r"|^https?://[^/?#]*ashbyhq\.com/.*[?&]op=ApiSubmit"
    r"|^https?://[^/?#]*bamboohr\.com/careers/\d+/add/?(?:[?#].*)?$"
    r"|^https?://apply\.workable\.com/api/v1/jobs/\w+/apply/?(?:[?#].*)?$",
    re.IGNORECASE,
)

_TEMPLATE = r"""
(() => {
  if (window.__@KEY@Guard) return;
  // A captcha's own frame is Lisul's to do (apply.captcha): nothing in it is the application.
  const host = location.hostname, path = location.pathname;
  if (@CAPTCHA_HOSTS@.some((h) => host === h || host.endsWith('.' + h)) || @CAPTCHA_PATHS@.some((p) => path.startsWith(p))) {
@CAPTCHA@
    return;
  }
  window.__@KEY@Guard = true;
  const lifted = () => @LIFTED@;
  // Plain code's click on the button Claude fill named on a sign-in or account page.
  const accountClick = () => window.__applyAccountClick === true;
  // A sign-in or new account's form: one with a password box, which no application's final button is in.
  const accountForm = (el) => {
    const form = el.form || (el.closest && el.closest('form'));
    return !!form && !!form.querySelector('input[type=password]');
  };
  const FINAL_URLS = [
    /^https?:\/\/[^\/]*greenhouse\.io\/(?:embed\/job_app|[^\/?#]+\/jobs\/\d+\/?(?:[?#].*)?$)/i,
    /^https?:\/\/jobs\.lever\.co\/[^\/]+\/[0-9a-f-]{36}\/apply\/?(?:[?#].*)?$/i,
    /^https?:\/\/[^\/]*ashbyhq\.com\/.*[?&]op=ApiSubmit/i,
    /^https?:\/\/[^\/]*bamboohr\.com\/careers\/\d+\/add\/?(?:[?#].*)?$/i,
    /^https?:\/\/apply\.workable\.com\/api\/v1\/jobs\/\w+\/apply\/?(?:[?#].*)?$/i,
    // Any job system's, Jobvite's .../submitApplication among them: a path ending in .../apply,
    // or with a segment that names a submit anywhere in it (.../submit/123).
    /^https?:\/\/[^\/?#]+\/(?:[^?#]*\/)?[^\/?#]*submit[^\/?#]*(?:[\/?#].*)?$/i,
    /^https?:\/\/[^\/?#]+\/(?:[^?#]*\/)?apply\/?(?:[?#].*)?$/i,
  ];
  // A page's own click logging, which the any-job-system rules above would take for its submit:
  // Eightfold's (Netflix, Lockheed Martin) sends POST /api/user_interaction/submit as each page loads.
  const NOT_FINAL = [/^https?:\/\/[^\/?#]+\/api\/user_interaction\//i];
  const FINAL_BODIES = [/"operationName"\s*:\s*"ApiSubmit/];
  const SENDS = /\b(submit|send|finish|complete)\b/i;
  const APPLY = /\bapply\b/i;
  const blocked = window.__@KEY@Blocked = [];
  let touched = false;  // a real click or key on the page: Apply's or Lisul's
  for (const kind of ['pointerdown', 'keydown']) addEventListener(kind, (event) => { if (event.isTrusted) touched = true; }, true);
  const note = (what) => {
    blocked.push(what);
    console.warn('@NAME@ blocked ' + what);
    // The page's own script, with no click or key on it yet (a cookie banner, analytics): blocked, unshown.
    if (!touched) return;
    try {
      let box = document.getElementById('@BOX@');
      if (!box) {
        box = document.createElement('div');
        box.id = '@BOX@';
        // Under a captcha's challenge (reCAPTCHA's is z-index 2000000000), so its Verify stays pressable.
        box.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:1999999999;padding:6px 10px;'
          + 'background:#b00020;color:#fff;font:13px sans-serif;border-radius:4px;pointer-events:none';
        (document.body || document.documentElement).appendChild(box);
      }
      box.textContent = '@NAME@: blocked ' + what + '. Nothing was sent.';
    } catch (e) {}
  };
  const isFinal = (method, url, body) => {
    if (lifted()) return false;
    if (/^(GET|HEAD|OPTIONS)$/i.test(method || 'GET')) return false;
    let href = String(url);
    try { href = new URL(href, location.href).href; } catch (e) {}
    if (NOT_FINAL.some(r => r.test(href))) return false;
    return FINAL_URLS.some(r => r.test(href)) || (typeof body === 'string' && FINAL_BODIES.some(r => r.test(body)));
  };

  const wordsOf = (el) => [el.innerText, el.value, el.getAttribute('aria-label')]
    .filter(w => typeof w === 'string' && w.trim())[0] || '';
  // A button that sends: its words say so, or say apply on a form's button (a job page's Apply link is no form's).
  const sends = (el) => {
    const words = wordsOf(el);
    return SENDS.test(words) || (APPLY.test(words) && !!(el.form || (el.closest && el.closest('form'))));
  };

  // Clicks on a submit button, before any of the page's handlers.
  window.addEventListener('click', (event) => {
    const target = event.target && event.target.closest
      && event.target.closest('button, input[type=submit], input[type=button], [role=button], a');
    if (!target) return;
    if (lifted()) {  // Lisul's page: his click goes through, and Apply hears of one that sends
      if (sends(target) && window.__applyLisulPressed) window.__applyLisulPressed(wordsOf(target).trim().slice(0, 80));
      return;
    }
    if (!sends(target)) return;
    // Plain code's own click on an account form's button: Workday names its button "Submit" in its
    // Sign in with email view (Sonos's, live), and that click only signs in.
    if (accountClick() && accountForm(target)) return;
    const words = wordsOf(target);
    event.preventDefault();
    event.stopImmediatePropagation();
    note('the "' + words.trim().slice(0, 40) + '" click');
  }, true);
@EXTRA@

  // Native submission of a POST form.
  const posts = (form, submitter) => {
    const method = (submitter && submitter.getAttribute && submitter.getAttribute('formmethod')) || form.getAttribute('method') || 'get';
    return method.toLowerCase() === 'post';
  };
  // A submit that would send the application (by its Submit/Send button, or with no
  // button, as a script's requestSubmit() or a page's own Enter key does, from a form
  // that has one) reaches none of the page's handlers. A "Next" goes on.
  window.addEventListener('submit', (event) => {
    if (lifted()) return;
    const form = event.target, by = event.submitter;
    if (accountClick() && form.querySelector('input[type=password]')) return;  // plain code's sign-in, as above
    const final = by ? sends(by)
      : [...form.querySelectorAll('button, input[type=submit]')].some(sends);
    if (final) event.stopImmediatePropagation();
    if (final || (posts(form, by) && !accountClick())) { event.preventDefault(); note('a form submission'); }
  }, true);
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (!lifted() && !accountClick() && posts(this)) return note('a form submission');
    return submit.call(this);
  };

  // The final application request.
  const fetch = window.fetch;
  // Named with its method and link, so a Handoff (and the Trace) says which request it was.
  const named = (method, url) => 'the application request (' + String(method || 'POST').toUpperCase() + ' ' + String(url).slice(0, 160) + ')';
  const refused = (method, url) => (note(named(method, url)), Promise.reject(new TypeError('Blocked by the @NAME@')));
  window.fetch = function (input, init) {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : input;
    const method = (init && init.method) || (request ? request.method : 'GET');
    const body = init && init.body !== undefined && init.body !== null ? init.body : null;
    if (isFinal(method, url, typeof body === 'string' ? body : body instanceof URLSearchParams ? String(body) : null)) {
      return refused(method, url);
    }
    // A body that isn't text yet (a Request's, a Blob) is read first: Ashby's submit is named only there.
    if (!/^(GET|HEAD|OPTIONS)$/i.test(method) && (body ? body instanceof Blob : request)) {
      const args = arguments, self = this;
      return (body ? body.text() : request.clone().text()).catch(() => '')
        .then(text => isFinal(method, url, text) ? refused(method, url) : fetch.apply(self, args));
    }
    return fetch.apply(this, arguments);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__applyRequest = [method, url];
    return open.apply(this, arguments);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const [method, url] = this.__applyRequest || [];
    if (isFinal(method, url, body)) {
      note(named(method, url));
      throw new DOMException('Blocked by the @NAME@', 'NetworkError');
    }
    return send.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => isFinal('POST', url, data) ? (note(named('POST', url)), false) : beacon(url, data);
  }
})();
"""


# What else the drive guard blocks, while Claude drives: a sign-in other than Google's, a payment,
# a withdraw or delete of the application, account or profile, and ticking an opt-in to texts or
# marketing while Lisul's sms_opt_in or marketing_opt_in policy says no (the planner's questions
# of those policies; unticking one goes on).
_CONTROLS = r"""
  const CONTROLS = new RegExp([
    String.raw`\b(?:sign\s*in|log\s*in|login|sign\s*up|register|continue|apply|connect)\s+(?:with|using|via|through)\s+`
      + String.raw`(?:linkedin|facebook|apple|github|microsoft|outlook|twitter|x|indeed|glassdoor|amazon|yahoo|seek)\b`,
    String.raw`^\s*pay\s*$|\bpay\s+(?:now|with|by|\$|\d)|\b(?:payment|purchase|checkout)\b`,
    // A withdraw, delete or remove of the application, account or profile ("Delete my account"); a file
    // upload's Delete, Remove or × goes on, so Claude can replace a wrong file.
    String.raw`\b(?:withdraw|delete|remove)\b(?:\s+\S+){0,2}?\s+(?:application|account|profile|candidacy)s?\b`,
  ].join('|'), 'i');
  const OPT_INS = [
    [/\bsms\b|text messages?|\btext me\b|whatsapp/i, @SMS_OPT_IN@],
    [/marketing|newsletter|job alerts|talent (?:community|network)|advertis|subscribe/i, @MARKETING_OPT_IN@],
  ].filter(([, yes]) => !yes).map(([words]) => words);
  const optIn = (words) => OPT_INS.some(r => r.test(words));
  const BOX = 'input[type=checkbox], [role=checkbox], [role=switch]';
  const boxWords = (el) => [...(el.labels || [])].map(l => l.innerText).join(' ').trim()
    || el.getAttribute('aria-label') || ((el.closest('label') || el.parentElement || {}).innerText || '');
  window.addEventListener('click', (event) => {
    const el = event.target && event.target.closest
      && event.target.closest(BOX + ', button, input[type=submit], input[type=button], [role=button], a');
    if (!el || lifted()) return;
    const box = el.matches(BOX);
    const words = box ? boxWords(el) : wordsOf(el);
    // A checkbox's click has ticked it already; a role=checkbox's has yet to.
    const ticks = box && (el.type === 'checkbox' ? el.checked : el.getAttribute('aria-checked') !== 'true');
    if (box ? !(ticks && optIn(words)) : !(CONTROLS.test(words) || (signsIn(el) && !accountClick()))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    note('the "' + words.trim().slice(0, 40) + '" click');
  }, true);
  // A sign-in or new account's own button, or its form sent another way (Enter): plain code's alone.
  const signsIn = (el) => {
    const form = el.form || (el.closest && el.closest('form'));
    return !!form && !el.matches('a') && !!form.querySelector('input[type=password]');
  };
  window.addEventListener('submit', (event) => {
    if (lifted() || accountClick() || !event.target.querySelector('input[type=password]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    note('a sign-in');
  }, true);
"""


# The drive guard in a captcha's own frame: while Claude drives (DriveGuard.arm), every click, tap and key
# there is refused before the captcha's own code hears it, so Claude never ticks, types in or solves one.
# Lisul's own clicks go through once Claude stops (DriveGuard.rest), for the captcha wait.
CAPTCHA_TRY = "a click or key in a captcha"
_IN_CAPTCHA = r"""
    if (window.__applyDriveCaptchaGuard) return;
    window.__applyDriveCaptchaGuard = true;
    const refuse = (event) => {
      if (window.__applyDriveLifted === true || window.__applyDriving !== true || !event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerdown' || event.type === 'keydown') console.warn('Apply drive guard blocked @TRY@');
    };
    for (const kind of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick',
                        'touchstart', 'touchend', 'keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'paste']) {
      addEventListener(kind, refuse, true);
    }
"""


def _script(key: str, name: str, lifted: str = "false", extra: str = "", in_captcha: str = "") -> str:
    """The guard's script under its own `window.__<key>Guard`, so two guards
    can share a page, naming itself `name` in the note on what it blocked:
    off while the JS `lifted` is true, and blocking `extra`'s controls too;
    `in_captcha` runs in a captcha's own frame, which the guard leaves alone."""
    box = name.lower().replace(" ", "-") + "-blocked"
    script = _TEMPLATE
    for placeholder, value in {"@KEY@": key, "@NAME@": name, "@BOX@": box, "@LIFTED@": lifted, "@EXTRA@": extra,
                               "@CAPTCHA@": in_captcha, "@CAPTCHA_HOSTS@": json.dumps(captcha.HOSTS),
                               "@CAPTCHA_PATHS@": json.dumps(captcha.PATHS)}.items():
        script = script.replace(placeholder, value)
    return script


# Lever's Apply with LinkedIn button never loads in a Worker's Chrome and spins on
# "Loading..." the whole rehearsal; Apply never uses it (it fills the LinkedIn URL field).
HIDE_LINKEDIN_BUTTON = r"""
(() => {
  const style = document.createElement('style');
  style.textContent = '.awli-application-row { display: none !important; }';
  const add = () => (document.head || document.documentElement).appendChild(style);
  document.head ? add() : document.addEventListener('DOMContentLoaded', add);
})();
"""

# Lifted once the page is Lisul's (lift()).
SCRIPT = _script("applyRehearsal", "Apply rehearsal", lifted="window.__applyRehearsalLifted === true") \
    + HIDE_LINKEDIN_BUTTON


def drive_script(sms_opt_in: bool = False, marketing_opt_in: bool = False) -> str:
    """The drive guard's script, letting through ticking an opt-in to texts or
    marketing that Lisul's policy says yes to."""
    controls = _CONTROLS.replace("@SMS_OPT_IN@", _js(sms_opt_in)).replace("@MARKETING_OPT_IN@", _js(marketing_opt_in))
    return _script("applyDrive", "Apply drive guard", lifted="window.__applyDriveLifted === true", extra=controls,
                   in_captcha=_IN_CAPTCHA.replace("@TRY@", CAPTCHA_TRY))


def _js(yes: bool) -> str:
    return "true" if yes else "false"


DRIVE_BLOCKED = "Apply drive guard blocked "  # how the drive guard tells what it blocked, on the page's console
# What the drive guard hears on the page's console: its own blocks, and a rehearsal guard's, which
# stops Claude's click on a button that sends before the drive guard sees it.
HEARD = (DRIVE_BLOCKED, "Apply rehearsal blocked ")


def guard(page: Page) -> None:
    """Put the guard on an open page, every page its context opens later and
    all their workers. The page is loaded again under it, so the guard runs
    before the page's own code."""
    page.context.route(ROUTED, _refuse)
    page.context.add_init_script(SCRIPT)
    # Its document is enough: a page whose last tracker never loads (Scale AI's, Coinbase's, live) would time out.
    page.reload(wait_until="domcontentloaded")


# Marks a page Lisul's: the guard script above lets everything through on it,
# and a note says so, with a button to fill the form again when `again` is set
# and a × that hides the note on that page.
LIFTED = r"""
(() => {
  window.__applyRehearsalLifted = true;
  window.__applyDriveLifted = true;  // Claude fill's guard too, if it drove the page
  const again = AGAIN;
  const warning = WARNING;  // what Apply found wrong on the form, for Lisul to fix before he submits
  const wrong = WRONG;  // red when an answer is wrong; amber when only a field is left blank
  const show = () => {
    const box = document.getElementById('apply-rehearsal-blocked') || document.createElement('div');
    box.id = 'apply-rehearsal-blocked';
    // Under a captcha's challenge (reCAPTCHA's is z-index 2000000000), so its Verify stays pressable.
    box.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:1999999999;padding:6px 10px;max-width:480px;'
      + 'background:' + (!warning ? '#1b5e20' : wrong ? '#b00020' : '#8a5a00') + ';color:#fff;font:13px sans-serif;border-radius:4px;'
      + 'pointer-events:none';
    box.textContent = warning
      ? 'Apply rehearsal: ' + (wrong ? 'fix this before you submit. ' : 'check before you submit. ') + warning
      : 'Apply rehearsal: Apply is done with this page. Check it; Submit is yours to press.';
    if (again) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Fill again';
      button.style.cssText = 'margin-left:8px;pointer-events:auto;cursor:pointer;font:13px sans-serif';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (window.__applyFillAgain) window.__applyFillAgain();
      });
      box.appendChild(button);
    }
    const close = document.createElement('button');  // hides the note on this page; a page loaded next shows it
    close.type = 'button';
    close.textContent = '\u00d7';
    close.setAttribute('aria-label', 'Hide this note');
    close.style.cssText = 'margin-left:8px;pointer-events:auto;cursor:pointer;font:13px sans-serif;'
      + 'background:none;border:none;color:#fff;padding:0 2px';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      box.style.display = 'none';
    });
    box.appendChild(close);
    if (!box.parentNode) (document.body || document.documentElement).appendChild(box);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
"""


def lift(page: Page, pressed: Callable[[str], None] | None = None, again: Callable[[], None] | None = None,
         warning: str = "", wrong: bool = True, bound: bool = False) -> None:
    """Hand a guarded page to Lisul once Apply is done with it: no Filler or
    Claude drives it any more, so a Submit on it can only be his, and it goes
    through, on this page and every page he loads from it. `pressed` hears
    the words of each button he clicks that sends; `again`, when he presses
    the note's Fill again. Both are called on the page's own thread. A
    `warning` goes on the note, red when an answer is `wrong`, amber when
    it only names fields left blank. `bound`: the page was lifted before
    (a paused rehearsal, resumed), so its bindings are there already, and
    its note keeps the Fill again button."""
    if bound:
        pressed = again = None
    if pressed:
        page.expose_binding("__applyLisulPressed", lambda source, words: pressed(words))
    if again:
        page.expose_binding("__applyFillAgain", lambda source: again())
    page.context.unroute(ROUTED, _refuse)
    script = LIFTED.replace("AGAIN", "true" if again or bound else "false").replace("WRONG", "true" if wrong else "false")
    script = script.replace("WARNING", json.dumps(warning))  # last: the warning's own words stay as they are
    page.context.add_init_script(script)
    for frame in page.frames:
        try:
            frame.evaluate(script)
        except Exception:
            pass  # a frame gone or going: one loaded later gets the init script


# Undoes LIFTED on a page that Apply drives again (Resume): the guards are on, and the note is gone.
REARMED = r"""
(() => {
  window.__applyRehearsalLifted = false;
  window.__applyDriveLifted = false;
  const drop = () => { const box = document.getElementById('apply-rehearsal-blocked'); if (box) box.remove(); };
  if (document.body) drop(); else document.addEventListener('DOMContentLoaded', drop);
})();
"""


def rearm(page: Page) -> None:
    """Put the guard back on a page lift() handed to Lisul, for Resume: Apply
    drives it again. No reload, so what he typed on the page stays; a page
    loaded from it later is guarded too (after lift's script, this one runs)."""
    page.context.route(ROUTED, _refuse)
    page.context.add_init_script(REARMED)
    for frame in page.frames:
        try:
            frame.evaluate(REARMED)
        except Exception:
            pass  # a frame gone or going: one loaded later gets the init script


def renote(page: Page, warning: str = "", wrong: bool = True) -> None:
    """Say the note of a page already lifted anew: Lisul answered in the window
    what it said was left blank. Its Fill again button stays. A page still
    guarded (one Lisul already applied to, KAN-621) stays guarded."""
    script = LIFTED.replace("AGAIN", "true").replace("WRONG", "true" if wrong else "false")
    script = script.replace("WARNING", json.dumps(warning))
    script = f"if (window.__applyRehearsalLifted === true) {script}"
    page.context.add_init_script(script)  # after lift's: a page loaded from it says the same
    for frame in page.frames:
        try:
            frame.evaluate(script)
        except Exception:
            pass


# The note on a held page of a Posting Lisul already applied to (`apply rehearse --force`, KAN-621). The guard
# stays on under it, so Submit is blocked, until he dismisses it with two presses: the first asks, the second
# calls __applyDismissApplied, and hold() then lifts the guard. A page loaded after that shows no note.
APPLIED_NOTE = r"""
(() => {
  const day = DAY;
  const show = () => {
    if (window !== window.top || window.__applyAppliedDismissed || document.getElementById('apply-already-applied')) return;
    const box = document.createElement('div');
    box.id = 'apply-already-applied';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:1999999999;'
      + 'padding:10px 14px;max-width:560px;background:#b00020;color:#fff;font:bold 15px sans-serif;'
      + 'border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    const words = document.createElement('span');
    words.textContent = 'You already applied on ' + day + ', don’t submit. Apply keeps Submit blocked on this page.';
    box.appendChild(words);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Dismiss';
    button.style.cssText = 'margin-left:10px;cursor:pointer;font:13px sans-serif';
    let asked = false;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!asked) {
        asked = true;
        button.textContent = 'Yes, I\u2019m sure: unblock this page';  // no word the guard blocks (submit, send...)
        return;
      }
      window.__applyAppliedDismissed = true;
      box.remove();
      if (window.__applyDismissApplied) window.__applyDismissApplied();
    });
    box.appendChild(button);
    (document.body || document.documentElement).appendChild(box);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
"""


def warn_applied(page: Page, day: str, dismissed: Callable[[], None] | None = None) -> None:
    """Show the red "You already applied on <day>, don't submit" note on a held page, this one and every page
    loaded from it. The guard stays on: Submit is blocked. `dismissed` hears his second press of Dismiss (None:
    the page has the binding already)."""
    if dismissed:
        page.expose_binding("__applyDismissApplied", lambda source: dismissed())
    script = APPLIED_NOTE.replace("DAY", json.dumps(day))
    page.context.add_init_script(script)
    try:
        page.evaluate(script)  # the top frame only: the script shows nothing in a form's frame
    except Exception:
        pass


def applied_dismissed(page: Page) -> None:
    """Lisul dismissed the note: no page loaded from now on shows it (lift() then takes the guard off)."""
    script = "window.__applyAppliedDismissed = true"
    page.context.add_init_script(script)
    try:
        page.evaluate(script)
    except Exception:
        pass


def _refuse(route: Route) -> None:
    if route.request.method in ("GET", "HEAD", "OPTIONS"):
        return route.fallback()
    route.abort("blockedbyclient")


class DriveGuard:
    """The drive guard on a page Claude fill drives, in a live run as in a
    rehearsal: the guard's script, which also blocks a sign-in other than
    Google's, a payment, withdrawing or deleting the application, account or
    profile and ticking an opt-in, on the open page (in every frame, after its
    own code) and on every page its context opens later (before theirs).
    There's no route: the page is never reloaded under it, so a form a sign-in
    or gate led to stays as it is. It's lifted only for Claude fill's own
    submit click, and put back on before Claude drives again; a rehearsal's
    own guard is never lifted. Ticking an opt-in to texts or marketing goes
    on only where Lisul's sms_opt_in or marketing_opt_in policy says yes."""

    def __init__(self, page: Page, sms_opt_in: bool = False, marketing_opt_in: bool = False):
        self._page = page
        self._blocked: list[str] = []
        self._driving = False
        script = drive_script(sms_opt_in, marketing_opt_in)
        page.context.on("console", self._heard)
        page.context.add_init_script(script)
        self._in_frames(script)

    def blocked(self) -> list[str]:
        """What it, or a rehearsal's guard on the page, has blocked so far, as
        "the "Submit" click"."""
        try:
            self._page.evaluate("0")  # hears what the page said while the Worker's thread was in `claude -p`
        except Exception:
            pass  # a page that went away has said all it will
        return list(self._blocked)

    def forget(self) -> None:
        """Clear what it has blocked so far, once Claude fill has made sense of it."""
        self._blocked.clear()

    def lift(self) -> None:
        self._in_frames("window.__applyDriveLifted = true")
        self.rest()

    def rest(self) -> None:
        """Claude stopped driving: a captcha's frame takes Lisul's clicks
        again, for the captcha wait. The rest of the guard stays on."""
        self._set_driving(False)

    def let_account_click(self) -> None:
        """Let plain code's next click sign in or make an account: its button,
        and its POST form, go through this guard and a rehearsal's. A button
        that sends the form, and the application request, are blocked still."""
        self._in_frames("window.__applyAccountClick = true")

    def arm(self) -> None:
        self._in_frames("window.__applyDriveLifted = false; window.__applyAccountClick = false")
        self._set_driving(True)

    def _set_driving(self, driving: bool) -> None:
        """Claude drives now, or not: so a captcha's frame refuses every click
        and key, or lets them through. A frame loaded later (a challenge
        opening) starts the same way, by the init script."""
        if driving == self._driving:
            return
        self._driving = driving
        script = f"window.__applyDriving = {_js(driving)}"
        try:
            self._page.context.add_init_script(script)
        except Exception:
            pass  # a context closing: nothing more loads in it
        self._in_frames(script)

    def _heard(self, message) -> None:
        for said in HEARD:
            if message.text.startswith(said):
                self._blocked.append(message.text.removeprefix(said))
                return

    def _in_frames(self, script: str) -> None:
        for frame in self._page.frames:
            try:
                frame.evaluate(script)
            except Exception:
                continue  # a frame that went away, or one that refuses scripts
