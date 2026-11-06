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

A link's ping (hyperlink auditing, a POST no script sees) never leaves a
guarded page: the guard takes it off as the link is clicked, and no script
can set one back while the page is guarded.

Everything else goes through: résumé uploads, Ashby's per-answer saves,
Lever's résumé parse, Workday's Save and Continue, a Next that saves its
step, and another site's widget posting hidden fields into its own iframe
(LinkedIn's Apply with LinkedIn on Microsoft's form, KAN-711). A blocked attempt shows a small "Apply rehearsal" note on the page,
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
button that sends, a form that has one, and the application request stay
blocked. Only that press counts (KAN-710): on the element plain code armed,
in its frame, never a frame inside it or another form a script posts. On a rehearsal's page it hears what
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
import secrets
import threading
from collections.abc import Callable
from contextlib import contextmanager

from playwright.sync_api import Page, Route

from apply import captcha, send_click

# The final requests the route stops, from the page or a worker: a path segment that names a
# submit (Jobvite's .../submitApplication among them), Ashby's ApiSubmit, BambooHR's and Workable's.
ROUTED = re.compile(
    r"^https?://[^/?#]+/(?:[^?#]*/)?[^/?#]*submit[^/?#]*(?:[/?#].*)?$"
    r"|^https?://[^/?#]*ashbyhq\.com/.*[?&]op=ApiSubmit"
    r"|^https?://[^/?#]*bamboohr\.com/careers/\d+/add/?(?:[?#].*)?$"
    r"|^https?://apply\.workable\.com/api/v1/jobs/\w+/apply/?(?:[?#].*)?$",
    re.IGNORECASE,
)

# Whether an open pop-up is a profile step before the application (Microsoft's "Create your profile",
# KAN-647), and nothing an application could be: titled as making or finishing a profile, with
# nothing in it that only an application asks (a file, an essay, a box or a choice to tick, a
# password), and no form field of the page's own behind it. Claude fill and the guards both use it.
PROFILE_DIALOG = r"""(dialog) => {
  const by = (dialog.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
    .map(id => (document.getElementById(id) || {}).innerText || '').join(' ');
  const heading = dialog.querySelector('h1, h2, h3, [role=heading]');
  const title = (dialog.getAttribute('aria-label') || by || (heading && heading.innerText) || '').trim();
  if (!/\b(?:create|complete|build|set\s*up|finish)\b[^.]{0,30}\bprofile\b/i.test(title)) return false;
  if (/\b(?:appl(?:y|ying|ication)|job|position|role)\b/i.test(title)) return false;
  if (dialog.querySelector('input[type=file], textarea, input[type=checkbox], [role=checkbox], input[type=radio], '
    + '[role=radio], input[type=password]')) return false;
  const shown = (n) => n.type !== 'hidden' && n.type !== 'search' && (!n.checkVisibility || n.checkVisibility());
  return ![...document.querySelectorAll('input, select, textarea')].some((n) => !dialog.contains(n) && shown(n)
    && !n.closest('[role=search], [role=dialog], [aria-modal=true], dialog'));
}"""

_TEMPLATE = r"""
(() => {
  // The guard's own state (KAN-710): in this closure, never on window, so no page script reads or sets it. Apply
  // changes it only by @CONTROL@, an event named with a token of this run that only Apply's own scripts know: sent
  // from an isolated world (a CDP isolated world, or the worker extension's), or by an init script before any page
  // code. The guard hears it first, at the window, and stops it there.
  const own = Object.prototype.hasOwnProperty, apply = Reflect.apply, parse = JSON.parse, toJSON = JSON.stringify;
  const debug = console.debug, dispatch = EventTarget.prototype.dispatchEvent, Custom = CustomEvent;
  const has = (o, k) => o !== null && typeof o === 'object' && apply(own, o, [k]);
  const S = {lifted: false, held: false, paused: false, note: null, account: null, profile: false, upload: false,
             asking: false, askTick: false, driving: false, touchUntil: 0, applied: null, appliedDismissed: false};
  const MARK = '__@KEY@Guard@TOKEN@';
  if (apply(own, window, [MARK])) return;
  Object.defineProperty(window, MARK, {value: true});
  const onControl = [];  // what else hears a control: the note, below
  addEventListener('@CONTROL@', (event) => {
    event.stopImmediatePropagation();
    let cmd = null;
    try { cmd = parse(event.detail); } catch (e) { return; }
    if (cmd === null || typeof cmd !== 'object') return;
    if (has(cmd, 'query')) {  // Apply's tests ask: is this state on? The answer is the event's ack
      if (S[String(cmd.query)] === true || (cmd.query === 'account' && S.account !== null)) event.preventDefault();
      return;
    }
    if (has(cmd, 'lift')) {
      const n = cmd.lift;
      S.lifted = n !== null && typeof n === 'object';
      S.held = S.lifted && has(n, 'held') && !!n.held;
      S.note = S.lifted ? n : null;
    }
    if (has(cmd, 'renote') && S.lifted && cmd.renote !== null && typeof cmd.renote === 'object') {
      S.held = has(cmd.renote, 'held') && !!cmd.renote.held;
      S.note = cmd.renote;
    }
    if (has(cmd, 'pause')) S.paused = cmd.pause === true;
    if (has(cmd, 'account')) {
      const at = event.target;
      S.account = cmd.account === true ? true : cmd.account === 'element' && at instanceof Element ? at : null;
    }
    for (const k of ['profile', 'upload', 'asking', 'askTick', 'driving', 'appliedDismissed']) if (has(cmd, k)) S[k] = cmd[k] === true;
    if (has(cmd, 'applied')) S.applied = typeof cmd.applied === 'string' ? cmd.applied : null;
    for (const f of onControl) { try { f(cmd); } catch (e) {} }
    event.preventDefault();  // heard
  }, true);
  // What the guard tells Apply (Lisul's press of a Submit, his Fill again, his Dismiss): in its own voice, which a
  // page can neither forge nor hear.
  const tell = (name, ...args) => {@TELL@
  };
  // A captcha's own frame is Lisul's to do (apply.captcha): nothing in it is the application.
  const host = location.hostname, path = location.pathname;
  if (@CAPTCHA_HOSTS@.some((h) => host === h || host.endsWith('.' + h)) || @CAPTCHA_PATHS@.some((p) => path.startsWith(p))) {
@CAPTCHA@
    return;
  }
  // Lifted, Lisul's page lets everything through, unless Apply holds its Submit (a legal answer the review
  // found wrong): then a button or request that sends is blocked still, and the held note says why. Paused: Apply
  // types an emailed code on his page (apply.email_code), with the guard on meanwhile.
  const held = () => @HELD@;
  const lifted = () => S.lifted && !S.paused && !held();
  // Plain code's own press (KAN-710): Apply arms the account click (true, or on a CDP Worker the element it
  // presses, in that element's frame alone), then presses. Only a press that lands in this frame on that element
  // counts: a trusted click, or on a plain Worker an untrusted one right after the worker extension marks its press.
  // A frame inside the pressed element, a page's own click, or a click before the arming never counts.
  const armed = () => S.account;
  let press = null;  // {event, target, by, form}: the last press of Apply's (or, on a held page, Lisul's)
  let userClick = null;  // the click in dispatch that is Apply's or Lisul's own
  const user = (event) => event.isTrusted || event === userClick;
  addEventListener('click', (event) => {
    userClick = event.isTrusted || performance.now() < S.touchUntil ? event : null;
    S.touchUntil = 0;
    const at = armed();
    if (!userClick) return;
    const target = event.target instanceof Element ? event.target : null;
    press = target && (!at || at === true || at.contains(target))
      ? {event, target, by: at, form: (target.closest('button, input') || {}).form || target.closest('form')} : null;
  }, true);
  // Plain code's press is on: armed, and the press came under this same arming.
  const accountClick = () => !!press && !!press.by && press.by === armed();
  // A form's submission is the press's own: the pressed button sends it (by), or the page's own handlers of the
  // press do while it is still being dispatched (a Next that calls form.submit() or requestSubmit()), or the
  // pressed element's own form goes on later (a Next that checks its step by fetch first). Never another form
  // a script posts meanwhile, nor a form in a frame inside the pressed element.
  const pressed = (form, by) => !!press && ((!!by && by.contains(press.target))
    || press.event.eventPhase !== 0 || (!!form && form === press.form));
  const fromPress = (form, by) => accountClick() && pressed(form, by);
  // A sign-in or new account's form: one with a password box, which no application's final button is in.
  const accountForm = (el) => {
    const form = el.form || (el.closest && el.closest('form'));
    return !!form && !!form.querySelector('input[type=password]');
  };
  // A verification code's form: one with a one-time-code box, which no application's final button is in either.
  const codeForm = (el) => {
    const form = el.form || (el.closest && el.closest('form'));
    return !!form && !!form.querySelector('input[autocomplete=one-time-code]');
  };
  // Plain code's click on the button of a profile step before the application (Microsoft's
  // "Create your profile" pop-up names its button Submit, live: KAN-647).
  const profileClick = () => S.profile;
  // Only a button that names no application, in a pop-up that is a profile step and no more.
  const profileStep = (el) => {
    const dialog = el && el.closest && el.closest('[role=dialog], [aria-modal=true], dialog[open]');
    return !!dialog && !/\bappl(?:y|ying|ication)\b/i.test(wordsOf(el)) && (@PROFILE_DIALOG@)(dialog);
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
  for (const kind of ['pointerdown', 'keydown']) addEventListener(kind, (event) => { if (event.isTrusted) touched = true; }, true);@PORT_TOUCH@
@NOTE@
  const note = (what) => {
    blocked.push(what);
    if (held()) {  // Lisul's own Submit on a held page: the held note says why, with its Dismiss button
      console.warn('@NAME@ held ' + what);
      showNote();
      return;
    }
    console.warn('@NAME@ blocked ' + what);@PORT_SAID@
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
      // Saying whether it was a sign-in, account or code form's (Workday's Sign in with email names its button
      // Submit): that press sends no application, so Resume still goes on after it. Only his own press: a trusted
      // click, or a plain Worker's press from the tile.
      if (sends(target) && user(event)) tell('__applyLisulPressed', wordsOf(target).trim().slice(0, 80),
        accountForm(target) || codeForm(target));
      return;
    }
    if (!sends(target)) return;
    // Plain code's own click on an account form's button: Workday names its button "Submit" in its
    // Sign in with email view (Sonos's, live), and that click only signs in.
    if (accountClick() && accountForm(target)) return;
    if (profileClick() && profileStep(target)) return;
    const words = wordsOf(target);
    event.preventDefault();
    event.stopImmediatePropagation();
    note('the "' + words.trim().slice(0, 40) + '" click');
  }, true);
@EXTRA@

  // A link's ping (hyperlink auditing): the browser POSTs to each of its URLs as it follows the link, and no
  // script sees it. Nothing Apply does needs one, so a guarded page sends none (KAN-710): each link's ping is
  // taken off as it is clicked, before the page's handlers, and no script can put one back while it is guarded.
  const unping = (el) => {
    const link = el && el.closest && el.closest('a, area');
    if (!link || lifted() || !link.hasAttribute('ping')) return;
    const urls = String(link.getAttribute('ping')).trim().split(/\s+/);
    link.removeAttribute('ping');
    if (urls.some((u) => isFinal('POST', u))) note(named('POST', urls.find((u) => isFinal('POST', u))) + ' of a link');
  };
  window.addEventListener('click', (event) => unping(event.target), true);
  window.addEventListener('auxclick', (event) => unping(event.target), true);
  const pings = (el, name) => !lifted() && String(name).toLowerCase() === 'ping' && el instanceof Element && el.matches('a, area');
  for (const [proto, method, at] of [[Element.prototype, 'setAttribute', 0], [Element.prototype, 'setAttributeNS', 1],
                                      [Element.prototype, 'toggleAttribute', 0]]) {
    const was = proto[method];
    proto[method] = function (...args) {
      if (pings(this, String(args[at]).split(':').pop())) return method === 'toggleAttribute' ? false : undefined;
      return was.apply(this, args);
    };
  }
  for (const method of ['setAttributeNode', 'setAttributeNodeNS']) {
    const was = Element.prototype[method];
    Element.prototype[method] = function (attr) { return attr && pings(this, attr.name) ? null : was.call(this, attr); };
  }
  for (const method of ['setNamedItem', 'setNamedItemNS']) {
    const was = NamedNodeMap.prototype[method];
    NamedNodeMap.prototype[method] = function (attr) {
      return attr && String(attr.name).toLowerCase() === 'ping' && !lifted() ? null : was.call(this, attr);
    };
  }
  for (const proto of [HTMLAnchorElement.prototype, HTMLAreaElement.prototype]) {
    const was = Object.getOwnPropertyDescriptor(proto, 'ping');
    if (was && was.set) Object.defineProperty(proto, 'ping', {...was, set(value) { if (!lifted()) return; was.set.call(this, value); }});
  }

  // Native submission of a POST form.
  const fields = (form) => Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements').get.call(form);
  // The form has a button that sends: any of its buttons, a hidden one or one outside it (form=) too (KAN-710).
  const formSends = (form) => [...form.querySelectorAll('button, input[type=submit], input[type=image]'), ...fields(form)]
    .some((n) => (n.tagName === 'BUTTON' || /^(submit|image)$/i.test(n.type || '')) && sends(n));
  const posts = (form, submitter) => {
    const method = (submitter && submitter.getAttribute && submitter.getAttribute('formmethod')) || form.getAttribute('method') || 'get';
    return method.toLowerCase() === 'post';
  };
  // A submit that would send the application (by its Submit/Send button, or with no
  // button, as a script's requestSubmit() or a page's own Enter key does, from a form
  // that has one) reaches none of the page's handlers. A "Next" goes on.
  // A POST to a job system's final application URL (a CDP Worker routes none of those page URLs): never let
  // through by plain code's account, step or profile click (KAN-639, KAN-647), as a fetch to it never is.
  // Its target by attribute (a field named "action" shadows form.action), relative to the page as isFinal reads it.
  const postTarget = (form, by) => (by && by.getAttribute && by.getAttribute('formaction'))
    || HTMLFormElement.prototype.getAttribute.call(form, 'action') || location.href;
  // Any job system's final URL by its name alone (a path ending in /apply, the last of FINAL_URLS), not a known one.
  const byNameAlone = (form, by) => {
    let href = String(postTarget(form, by));
    try { href = new URL(href, location.href).href; } catch (e) {}
    return !FINAL_URLS.slice(0, -1).some(r => r.test(href));
  };
  // The page itself says steps remain after this one ("Step 2 of 5", a step list past the current step), and
  // the form has no button that sends. Then a POST to a path ending in /apply is a step, not the last (KAN-656).
  // No page saying so, or "Step 5 of 5", stays blocked: a step's Next there hands off, and nothing is sent.
  const moreSteps = (form) => {
    if (formSends(form)) return false;
    const said = String((document.body && document.body.innerText) || '').match(/\bstep\s*(\d+)\s*(?:of|\/)\s*(\d+)\b/i);
    if (said) return Number(said[1]) < Number(said[2]);
    const at = document.querySelector('[aria-current=step]');
    return !!at && !!(at.closest('li') || at).nextElementSibling;
  };
  // A step's Next only (KAN-710): the button plain code pressed, never a script's post or a step list's link.
  const postsFinal = (form, by) => posts(form, by) && isFinal('POST', postTarget(form, by))
    && !(byNameAlone(form, by) && !!by && !!press && by.contains(press.target) && moreSteps(form));
  // A profile pop-up posting to its own page, on a URL final by its name alone: the pop-up is proven no application.
  const profileOwnPage = (form, by) => !(by && by.getAttribute && by.getAttribute('formaction'))
    && !HTMLFormElement.prototype.getAttribute.call(form, 'action') && byNameAlone(form, by);
  // A sign-in relay's own post (an SSO, OIDC or SAML hand-off: Amazon's idp.federate "Signing you in...", live):
  // the page's script posts it before any click or key on the page, its fields are all hidden (a token, a
  // state), no button of it sends, and it is bound for no final URL. Nothing of an application is in it.
  const hiddenOnly = (form) => [...fields(form)].some((n) => n.type === 'hidden')
    && [...fields(form)].every((n) => n.type === 'hidden' || n.tagName === 'FIELDSET'
      || (/^(submit|button|reset)$/.test(n.type) && !sends(n)));
  // A relay page is only that post (KAN-710): a page that shows a field of its own is a form, whose script may
  // post the application's hidden copy (TAL.net's submit=1) before any click.
  const fieldShown = () => [...document.querySelectorAll('input, select, textarea')].some((n) =>
    !/^(hidden|submit|button|reset|image)$/i.test(n.type || '') && (!n.checkVisibility || n.checkVisibility()));
  const relay = (form, by) => !touched && posts(form, by) && !postsFinal(form, by) && hiddenOnly(form) && !fieldShown();
  // Another site's widget loading itself into its own frame on the page, click or no click: LinkedIn's Apply
  // with LinkedIn on Microsoft's form (live, KAN-711) posts a form of hidden fields (its key, the job's code)
  // to linkedin.com into the iframe it just made, as the form loads. Bound for another site and no final URL,
  // into a frame of this page (its target names an iframe here), with nothing of the application in it.
  const frameLoad = (form, by) => {
    const target = (by && by.getAttribute && by.getAttribute('formtarget'))
      || HTMLFormElement.prototype.getAttribute.call(form, 'target') || '';
    if (!target || target.startsWith('_') || !posts(form, by) || postsFinal(form, by) || !hiddenOnly(form)) return false;
    let away = false;
    try { away = new URL(postTarget(form, by), location.href).origin !== location.origin; } catch (e) {}
    return away && [...document.getElementsByName(target)].some((n) => /^I?FRAME$/.test(n.tagName));
  };
  // Plain code's résumé attach (apply.attach): the page's own script posting the file it was just given, as iCIMS
  // posts its résumé to be parsed by a native submission (KAN-691). Only a form that holds a chosen file, sent by no
  // button that sends, and never to a final URL; outside the attach's window it is blocked as ever.
  const uploadPost = (form, by) => S.upload && !(by && sends(by))
    && [...form.querySelectorAll('input[type=file]')].some((input) => input.files && input.files.length > 0)
    && !postsFinal(form, by);
  window.addEventListener('submit', (event) => {
    if (lifted()) return;
    const form = event.target, by = event.submitter;
    if (relay(form, by) || frameLoad(form, by) || uploadPost(form, by)) return;
    // Plain code's sign-in, as above, but never a POST bound for the final URL: an application that makes an
    // account as it applies has a password box too (KAN-681).
    const apply = fromPress(form, by);
    if (apply && form.querySelector('input[type=password]') && !postsFinal(form, by)) return;
    if (profileClick() && profileStep(by || form) && (!postsFinal(form, by) || profileOwnPage(form, by))) return;  // plain code's profile step, as above
    const final = by ? sends(by) : formSends(form);
    // A held page is Lisul's but for its Submit: a Next goes on. A button that says nothing that sends, in a form
    // that has a Submit, goes on only by his own press of it, never by a script's requestSubmit() (KAN-710).
    if (held() && !final && (!by || !formSends(form) || (!!press && by.contains(press.target)))) return;
    if (final) event.stopImmediatePropagation();
    // Plain code's press posts a step: never a form that has a button that sends, whatever its submitter says
    // (another language, Done, a hidden one), nor one bound for the final URL (KAN-710).
    const step = apply && !postsFinal(form, by) && !formSends(form);
    if (final || (posts(form, by) && !step)) {
      event.preventDefault();
      note('a form submission');
    }
  }, true);
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    // Under plain code's click, a page script may post a step's form, but never one with a button that sends
    // or one bound for the final URL (a Continue whose handler calls the application form's submit()).
    const step = fromPress(this, null) && !postsFinal(this) && (!!this.querySelector('input[type=password]')
      || !formSends(this));
    if (!lifted() && !step && !relay(this, null) && !frameLoad(this, null) && !uploadPost(this) && posts(this)) return note('a form submission');
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


# What else the drive guard blocks, while Claude drives: an account step's button on a page that carries a
# captcha (apply.captcha.CARRIED), a sign-in other than Google's, a payment,
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
    if (!accountClick() && !el.matches(BOX) && !el.matches('a:not([role=button])') && carriesCaptcha() && accountStep(el)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return note('the "' + wordsOf(el).trim().slice(0, 40) + '" click ' + SIGN_IN_CLICK);
    }
    const box = el.matches(BOX);
    const words = box ? boxWords(el) : wordsOf(el);
    // A checkbox's click has ticked it already; a role=checkbox's has yet to.
    const ticks = box && (el.type === 'checkbox' ? el.checked : el.getAttribute('aria-checked') !== 'true');
    if (box ? !(ticks && optIn(words)) : !(CONTROLS.test(words) || (signsIn(el) && !accountClick()))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    note('the "' + words.trim().slice(0, 40) + '" click');
  }, true);
  // A page that carries a captcha, its invisible kind too (apply.captcha.CARRIED), in this frame or a same-origin
  // one around it: an account step's button there runs the captcha, so it is Lisul's to press, never Claude's, and
  // plain code's account click never comes (apply.account_pages hands off first). AMD's iCIMS email step, KAN-703.
  const CAPTCHA_CARRIED = @CAPTCHA_CARRIED@, SIGN_IN_CLICK = @SIGN_IN_CLICK@;
  const carriesCaptcha = () => {
    for (let w = window; ; w = w.parent) {
      try { if (w.document.querySelector(CAPTCHA_CARRIED)) return true; } catch (e) { return false; }
      if (w === w.parent) return false;
    }
  };
  // An account step: a form with a password box, or one with an email or username box and few fields else (an
  // email step's Next): at most one more, or three on a page whose path signs in or makes an account.
  const ACCOUNT_PATH = /(?:^|[\/_.-])(?:log-?in|sign-?in|sign-?up|log-?on|register|registration|account)(?:$|[\/_.-])/i;
  const accountStep = (el) => {
    const scope = el.form || (el.closest && el.closest('form')) || document;
    if (scope.querySelector('input[type=password]')) return true;
    const shown = [...scope.querySelectorAll('input, select, textarea')].filter((n) => !/^(hidden|submit|button|reset|image|checkbox|radio)$/.test(n.type)
      && (!n.checkVisibility || n.checkVisibility()));
    return shown.length <= (ACCOUNT_PATH.test(location.pathname) ? 4 : 2)
      && shown.some((n) => n.type === 'email' || /e-?mail|user|login/i.test([n.name, n.id, n.autocomplete].join(' ')));
  };
  // A sign-in or new account's own button, or its form sent another way (Enter): plain code's alone.
  const signsIn = (el) => {
    const form = el.form || (el.closest && el.closest('form'));
    return !!form && !el.matches('a') && !!form.querySelector('input[type=password]');
  };
  window.addEventListener('submit', (event) => {
    if (lifted() || accountClick()) return;
    if (carriesCaptcha() && accountStep(event.submitter || event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return note('a sign-in ' + SIGN_IN_CLICK);
    }
    if (!event.target.querySelector('input[type=password]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    note('a sign-in');
  }, true);
  // Ask Claude's drive (DriveGuard.asking): each trusted act judged on the real element, its text and attributes,
  // by send_click's words. The hook sees a snapshot's role and name only; this sees type=password and the rest.
  const askFacts = @ASK_ELEMENT@;
  const SECRET = new RegExp(@ASK_SECRET@, 'i'), ATTESTS = new RegExp(@ASK_ATTEST@, 'i'), RESEND = new RegExp(@ASK_RESEND@, 'i');
  const asking = (event) => S.asking && event.isTrusted && !lifted();
  const refuse = (event, what) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    note(what);
  };
  window.addEventListener('beforeinput', (event) => {
    if (!asking(event)) return;
    const facts = askFacts(event.target);
    if (facts.type === 'password' || SECRET.test((facts.text + ' ' + facts.attrs).replace(/[-_]+/g, ' '))) refuse(event, 'typing in a password or code field');
    else if (ATTESTS.test(facts.text) && !S.askTick) refuse(event, 'typing in "' + facts.text.slice(0, 40) + '"');
  }, true);
  window.addEventListener('click', (event) => {
    if (!asking(event) || !event.target || !event.target.closest) return;
    const el = event.target.closest(BOX + ', button, input[type=submit], input[type=button], [role=button], a');
    if (!el) return;
    const words = askFacts(el).text;
    if (el.matches(BOX)) {
      const ticks = el.type === 'checkbox' ? el.checked : el.getAttribute('aria-checked') !== 'true';
      if (ticks && ATTESTS.test(words) && !S.askTick) refuse(event, 'the "' + words.slice(0, 40) + '" tick');
    } else if (RESEND.test(words)) refuse(event, 'the "' + words.slice(0, 40) + '" click');
  }, true);
"""


# The drive guard in a captcha's own frame: while Claude drives (DriveGuard.arm), every click, tap and key
# there is refused before the captcha's own code hears it, so Claude never ticks, types in or solves one.
# Lisul's own clicks go through once Claude stops (DriveGuard.rest), for the captcha wait.
CAPTCHA_TRY = "a click or key in a captcha"
_IN_CAPTCHA = r"""
    const refuse = (event) => {
      if (S.lifted || !S.driving || !event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerdown' || event.type === 'keydown') console.warn('Apply drive guard blocked @TRY@');
    };
    for (const kind of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick',
                        'touchstart', 'touchend', 'keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'paste']) {
      addEventListener(kind, refuse, true);
    }
"""


def _script(key: str, name: str, extra: str = "", in_captcha: str = "", held: str = "false", note: str = "",
            port: bool = False) -> str:
    """The guard's script under its own key, so two guards can share a page, naming itself `name` in the note on
    what it blocked: off while lifted, and blocking `extra`'s controls too; `in_captcha` runs in a captcha's own
    frame, which the guard leaves alone; `note` is Lisul's note on a lifted page. Its state is set only by its
    control event (CONTROL), named with this run's token for `key`. `port`: a plain Worker's copy
    (apply.plain.guards), whose page events are all untrusted: it also counts a press the worker extension marks
    (Apply's own, or Lisul's from the tile) as a touch, and tells the extension what it blocked and what Lisul
    pressed, since no console reaches Apply there."""
    box = name.lower().replace(" ", "-") + "-blocked"
    script = _TEMPLATE
    for placeholder, value in {"@PORT_TOUCH@": PORT_TOUCH if port else "", "@PORT_SAID@": PORT_SAID if port else "",
                               "@TELL@": TELL_PORT if port else TELL_CDP, "@NOTE@": note or NO_NOTE,
                               "@EXTRA@": extra, "@CAPTCHA@": in_captcha, "@HELD@": held,
                               "@PROFILE_DIALOG@": PROFILE_DIALOG, "@CAPTCHA_HOSTS@": json.dumps(captcha.HOSTS),
                               "@CAPTCHA_PATHS@": json.dumps(captcha.PATHS), "@CONTROL@": control_type(key),
                               "@TELL_TYPE@": TELL_TYPE, "@TELL_PREFIX@": TELL_PREFIX, "@TOUCH@": touch_type(key),
                               "@KEY@": key, "@NAME@": name, "@BOX@": box, "@TOKEN@": TOKENS[key]}.items():
        script = script.replace(placeholder, value)
    return script


# This run's tokens, one for each guard: they name its control event, so only Apply's own scripts can set its state.
# The drive guard's has its own: its copy evaluated into a page already open goes through that page's own eval.
TOKENS = {"applyRehearsal": secrets.token_hex(16), "applyDrive": secrets.token_hex(16)}
REHEARSAL, DRIVE = "applyRehearsal", "applyDrive"
BOTH = (REHEARSAL, DRIVE)


def control_type(key: str) -> str:
    """The event that sets guard `key`'s state."""
    return f"__{key}Control{TOKENS[key]}"


def touch_type(key: str) -> str:
    """The event a plain Worker's extension sends before each press it makes (PORT_TOUCH)."""
    return f"__apply_touch{TOKENS[key]}"


# What the rehearsal's guard tells Apply: on a CDP Worker a console line with this prefix, on a plain Worker an event
# of this name, which the worker extension's relay hears (both carry the token). The guard alone says them.
TELL_PREFIX = f"__apply:{TOKENS[REHEARSAL]}:"
TELL_TYPE = f"__apply_tell{TOKENS[REHEARSAL]}"
TELL_CDP = "\n    apply(debug, console, ['@TELL_PREFIX@' + toJSON([name, args])]);"
TELL_PORT = "\n    apply(dispatch, document, [new Custom('@TELL_TYPE@', {detail: toJSON([name, args])})]);"
TELLS = ("__applyLisulPressed", "__applyFillAgain", "__applyDismissHold", "__applyDismissApplied")

# A plain Worker's additions (port=True): the worker extension sends its touch (the token's) on the page before each
# press it makes (Apply's own, and Lisul's from the tile), and hears `__apply_said`.
PORT_TOUCH = ("\n  addEventListener('@TOUCH@', (event) => { event.stopImmediatePropagation(); touched = true; "
              "S.touchUntil = performance.now() + 1000; }, true);")
PORT_SAID = "\n    document.dispatchEvent(new CustomEvent('__apply_said', {detail: '@NAME@ blocked ' + what}));"

NO_NOTE = "  const showNote = () => {};"
# Lisul's note on a lifted page (lift): what Apply found wrong, its Fill again, a held Submit's Dismiss and a × that
# hides it; and on a held page of a Posting he applied to already (KAN-621) the red "You already applied" note,
# whose second press of Dismiss tells Apply. Only his own press of a button counts.
NOTE = r"""
  const onBody = (f) => { if (document.body) f(); else document.addEventListener('DOMContentLoaded', f); };
  const button = (words, act, css) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = words;
    b.style.cssText = css || 'margin-left:8px;pointer-events:auto;cursor:pointer;font:13px sans-serif';
    b.addEventListener('click', (event) => {
      event.stopPropagation();
      if (user(event)) act(b);
    });
    return b;
  };
  const showNote = () => onBody(() => {
    const n = S.note;
    if (!S.lifted || !n) return;
    const warning = String(n.warning || ''), wrong = n.wrong !== false, holding = String(n.held || '');
    const box = document.getElementById('@BOX@') || document.createElement('div');
    box.id = '@BOX@';
    // Under a captcha's challenge (reCAPTCHA's is z-index 2000000000), so its Verify stays pressable.
    box.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:1999999999;padding:6px 10px;max-width:480px;'
      + 'background:' + (holding || (warning && wrong) ? '#b00020' : warning ? '#8a5a00' : '#1b5e20')
      + ';color:#fff;font:13px sans-serif;border-radius:4px;pointer-events:none';
    box.textContent = holding
      ? 'Apply rehearsal: Submit is held. Fix this answer, then press Dismiss: ' + holding
      : warning
      ? 'Apply rehearsal: ' + (wrong ? 'fix this before you submit. ' : 'check before you submit. ') + warning
      : 'Apply rehearsal: Apply is done with this page. Check it; Submit is yours to press.';
    if (holding) box.appendChild(button('Dismiss', () => tell('__applyDismissHold')));  // his say that it is fixed
    if (n.again === true) box.appendChild(button('Fill again', () => tell('__applyFillAgain')));
    const close = button('×', () => { box.style.display = 'none'; },  // hides the note on this page only
      'margin-left:8px;pointer-events:auto;cursor:pointer;font:13px sans-serif;background:none;border:none;color:#fff;padding:0 2px');
    close.setAttribute('aria-label', 'Hide this note');
    box.appendChild(close);
    if (!box.parentNode) (document.body || document.documentElement).appendChild(box);
    box.style.display = '';
  });
  const dropNote = () => onBody(() => { const box = document.getElementById('@BOX@'); if (box) box.remove(); });
  const showApplied = () => {
    const run = () => {
      if (window !== window.top || S.applied === null || S.appliedDismissed || document.getElementById('apply-already-applied')) return;
      const box = document.createElement('div');
      box.id = 'apply-already-applied';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:1999999999;'
        + 'padding:10px 14px;max-width:560px;background:#b00020;color:#fff;font:bold 15px sans-serif;'
        + 'border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.4)';
      const words = document.createElement('span');
      words.textContent = 'You already applied on ' + S.applied + ', don’t submit. Apply keeps Submit blocked on this page.';
      box.appendChild(words);
      let asked = false;
      box.appendChild(button('Dismiss', (b) => {
        if (!asked) {
          asked = true;
          b.textContent = 'Yes, I’m sure: unblock this page';  // no word the guard blocks (submit, send...)
          return;
        }
        S.appliedDismissed = true;
        box.remove();
        tell('__applyDismissApplied');
      }, 'margin-left:10px;cursor:pointer;font:13px sans-serif'));
      (document.body || document.documentElement).appendChild(box);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  };
  onControl.push((cmd) => {
    if (has(cmd, 'lift') || has(cmd, 'renote')) S.lifted ? showNote() : dropNote();
    if (has(cmd, 'applied')) showApplied();
    if (S.appliedDismissed) { const box = document.getElementById('apply-already-applied'); if (box) box.remove(); }
  });
"""


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


def rehearsal_script(port: bool = False) -> str:
    """SCRIPT, or with `port` a plain Worker's copy of it."""
    return _script(REHEARSAL, "Apply rehearsal", held="S.lifted && !S.paused && S.held", note=NOTE, port=port) \
        + HIDE_LINKEDIN_BUTTON


def drive_script(sms_opt_in: bool = False, marketing_opt_in: bool = False, port: bool = False) -> str:
    """The drive guard's script, letting through ticking an opt-in to texts or
    marketing that Lisul's policy says yes to (`port`: a plain Worker's copy)."""
    controls = _CONTROLS.replace("@SMS_OPT_IN@", _js(sms_opt_in)).replace("@MARKETING_OPT_IN@", _js(marketing_opt_in))
    for name, value in {"@CAPTCHA_CARRIED@": json.dumps(captcha.CARRIED), "@SIGN_IN_CLICK@": json.dumps(captcha.SIGN_IN_CLICK),"@ASK_ELEMENT@": send_click.ELEMENT, "@ASK_SECRET@": json.dumps(send_click.SECRET.pattern),
                        "@ASK_ATTEST@": json.dumps(send_click.ATTEST.pattern), "@ASK_RESEND@": json.dumps(send_click.RESEND.pattern)}.items():
        controls = controls.replace(name, value)
    return _script(DRIVE, "Apply drive guard", extra=controls,
                   in_captcha=_IN_CAPTCHA.replace("@TRY@", CAPTCHA_TRY), port=port)


def _js(yes: bool) -> str:
    return "true" if yes else "false"


# Lifted once the page is Lisul's (lift()).
SCRIPT = rehearsal_script()

DRIVE_BLOCKED = "Apply drive guard blocked "  # how the drive guard tells what it blocked, on the page's console
# What the drive guard hears on the page's console: its own blocks, and a rehearsal guard's, which
# stops Claude's click on a button that sends before the drive guard sees it.
HEARD = (DRIVE_BLOCKED, "Apply rehearsal blocked ")


_opening = threading.local()
GUARDED = "_apply_guarded_at_open"  # set on a page (and a CDP page's context) that on_open guarded


@contextmanager
def guarding_on_open():
    """Each page a JobSite opens on this thread, inside this, is guarded before its first load (on_open): a page
    whose own script sends as it loads, or soon after, sends nothing. Without it, guard() came only after that
    load, and Fill again's fresh page was unguarded for it (KAN-682)."""
    _opening.on = True
    try:
        yield
    finally:
        _opening.on = False


def on_open(page: Page) -> None:
    """A JobSite calls this between making a page and its first navigation. Inside guarding_on_open, the guard
    goes on then; guard() later sees it and needs no reload. Outside it (a live run's page), it does nothing."""
    if not getattr(_opening, "on", False):
        return
    if _plain(page):
        _plain(page).guard(page, reload=False)
    else:
        if not getattr(page.context, GUARDED, False):
            page.context.route(ROUTED, _refuse)
            page.context.add_init_script(SCRIPT)
            setattr(page.context, GUARDED, True)
    setattr(page, GUARDED, True)


def guard(page: Page) -> None:
    """Put the guard on an open page, every page its context opens later and
    all their workers. The page is loaded again under it, so the guard runs
    before the page's own code. A page on_open guarded already needs nothing
    more. A plain Worker's page: apply.plain.guards."""
    if getattr(page, GUARDED, False) or (not _plain(page) and getattr(page.context, GUARDED, False)):
        return
    if _plain(page):
        return _plain(page).guard(page)
    page.context.route(ROUTED, _refuse)
    page.context.add_init_script(SCRIPT)
    # Its document is enough: a page whose last tracker never loads (Scale AI's, Coinbase's, live) would time out.
    page.reload(wait_until="domcontentloaded")


# --- the guards' control (KAN-710): their state, set only by Apply

# Sends each [type, detail] event in a frame, from an isolated world, so no page script sees it: on the window, or
# with a mark on the one element that has it (the element plain code presses). A frame inside that element, where its
# press could land, refuses it. Says "heard" when a guard took one, "none" when the frame has no such element.
DISPATCH = r"""(events, mark) => {
  let at = window;
  if (mark) {
    at = document.querySelector('[data-apply-press="' + mark + '"]');
    if (!at) return 'none';
    at.removeAttribute('data-apply-press');
    if (at.querySelector('iframe, frame, object, embed, fencedframe, portal')) return 'frame';
  }
  let heard = false;
  for (const [type, detail] of events) {
    const event = new CustomEvent(type, {detail, cancelable: true});
    at.dispatchEvent(event);
    heard = heard || event.defaultPrevented;
  }
  return heard ? 'heard' : 'unheard';
}"""
WORLD = "apply-guard"  # the CDP isolated world DISPATCH runs in


def _events(cmd: dict, keys=BOTH) -> list[list[str]]:
    return [[control_type(key), json.dumps(cmd)] for key in keys]


def control(page, cmd: dict, keys=BOTH, element=None) -> str:
    """Set the guards' state in every frame of `page` now (`element`: only in the frame that holds it, as the target
    the press must land on). "heard" when a guard took it, "frame" when a frame inside `element` refuses it, else
    "unheard" (no guard: a page going away, or one never guarded)."""
    mark = None
    if element is not None:
        mark = secrets.token_hex(8)
        try:
            element.evaluate("(el, mark) => el.setAttribute('data-apply-press', mark)", mark)
        except Exception:
            return "unheard"
    if _plain(page):
        return _plain(page).control(page, _events(cmd, keys), mark)
    said = []
    for session, frame in _cdp_frames(page):
        said.append(_in_world(session, frame, f"({DISPATCH})({json.dumps(_events(cmd, keys))}, {json.dumps(mark)})"))
    return "frame" if "frame" in said else "heard" if "heard" in said else "unheard"


def _init(page, cmd: dict, keys=BOTH) -> None:
    """The same state at the start of each document the page's context loads from now (before any page code, after
    the guards' own init scripts), so a page loaded from it starts so."""
    events = json.dumps(_events(cmd, keys))
    try:
        page.context.add_init_script(f"for (const [t, d] of {events}) dispatchEvent(new CustomEvent(t, {{detail: d}}));")
    except Exception:
        pass  # a context closing: nothing more loads in it


def _cdp_frames(page) -> list:
    """(CDP session, frame id) of every frame of a CDP Worker's page: its own session's, and each out-of-process
    frame's."""
    sessions = page.__dict__.setdefault("_apply_cdp", {})
    found, seen = [], set()
    try:
        frames = list(page.frames)
    except Exception:
        return []
    for frame in frames:
        if frame not in sessions:
            try:
                sessions[frame] = page.context.new_cdp_session(page if frame == page.main_frame else frame)
            except Exception:
                sessions[frame] = None  # part of its parent's session
        session = sessions[frame]
        if session is None:
            continue
        try:
            tree = session.send("Page.getFrameTree")["frameTree"]
        except Exception:
            continue
        stack = [tree]
        while stack:
            node = stack.pop()
            stack.extend(node.get("childFrames") or [])
            if node["frame"]["id"] not in seen:
                seen.add(node["frame"]["id"])
                found.append((session, node["frame"]["id"]))
    return found


def _in_world(session, frame: str, expression: str) -> str:
    """`expression` in the frame's isolated world (the same world while its document stays), "" if it can't run."""
    worlds = session.__dict__.setdefault("_apply_worlds", {})
    for _ in range(2):
        try:
            if frame not in worlds:
                worlds[frame] = session.send("Page.createIsolatedWorld", {"frameId": frame, "worldName": WORLD})[
                    "executionContextId"]
            answer = session.send("Runtime.evaluate", {"expression": expression, "contextId": worlds[frame],
                                                       "returnByValue": True})
            if "exceptionDetails" not in answer:
                return str(answer.get("result", {}).get("value", ""))
        except Exception:
            pass
        worlds.pop(frame, None)  # its document went: a new one has a world of its own
    return ""


def _tells(page) -> dict:
    """What hears the rehearsal guard's tells on a CDP Worker's page, by name (TELLS): its console lines with this
    run's prefix, which no page script can write."""
    hears = page.__dict__.get("_apply_tells")
    if hears is None:
        hears = page.__dict__["_apply_tells"] = {}

        def heard(message) -> None:
            text = message.text
            if not text.startswith(TELL_PREFIX):
                return
            try:
                name, args = json.loads(text.removeprefix(TELL_PREFIX))
            except ValueError:
                return
            if name in hears and isinstance(args, list):
                hears[name](*args)

        page.on("console", heard)
    return hears


def let_account_click(page, let: bool = True) -> None:
    """Let Apply's own next click on an account form's button through both guards (Workday's "Submit" in its Sign
    in with email view, Sonos's, live), in every frame; `let=False` puts the guards back."""
    control(page, {"account": let})


@contextmanager
def paused(page):
    """Both guards on, though the page is Lisul's (lifted), while Apply types an emailed code (apply.email_code)."""
    control(page, {"pause": True})
    try:
        yield
    finally:
        control(page, {"pause": False})


def lift(page: Page, pressed: Callable[[str], None] | None = None, again: Callable[[], None] | None = None,
         warning: str = "", wrong: bool = True, bound: bool = False, held: str = "",
         dismiss: Callable[[], None] | None = None) -> None:
    """Hand a guarded page to Lisul once Apply is done with it: no Filler or
    Claude drives it any more, so a Submit on it can only be his, and it goes
    through, on this page and every page he loads from it. `pressed` hears
    the words of each button he clicks that sends, with `account=True` when it is a sign-in, account
    or verification code form's (it sends no application); `again`, when he presses
    the note's Fill again. Both are called on the page's own thread, and only for his own press (the guard tells
    Apply; a page script can't). A `warning` goes on the note, red when an answer is `wrong`, amber when
    it only names fields left blank. `bound`: the page was lifted before
    (a paused rehearsal, resumed), so what hears his presses is there already, and
    its note keeps the Fill again button. A `held` reason (a legal answer the
    Pre-submit review found wrong) keeps his Submit blocked, with a red note
    and a Dismiss button that calls `dismiss`, until renote() says it holds no more."""
    if _plain(page):
        return _plain(page).lift(page, pressed, again, warning, wrong, bound, held, dismiss)
    hears = _tells(page)
    for name, heard in (("__applyLisulPressed", pressed and (lambda words, account=False: pressed(words, account=account))),
                        ("__applyFillAgain", again), ("__applyDismissHold", dismiss)):
        if heard:
            hears[name] = heard
    page.context.unroute(ROUTED, _refuse)
    cmd = {"lift": note(bool(again or bound), warning, wrong, held)}
    _init(page, cmd)
    control(page, cmd)


def note(again: bool, warning: str, wrong: bool, held: str) -> dict:
    """The note on a lifted page: its Fill again button, its warning (red when `wrong`), and what holds Submit."""
    return {"again": again, "warning": warning, "wrong": wrong, "held": held}


def rearm(page: Page) -> None:
    """Put the guard back on a page lift() handed to Lisul, for Resume: Apply
    drives it again. No reload, so what he typed on the page stays; a page
    loaded from it later is guarded too (after lift's script, this one runs)."""
    if _plain(page):
        return _plain(page).rearm(page)
    page.context.route(ROUTED, _refuse)
    _init(page, {"lift": None})
    control(page, {"lift": None})


def renote(page: Page, warning: str = "", wrong: bool = True, held: str = "") -> None:
    """Say the note of a page already lifted anew: Lisul answered in the window
    what it said was left blank, or dismissed what held its Submit (`held` is
    what holds it still). Its Fill again button stays. A page still guarded
    (one Lisul already applied to, KAN-621) stays guarded."""
    if _plain(page):
        return _plain(page).renote(page, warning, wrong, held)
    cmd = {"renote": note(True, warning, wrong, held)}
    _init(page, cmd, (REHEARSAL,))  # after lift's: a page loaded from it says the same
    control(page, cmd, (REHEARSAL,))


def _plain(page):
    """apply.plain.guards when `page` is a plain Worker's (a PortPage), else None."""
    if getattr(page, "plain", False) is not True:  # a Mock's attribute is no plain page
        return None
    from apply.plain import guards
    return guards


def warn_applied(page: Page, day: str, dismissed: Callable[[], None] | None = None) -> None:
    """Show the red "You already applied on <day>, don't submit" note on a held page, this one and every page
    loaded from it (in its top frame). The guard stays on: Submit is blocked. `dismissed` hears his second press of
    Dismiss (None: the page has it already)."""
    if _plain(page):
        return _plain(page).warn_applied(page, day, dismissed)
    if dismissed:
        _tells(page)["__applyDismissApplied"] = dismissed
    _init(page, {"applied": day}, (REHEARSAL,))
    control(page, {"applied": day}, (REHEARSAL,))


def applied_dismissed(page: Page) -> None:
    """Lisul dismissed the note: no page loaded from now on shows it (lift() then takes the guard off)."""
    if _plain(page):
        return _plain(page).applied_dismissed(page)
    _init(page, {"appliedDismissed": True}, (REHEARSAL,))
    control(page, {"appliedDismissed": True}, (REHEARSAL,))


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
    on only where Lisul's sms_opt_in or marketing_opt_in policy says yes.
    On a plain Worker's page it is apply.plain.guards.PlainDriveGuard."""

    def __new__(cls, page: Page, *args, **kwargs):
        plain = _plain(page)
        if plain and cls is DriveGuard:
            return super().__new__(plain.PlainDriveGuard)
        return super().__new__(cls)

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
        control(self._page, {"lift": {}}, (DRIVE,))
        self.rest()

    def rest(self) -> None:
        """Claude stopped driving: a captcha's frame takes Lisul's clicks
        again, for the captcha wait. The rest of the guard stays on."""
        self._set_driving(False)

    def let_account_click(self, element=None) -> bool:
        """Let plain code's next click sign in or make an account: its button,
        and its POST form, go through this guard and a rehearsal's. A button
        that sends the form, a form that has one, and the application request
        are blocked still. Given the `element` it presses, only in that
        element's frame and only for a press on it (KAN-710): a frame inside
        it, or another form a script posts meanwhile, is blocked still. False when
        the element holds a frame, where the press could land: it must not be pressed."""
        if element is None:
            control(self._page, {"account": True})
            return True
        return control(self._page, {"account": "element"}, element=element) != "frame"

    def let_profile_click(self, let: bool = True) -> None:
        """Let plain code's next click send a profile step's pop-up, one before the application
        (Microsoft's "Create your profile", KAN-647): its button only, never the application request."""
        control(self._page, {"profile": let})

    def let_upload_post(self, let: bool = True) -> None:
        """Let the page's own script post the file plain code just attached (iCIMS's résumé parse, KAN-691):
        a form holding a chosen file, by no button that sends, never to a final URL, until let off again."""
        control(self._page, {"upload": let})

    def arm(self) -> None:
        control(self._page, {"lift": None, "account": False, "profile": False, "upload": False}, (DRIVE,))
        control(self._page, {"account": False, "profile": False, "upload": False}, (REHEARSAL,))
        self._set_driving(True)

    def asking(self, on: bool, may_tick: bool = False) -> None:
        """Ask Claude drives now, or not: the Ask section judges each trusted act on the real element, in each
        document loaded meanwhile too. `may_tick`: his message could name a box, so a tick isn't stopped here;
        the hook and the read-back hold it to that box's own text."""
        cmd = {"asking": on, "askTick": may_tick}
        _init(self._page, cmd, (DRIVE,))
        control(self._page, cmd, (DRIVE,))

    def _set_driving(self, driving: bool) -> None:
        """Claude drives now, or not: so a captcha's frame refuses every click
        and key, or lets them through. A frame loaded later (a challenge
        opening) starts the same way, by the init script."""
        if driving == self._driving:
            return
        self._driving = driving
        _init(self._page, {"driving": driving}, (DRIVE,))
        control(self._page, {"driving": driving}, (DRIVE,))

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
