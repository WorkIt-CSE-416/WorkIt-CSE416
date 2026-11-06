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
  // --- the built-ins the guard reads with (KAN-710): taken here, before any page code, so a page that later puts
  // its own getAttribute, RegExp test or eventPhase on a prototype changes nothing the guard reads. The guard never
  // calls a method through the page's objects (a field named getAttribute shadows a form's own), and a guard listener
  // that throws blocks what it was judging.
  const W = window, D = document, apply = Reflect.apply, gopd = Object.getOwnPropertyDescriptor;
  const defineProp = Object.defineProperty, ownP = Object.prototype.hasOwnProperty, parse = JSON.parse, json = JSON.stringify;
  const Str = String, Num = Number, Custom = CustomEvent, URL_ = URL, TypeErr = TypeError, DOMExc = DOMException;
  const fn = (proto, name) => { const f = proto[name]; return (self, ...args) => apply(f, self, args); };
  const get = (proto, name) => { const g = gopd(proto, name).get; return (self) => apply(g, self, []); };
  const getter = (cls, name) => { try { return get(cls.prototype, name); } catch (e) { return null; } };
  const has = (o, k) => o !== null && typeof o === 'object' && apply(ownP, o, [k]);
  const exec = RegExp.prototype.exec;
  const test = (re, s) => typeof s === 'string' && apply(exec, re, [s]) !== null;
  const match = (re, s) => typeof s === 'string' ? apply(exec, re, [s]) : null;
  const SP = Str.prototype;
  const trim = fn(SP, 'trim'), slice = fn(SP, 'slice'), lower = fn(SP, 'toLowerCase'), upper = fn(SP, 'toUpperCase');
  const startsWith = fn(SP, 'startsWith'), endsWith = fn(SP, 'endsWith'), lastIndexOf = fn(SP, 'lastIndexOf');
  const text = (s) => typeof s === 'string' ? s : '';
  const any = (a, f) => { for (let i = 0; i < a.length; i++) if (f(a[i])) return true; return false; };
  const every = (a, f) => { for (let i = 0; i < a.length; i++) if (!f(a[i])) return false; return true; };
  const find = (a, f) => { for (let i = 0; i < a.length; i++) if (f(a[i])) return a[i]; return undefined; };
  const push = (a, x) => { a[a.length] = x; return a; };
  const WORD = /\S+/g;
  const wordList = (s) => {  // its words, split on white space
    const out = [];
    WORD.lastIndex = 0;
    for (let m = match(WORD, s); m !== null; m = match(WORD, s)) push(out, m[0]);
    return out;
  };
  const EP = Element.prototype, NP = Node.prototype, DP = Document.prototype, HP = HTMLElement.prototype, EvP = Event.prototype;
  const tagGet = get(EP, 'tagName');
  const isEl = (x) => { if (x === null || typeof x !== 'object') return false; try { tagGet(x); return true; } catch (e) { return false; } };
  const tag = (el) => isEl(el) ? tagGet(el) : '';
  const closest = fn(EP, 'closest'), matches = fn(EP, 'matches'), qs = fn(EP, 'querySelector'), qsa = fn(EP, 'querySelectorAll');
  const attr = fn(EP, 'getAttribute'), hasAttr = fn(EP, 'hasAttribute'), removeAttr = fn(EP, 'removeAttribute');
  const nextEl = get(EP, 'nextElementSibling'), contains = fn(NP, 'contains'), textOf = get(NP, 'textContent');
  const parentEl = get(NP, 'parentElement');
  const docQs = fn(DP, 'querySelector'), docQsa = fn(DP, 'querySelectorAll'), byId = fn(DP, 'getElementById');
  const byName = fn(DP, 'getElementsByName'), bodyOf = get(DP, 'body');
  const innerTextGet = get(HP, 'innerText');
  const innerText = (el) => { try { return text(innerTextGet(el)); } catch (e) { try { return text(textOf(el)); } catch (e2) { return ''; } } };
  const checkVis = EP.checkVisibility ? fn(EP, 'checkVisibility') : null;
  const seen = (el) => !checkVis || checkVis(el);
  const nlLen = get(NodeList.prototype, 'length'), nlItem = fn(NodeList.prototype, 'item');
  const hcLen = get(HTMLCollection.prototype, 'length'), hcItem = fn(HTMLCollection.prototype, 'item');
  const nodes = (nl) => { const out = []; const n = nlLen(nl); for (let i = 0; i < n; i++) out[i] = nlItem(nl, i); return out; };
  const items = (hc) => { const out = []; const n = hcLen(hc); for (let i = 0; i < n; i++) out[i] = hcItem(hc, i); return out; };
  const all = (scope, selector) => nodes(scope === D ? docQsa(D, selector) : qsa(scope, selector));
  const one = (scope, selector) => scope === D ? docQs(D, selector) : qs(scope, selector);
  const up = (el, selector) => isEl(el) ? closest(el, selector) : null;
  const read = (gets, el, or) => {
    for (let i = 0; i < gets.length; i++) { if (gets[i]) { try { return gets[i](el); } catch (e) {} } }
    return or;
  };
  const CONTROLS_OF = [HTMLButtonElement, HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, HTMLFieldSetElement,
                       HTMLOutputElement, HTMLObjectElement];
  const formGets = [], typeGets = [];
  for (let i = 0; i < CONTROLS_OF.length; i++) {
    push(formGets, getter(CONTROLS_OF[i], 'form'));
    push(typeGets, getter(CONTROLS_OF[i], 'type'));
  }
  const valueGets = [getter(HTMLInputElement, 'value'), getter(HTMLButtonElement, 'value')];
  const ownForm = (el) => read(formGets, el, null);  // a control's own form, a form= one too
  const formOf = (el) => ownForm(el) || up(el, 'form');
  const typeOf = (el) => text(read(typeGets, el, ''));
  const valueOf = (el) => text(read(valueGets, el, ''));
  const filesGet = get(HTMLInputElement.prototype, 'files'), filesLen = get(FileList.prototype, 'length');
  const chosen = (input) => { try { const f = filesGet(input); return !!f && filesLen(f) > 0; } catch (e) { return false; } };
  const elementsGet = get(HTMLFormElement.prototype, 'elements');
  const isForm = (x) => { try { elementsGet(x); return true; } catch (e) { return false; } };
  const fields = (form) => items(elementsGet(form));
  const targetGet = get(EvP, 'target'), phaseGet = get(EvP, 'eventPhase');
  const prevent = fn(EvP, 'preventDefault'), stopNow = fn(EvP, 'stopImmediatePropagation');
  const submitterGet = get(SubmitEvent.prototype, 'submitter'), detailGet = get(Custom.prototype, 'detail');
  const listen = fn(EventTarget.prototype, 'addEventListener'), dispatch = fn(EventTarget.prototype, 'dispatchEvent');
  const on = (type, f) => listen(W, type, f, true);
  const perf = performance, perfNow = fn(Performance.prototype, 'now');
  const now = () => perfNow(perf);
  const con = console, warnFn = con.warn, debugFn = con.debug;
  const warn = (s) => apply(warnFn, con, [s]);
  const hrefGet = get(URL_.prototype, 'href'), originGet = get(URL_.prototype, 'origin');
  const resolve = (url, base) => { try { return hrefGet(new URL_(url, base)); } catch (e) { return null; } };
  const originOf = (url) => { try { return originGet(new URL_(url)); } catch (e) { return null; } };
  const pageURL = () => location.href, pageOrigin = () => location.origin;
  // What a relative URL is relative to, as the browser reads it (KAN-710): the document's base (a <base href>, or
  // the creator's for a new frame's about:blank), never the page's own address.
  const docURL = get(DP, 'URL'), baseOf = get(NP, 'baseURI'), ownerDoc = get(NP, 'ownerDocument');
  const base = () => text(baseOf(D)) || pageURL();

  // The guard's own state (KAN-710): in this closure, never on window, so no page script reads or sets it. Apply
  // changes it only by @CONTROL@, an event named with a token of this run that only Apply's own scripts know: sent
  // from an isolated world (a CDP isolated world, or the worker extension's), or by an init script before any page
  // code. The guard hears it first, at the window, and stops it there.
  const S = {lifted: false, held: false, paused: false, note: null, account: null, profile: false, upload: false,
             asking: false, askTick: false, driving: false, touchUntil: 0, applied: null, appliedDismissed: false};
  const MARK = '__@KEY@Guard@TOKEN@';
  if (apply(ownP, W, [MARK])) return;
  defineProp(W, MARK, {value: true});
  const onControl = [];  // what else hears a control: the note, below
  on('@CONTROL@', (event) => {
    stopNow(event);
    let cmd = null;
    try { cmd = parse(detailGet(event)); } catch (e) { return; }
    if (cmd === null || typeof cmd !== 'object') return;
    if (has(cmd, 'query')) {  // Apply's tests ask: is this state on? The answer is the event's ack
      if (S[Str(cmd.query)] === true || (cmd.query === 'account' && S.account !== null)) prevent(event);
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
      const at = targetGet(event);
      S.account = cmd.account === true ? true : cmd.account === 'element' && isEl(at) ? at : null;
    }
    const FLAGS = ['profile', 'upload', 'asking', 'askTick', 'driving', 'appliedDismissed'];
    for (let i = 0; i < FLAGS.length; i++) if (has(cmd, FLAGS[i])) S[FLAGS[i]] = cmd[FLAGS[i]] === true;
    if (has(cmd, 'applied')) S.applied = typeof cmd.applied === 'string' ? cmd.applied : null;
    for (let i = 0; i < onControl.length; i++) { try { onControl[i](cmd); } catch (e) {} }
    prevent(event);  // heard
  });
  // What the guard tells Apply (Lisul's press of a Submit, his Fill again, his Dismiss): in its own voice, which a
  // page can neither forge nor hear. Its words are strings and booleans, each written by JSON alone.
  const tell = (name, ...args) => {
    let said = '[' + json(Str(name)) + ',[';
    for (let i = 0; i < args.length; i++) said += (i ? ',' : '') + json(typeof args[i] === 'boolean' ? args[i] : Str(args[i]));
    said += ']]';@TELL@
  };
  // A captcha's own frame is Lisul's to do (apply.captcha): nothing in it is the application.
  const host = location.hostname, path = location.pathname;
  if (any(@CAPTCHA_HOSTS@, (h) => host === h || endsWith(host, '.' + h)) || any(@CAPTCHA_PATHS@, (p) => startsWith(path, p))) {
@CAPTCHA@
    return;
  }
  // Lifted, Lisul's page lets everything through, unless Apply holds its Submit (a legal answer the review
  // found wrong): then a button or request that sends is blocked still, and the held note says why. Paused: Apply
  // types an emailed code on his page (apply.email_code), with the guard on meanwhile.
  const held = () => @HELD@;
  const lifted = () => S.lifted && !S.paused && !held();
  const blocked = W.__@KEY@Blocked = [];
  let touched = false;  // a real click or key on the page: Apply's or Lisul's
  const note = (what) => {
    try {
      push(blocked, what);
      if (held()) {  // Lisul's own Submit on a held page: the held note says why, with its Dismiss button
        warn('@NAME@ held ' + what);
        showNote();
        return;
      }
      warn('@NAME@ blocked ' + what);@PORT_SAID@
      // The page's own script, with no click or key on it yet (a cookie banner, analytics): blocked, unshown.
      if (!touched) return;
      let box = D.getElementById('@BOX@');
      if (!box) {
        box = D.createElement('div');
        box.id = '@BOX@';
        // Under a captcha's challenge (reCAPTCHA's is z-index 2000000000), so its Verify stays pressable.
        box.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:1999999999;padding:6px 10px;'
          + 'background:#b00020;color:#fff;font:13px sans-serif;border-radius:4px;pointer-events:none';
        (D.body || D.documentElement).appendChild(box);
      }
      box.textContent = '@NAME@: blocked ' + what + '. Nothing was sent.';
    } catch (e) {}
  };
  // A guard listener that throws blocks what it was judging, as a page that could make it throw would want it not to.
  const judged = (f) => function (event) {
    try {
      return apply(f, this, [event]);
    } catch (e) {
      try { prevent(event); stopNow(event); } catch (e2) {}
      note('what the guard could not read (' + Str(e && e.message) + ')');
    }
  };
  // Plain code's own press (KAN-710): Apply arms the account click (true, or on a CDP Worker the element it
  // presses, in that element's frame alone), then presses. Only a press that lands in this frame on that element
  // counts: a trusted click, or on a plain Worker an untrusted one right after the worker extension marks its press.
  // A frame inside the pressed element, a page's own click, or a click before the arming never counts.
  const armed = () => S.account;
  let press = null;  // {event, target, by, form}: the last press of Apply's (or, on a held page, Lisul's)
  let userClick = null;  // the click in dispatch that is Apply's or Lisul's own
  const user = (event) => event.isTrusted || event === userClick;
  on('click', judged((event) => {
    userClick = event.isTrusted || now() < S.touchUntil ? event : null;
    S.touchUntil = 0;
    const at = armed();
    if (!userClick) return;
    const target = targetGet(event);
    press = isEl(target) && (!at || at === true || contains(at, target))
      ? {event, target, by: at, form: ownForm(up(target, 'button, input')) || up(target, 'form'), sending: sendingForms()}
      : null;
  }));
  // Plain code's press is on: armed, and the press came under this same arming.
  const accountClick = () => !!press && !!press.by && press.by === armed();
  // A form's submission is the press's own: the pressed button sends it (by), or the pressed element's own form goes
  // on (a Next whose handler calls form.submit() or requestSubmit(), or checks its step by fetch first). A Next that
  // is in no form posts, while its press is being dispatched, only a form that shows a field of the step (KAN-710):
  // never another form a script posts meanwhile (one of hidden fields only), nor a form in a frame inside it.
  const pressed = (form, by) => !!press && ((isEl(by) && contains(by, press.target)) || (!!form && form === press.form)
    || (!press.form && phaseGet(press.event) !== 0 && !!form && any(fields(form), (n) =>
      !test(/^(hidden|submit|button|reset|image)$/i, typeOf(n)) && test(/^(INPUT|SELECT|TEXTAREA)$/, tag(n)) && seen(n))));
  const fromPress = (form, by) => accountClick() && pressed(form, by);
  // The forms that had a button that sends as the press landed (KAN-710): the press's own handlers may rename or take
  // away a form's Submit, then post it, but a form that had one is never a step's.
  const sendingForms = () => { const out = [], forms = all(D, 'form'); for (let i = 0; i < forms.length; i++) if (formSends(forms[i])) push(out, forms[i]); return out; };
  const hadSends = (form) => formSends(form) || (!!press && any(press.sending, (f) => f === form));
  const password = (form) => !!form && !!one(form, 'input[type=password]');
  // A sign-in or new account's form: one with a password box, which no application's final button is in.
  const accountForm = (el) => password(formOf(el));
  // A verification code's form: one with a one-time-code box, which no application's final button is in either.
  const codeForm = (el) => { const form = formOf(el); return !!form && !!one(form, 'input[autocomplete=one-time-code]'); };
  // Plain code's click on the button of a profile step before the application (Microsoft's
  // "Create your profile" pop-up names its button Submit, live: KAN-647).
  const profileClick = () => S.profile;
  // Whether an open pop-up is a profile step before the application, as apply.submit_guard.PROFILE_DIALOG says.
  const PROFILE_TITLE = /\b(?:create|complete|build|set\s*up|finish)\b[^.]{0,30}\bprofile\b/i;
  const NOT_PROFILE = /\b(?:appl(?:y|ying|ication)|job|position|role)\b/i;
  const ASKS = 'input[type=file], textarea, input[type=checkbox], [role=checkbox], input[type=radio], [role=radio], input[type=password]';
  const profileDialog = (dialog) => {
    const ids = wordList(text(attr(dialog, 'aria-labelledby')));
    let by = '';
    for (let i = 0; i < ids.length; i++) { const n = byId(D, ids[i]); by += (i ? ' ' : '') + (n ? innerText(n) : ''); }
    const heading = qs(dialog, 'h1, h2, h3, [role=heading]');
    const title = trim(text(attr(dialog, 'aria-label')) || by || (heading ? innerText(heading) : ''));
    if (!test(PROFILE_TITLE, title) || test(NOT_PROFILE, title) || qs(dialog, ASKS)) return false;
    const shown = (n) => typeOf(n) !== 'hidden' && typeOf(n) !== 'search' && seen(n);
    return !any(all(D, 'input, select, textarea'), (n) => !contains(dialog, n) && shown(n)
      && !closest(n, '[role=search], [role=dialog], [aria-modal=true], dialog'));
  };
  // Only a button that names no application, in a pop-up that is a profile step and no more.
  const profileStep = (el) => {
    const dialog = up(el, '[role=dialog], [aria-modal=true], dialog[open]');
    return !!dialog && !test(/\bappl(?:y|ying|ication)\b/i, wordsOf(el)) && profileDialog(dialog);
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
  const KNOWN_FINAL = [];  // all but the last: a job system's final URL known by more than its name
  for (let i = 0; i < FINAL_URLS.length - 1; i++) push(KNOWN_FINAL, FINAL_URLS[i]);
  // A page's own click logging, which the any-job-system rules above would take for its submit:
  // Eightfold's (Netflix, Lockheed Martin) sends POST /api/user_interaction/submit as each page loads.
  const NOT_FINAL = [/^https?:\/\/[^\/?#]+\/api\/user_interaction\//i];
  const FINAL_BODIES = [/"operationName"\s*:\s*"ApiSubmit/];
  const SENDS = /\b(submit|send|finish|complete)\b/i;
  const APPLY = /\bapply\b/i;
  const READS = /^(GET|HEAD|OPTIONS)$/i;
  for (const kind of ['pointerdown', 'keydown']) on(kind, (event) => { if (event.isTrusted) touched = true; });@PORT_TOUCH@
@NOTE@
  const isFinal = (method, url, body) => {
    if (lifted()) return false;
    if (test(READS, text(method) || 'GET')) return false;
    const href = resolve(text(url), base()) || text(url);
    if (any(NOT_FINAL, (r) => test(r, href))) return false;
    return any(FINAL_URLS, (r) => test(r, href)) || any(FINAL_BODIES, (r) => test(r, body));
  };

  // A button's words as a person reads them (KAN-710): its text, its value, its labels, its title, an image's alt, or
  // what the browser writes on a submit or image button with none ("Submit").
  const wordsOf = (el) => {
    const ids = wordList(text(attr(el, 'aria-labelledby')));
    let labelled = '';
    for (let i = 0; i < ids.length; i++) { const n = byId(D, ids[i]); if (n) labelled += ' ' + innerText(n); }
    const images = all(el, 'img[alt], svg title, [role=img][aria-label]');
    let pictured = '';
    for (let i = 0; i < images.length; i++) pictured += ' ' + (text(attr(images[i], 'alt')) || text(attr(images[i], 'aria-label')) || innerText(images[i]));
    const type = tag(el) === 'INPUT' ? lower(typeOf(el)) : '';
    const said = [innerText(el), type ? valueOf(el) : '', text(attr(el, 'aria-label')), labelled, text(attr(el, 'title')), pictured,
                  type === 'image' ? text(attr(el, 'alt')) : '', type === 'submit' || type === 'image' ? 'Submit' : ''];
    return find(said, (w) => !!trim(w)) || '';
  };
  // A button that sends: its words say so, or say apply on a form's button (a job page's Apply link is no form's).
  const sends = (el) => {
    const words = wordsOf(el);
    return test(SENDS, words) || (test(APPLY, words) && !!formOf(el));
  };

  // Clicks on a submit button, before any of the page's handlers.
  on('click', judged((event) => {
    const target = up(targetGet(event), 'button, input[type=submit], input[type=button], [role=button], a');
    if (!target) return;
    if (lifted()) {  // Lisul's page: his click goes through, and Apply hears of one that sends
      // Saying whether it was a sign-in, account or code form's (Workday's Sign in with email names its button
      // Submit): that press sends no application, so Resume still goes on after it. Only his own press: a trusted
      // click, or a plain Worker's press from the tile.
      if (sends(target) && user(event)) tell('__applyLisulPressed', slice(trim(wordsOf(target)), 0, 80),
        accountForm(target) || codeForm(target));
      return;
    }
    if (!sends(target)) return;
    // Plain code's own click on an account form's button: Workday names its button "Submit" in its
    // Sign in with email view (Sonos's, live), and that click only signs in.
    if (accountClick() && accountForm(target)) return;
    if (profileClick() && profileStep(target)) return;
    prevent(event);
    stopNow(event);
    note('the "' + slice(trim(wordsOf(target)), 0, 40) + '" click');
  }));
@EXTRA@

  // Named with its method and link, so a Handoff (and the Trace) says which request it was.
  const named = (method, url) => 'the application request (' + upper(text(method) || 'POST') + ' ' + slice(text(url), 0, 160) + ')';
  // A link's ping (hyperlink auditing): the browser POSTs to each of its URLs as it follows the link, and no
  // script sees it. Nothing Apply does needs one, so a guarded page sends none (KAN-710): each link's ping is
  // taken off as it is clicked, before the page's handlers, and no script can put one back while it is guarded.
  const unping = (el) => {
    const link = up(el, 'a, area');
    if (!link || lifted() || !hasAttr(link, 'ping')) return;
    const urls = wordList(text(attr(link, 'ping')));
    removeAttr(link, 'ping');
    const final = find(urls, (u) => isFinal('POST', u));
    if (final !== undefined) note(named('POST', final) + ' of a link');
  };
  // The element really clicked: one in a shadow root too, which the window hears as its host (KAN-710).
  const composedPath = fn(EvP, 'composedPath');
  const struck = (event) => { const path = composedPath(event); return path.length ? path[0] : targetGet(event); };
  on('click', judged((event) => unping(struck(event))));
  on('auxclick', judged((event) => unping(struck(event))));
  // A link a script clicks where no window hears it (one in no document, or in a shadow root): its ping comes off too.
  const clickOf = HP.click;
  HP.click = function () { if (!lifted()) { try { unping(this); } catch (e) { return; } } return apply(clickOf, this, []); };
  const dispatchOf = EventTarget.prototype.dispatchEvent, eventType = get(EvP, 'type');
  EventTarget.prototype.dispatchEvent = function (event) {
    if (!lifted() && isEl(this)) { try { const t = eventType(event); if (t === 'click' || t === 'auxclick') unping(this); } catch (e) {} }
    return apply(dispatchOf, this, [event]);
  };
  const PING = (name) => { const n = Str(name); return lower(slice(n, lastIndexOf(n, ':') + 1)) === 'ping'; };
  const pings = (el, name) => !lifted() && PING(name) && isEl(el) && matches(el, 'a, area');
  for (const [proto, method, at] of [[EP, 'setAttribute', 0], [EP, 'setAttributeNS', 1], [EP, 'toggleAttribute', 0]]) {
    const was = proto[method];
    proto[method] = function (...args) {
      if (args.length > at) args[at] = Str(args[at]);  // read once: what is checked is what is set
      if (pings(this, args[at])) return method === 'toggleAttribute' ? false : undefined;
      return apply(was, this, args);
    };
  }
  const attrName = get(Attr.prototype, 'name');
  for (const method of ['setAttributeNode', 'setAttributeNodeNS']) {
    const was = EP[method];
    EP[method] = function (node) {
      let name = '';
      try { name = attrName(node); } catch (e) {}
      return pings(this, name) ? null : apply(was, this, [node]);
    };
  }
  for (const method of ['setNamedItem', 'setNamedItemNS']) {
    const was = NamedNodeMap.prototype[method];
    NamedNodeMap.prototype[method] = function (node) {
      let name = '';
      try { name = attrName(node); } catch (e) {}
      return PING(name) && !lifted() ? null : apply(was, this, [node]);
    };
  }
  for (const proto of [HTMLAnchorElement.prototype, HTMLAreaElement.prototype]) {
    const was = gopd(proto, 'ping');
    if (was && was.set) defineProp(proto, 'ping', {...was, set(value) { if (!lifted()) return; apply(was.set, this, [value]); }});
  }

  // Native submission of a POST form.
  // The form has a button that sends: any of its buttons, a hidden one or one outside it (form=) too (KAN-710).
  // Any button: a button, a submit, image or button input, or what a script makes one (role=button) (KAN-710).
  const BUTTONS = 'button, input[type=submit], input[type=image], input[type=button], [role=button]';
  const formSends = (form) => any(all(form, BUTTONS), (n) => buttonSends(n)) || any(fields(form), (n) => buttonSends(n));
  const buttonSends = (n) => (tag(n) === 'BUTTON' || test(/^(submit|image|button)$/i, typeOf(n)) || attr(n, 'role') === 'button') && sends(n);
  const posts = (form, submitter) => {
    const method = (isEl(submitter) && text(attr(submitter, 'formmethod'))) || text(attr(form, 'method')) || 'get';
    return lower(method) === 'post';
  };
  // A submit that would send the application (by its Submit/Send button, or with no
  // button, as a script's requestSubmit() or a page's own Enter key does, from a form
  // that has one) reaches none of the page's handlers. A "Next" goes on.
  // A POST to a job system's final application URL (a CDP Worker routes none of those page URLs): never let
  // through by plain code's account, step or profile click (KAN-639, KAN-647), as a fetch to it never is.
  // Its target as the browser makes it (KAN-710), read by attribute (a field named "action" shadows form.action): a
  // submit button's formaction, else the form's action, relative to the form's base; an empty one (formaction="" too)
  // is the form's own document's URL.
  const submitButton = (el) => isEl(el) && (tag(el) === 'BUTTON' ? typeOf(el) === 'submit' : test(/^(submit|image)$/i, typeOf(el)));
  const postTarget = (form, by) => {
    const action = submitButton(by) && hasAttr(by, 'formaction') ? text(attr(by, 'formaction')) : text(attr(form, 'action'));
    return action === '' ? text(docURL(ownerDoc(form))) : resolve(action, text(baseOf(form))) || action;
  };
  // Any job system's final URL by its name alone (a path ending in /apply, the last of FINAL_URLS), not a known one.
  const byNameAlone = (form, by, at) => {
    const href = at || postTarget(form, by);
    return !any(KNOWN_FINAL, (r) => test(r, href));
  };
  // The page itself says steps remain after this one ("Step 2 of 5", a step list past the current step), and
  // the form has no button that sends. Then a POST to a path ending in /apply is a step, not the last (KAN-656).
  // No page saying so, or "Step 5 of 5", stays blocked: a step's Next there hands off, and nothing is sent.
  // Only what a person sees says so (KAN-710): text of no size, a list clipped to nothing or off the page says nothing.
  const STEP_OF = /\bstep\s*(\d+)\s*(?:of|\/)\s*(\d+)\b/i;
  const rectOf = fn(EP, 'getBoundingClientRect'), styleOf = W.getComputedStyle, styleValue = fn(CSSStyleDeclaration.prototype, 'getPropertyValue');
  const rectGets = {}, RECT = ['left', 'top', 'right', 'bottom', 'width', 'height'];
  for (let i = 0; i < RECT.length; i++) rectGets[RECT[i]] = get(DOMRectReadOnly.prototype, RECT[i]);
  const box = (el) => { const r = rectOf(el), out = {}; for (let i = 0; i < RECT.length; i++) out[RECT[i]] = rectGets[RECT[i]](r); return out; };
  const css = (el, name) => text(styleValue(apply(styleOf, W, [el]), name));
  const offX = gopd(W, 'pageXOffset').get, offY = gopd(W, 'pageYOffset').get, min = Math.min, max = Math.max;
  const scrollX = () => apply(offX, W, []), scrollY = () => apply(offY, W, []);
  const visibly = (el) => {
    if (!isEl(el) || (checkVis && !checkVis(el, {checkOpacity: true, checkVisibilityCSS: true}))) return false;
    const r = box(el);
    if (r.width < 2 || r.height < 6 || r.right + scrollX() <= 0 || r.bottom + scrollY() <= 0) return false;
    if (Num(slice(css(el, 'font-size'), 0, -2)) < 8) return false;
    for (let at = parentEl(el); at; at = parentEl(at)) {  // an ancestor that clips it to nothing hides it
      if (css(at, 'overflow-x') === 'visible' && css(at, 'overflow-y') === 'visible') continue;
      const c = box(at);
      if (min(r.right, c.right) - max(r.left, c.left) < 2 || min(r.bottom, c.bottom) - max(r.top, c.top) < 6) return false;
    }
    return true;
  };
  const childNodesOf = get(NP, 'childNodes'), nodeTypeOf = get(NP, 'nodeType'), nodeValueOf = get(NP, 'nodeValue');
  const ownText = (el) => {
    let said = '';
    const kids = nodes(childNodesOf(el));
    for (let i = 0; i < kids.length; i++) if (nodeTypeOf(kids[i]) === 3) said += text(nodeValueOf(kids[i]));
    return said;
  };
  const moreSteps = (form) => {
    if (formSends(form)) return false;
    const body = bodyOf(D), said = match(STEP_OF, body ? innerText(body) : '');
    if (said) {  // the step said where it shows: in an element of its own text that a person sees
      const els = all(D, 'body *');
      for (let i = 0; i < els.length && i < 5000; i++) {
        const own = match(STEP_OF, ownText(els[i]));
        if (own && visibly(els[i])) return Num(own[1]) < Num(own[2]);
      }
      return false;
    }
    const at = docQs(D, '[aria-current=step]'), next = at && nextEl(closest(at, 'li') || at);
    return !!next && visibly(at) && visibly(next);
  };
  // A step's Next only (KAN-710): the button plain code pressed, never a script's post or a step list's link.
  const postsFinal = (form, by, href) => posts(form, by) && isFinal('POST', href || postTarget(form, by))
    && !(byNameAlone(form, by, href) && isEl(by) && !!press && contains(by, press.target) && moreSteps(form));
  // A profile pop-up posting to its own page, on a URL final by its name alone: the pop-up is proven no application.
  const profileOwnPage = (form, by, href) => !(submitButton(by) && attr(by, 'formaction')) && !attr(form, 'action')
    && byNameAlone(form, by, href);
  // A sign-in relay's own post (an SSO, OIDC or SAML hand-off: Amazon's idp.federate "Signing you in...", live):
  // the page's script posts it before any click or key on the page, its fields are all hidden (a token, a
  // state), no button of it sends, and it is bound for no final URL. Nothing of an application is in it.
  const hiddenOnly = (form) => {
    const all_ = fields(form);
    return any(all_, (n) => typeOf(n) === 'hidden') && every(all_, (n) => typeOf(n) === 'hidden' || tag(n) === 'FIELDSET'
      || (test(/^(submit|button|reset)$/, typeOf(n)) && !sends(n)));
  };
  // A relay page is only that post (KAN-710): a page that shows a field of its own is a form, whose script may
  // post the application's hidden copy (TAL.net's submit=1) before any click. So a relay is the top page's own,
  // posted into itself, once the whole page has loaded (a field after the relay's script hasn't parsed yet before),
  // never a frame's: a frame doesn't know the fields of the page around it.
  const topGet = gopd(W, 'top').get, readyOf = get(DP, 'readyState');
  const fieldShown = () => any(all(D, 'input, select, textarea'), (n) =>
    !test(/^(hidden|submit|button|reset|image)$/i, typeOf(n)) && seen(n));
  const intoItself = (form, by) => {
    const target = (submitButton(by) && hasAttr(by, 'formtarget') ? text(attr(by, 'formtarget')) : text(attr(form, 'target')));
    return target === '' || lower(target) === '_self';
  };
  const relayLike = (form, by, href) => !touched && apply(topGet, W, []) === W && posts(form, by) && intoItself(form, by)
    && !postsFinal(form, by, href) && hiddenOnly(form);
  const relay = (form, by, href) => relayLike(form, by, href) && readyOf(D) !== 'loading' && !fieldShown();
  // Another site's widget loading itself into its own frame on the page, click or no click: LinkedIn's Apply
  // with LinkedIn on Microsoft's form (live, KAN-711) posts a form of hidden fields (its key, the job's code)
  // to linkedin.com into the iframe it just made, as the form loads. Bound for another site and no final URL,
  // into a frame of this page (its target names an iframe here), with nothing of the application in it.
  const frameLoad = (form, by, href) => {
    const target = (isEl(by) && text(attr(by, 'formtarget'))) || text(attr(form, 'target'));
    if (!target || startsWith(target, '_') || !posts(form, by) || postsFinal(form, by, href) || !hiddenOnly(form)) return false;
    const away = originOf(href || postTarget(form, by)) !== pageOrigin();
    return away && any(nodes(byName(D, target)), (n) => test(/^I?FRAME$/, tag(n)));
  };
  // Plain code's résumé attach (apply.attach): the page's own script posting the file it was just given, as iCIMS
  // posts its résumé to be parsed by a native submission (KAN-691). Only a form that holds a chosen file and has no
  // button that sends (KAN-710: the application's own form holds the résumé's input too, and its Submit), sent by no
  // button that sends, and never to a final URL; outside the attach's window it is blocked as ever.
  const uploadPost = (form, by, href) => S.upload && !(isEl(by) && sends(by)) && !formSends(form)
    && any(all(form, 'input[type=file]'), chosen) && !postsFinal(form, by, href);
  // The form the guard last let post, and whether by plain code's press: the navigation it makes comes a task later
  // (a script's form.submit()), when the press's dispatch is over, and may name another element its source.
  let posting = null;
  const judgeSubmit = judged((event) => {
    if (lifted()) return;
    const form = targetGet(event), by = submitterGet(event);
    if (!isForm(form)) return;
    posting = {form, by, press: fromPress(form, by)};
    if (readyOf(D) === 'loading' && relayLike(form, by)) {  // a relay's post as the page loads: judged once it has
      prevent(event);
      listen(D, 'DOMContentLoaded', () => {
        if (!relay(form, by)) return note('a form submission');
        posting = {form, by: null, press: false};
        apply(submit, form, []);
      });
      return;
    }
    if (!inShadow(form) && (relay(form, by) || frameLoad(form, by) || uploadPost(form, by))) return;
    // Plain code's sign-in, as above, but never a POST bound for the final URL: an application that makes an
    // account as it applies has a password box too (KAN-681).
    const apply_ = fromPress(form, by);
    if (apply_ && password(form) && !postsFinal(form, by)) return;
    if (profileClick() && profileStep(by || form) && (!postsFinal(form, by) || profileOwnPage(form, by))) return;  // plain code's profile step, as above
    const final = by ? sends(by) : formSends(form);
    // A held page is Lisul's but for its Submit: a Next goes on. A button that says nothing that sends, in a form
    // that has a Submit, goes on only by his own press of it, never by a script's requestSubmit() (KAN-710).
    if (held() && !final && (!by || !formSends(form) || (!!press && contains(by, press.target)))) return;
    if (final) stopNow(event);
    // Plain code's press posts a step: never a form that has a button that sends, whatever its submitter says
    // (another language, Done, a hidden one), nor one bound for the final URL (KAN-710).
    const step = apply_ && !postsFinal(form, by) && !hadSends(form) && !inShadow(form);
    if (final || (posts(form, by) && !step)) {
      prevent(event);
      note('a form submission');
    }
  });
  on('submit', judgeSubmit);
  // A form in a shadow root: its submit event stays in the root (it isn't composed), so the guard hears it at each
  // root a script makes, and at each one a press passes through (one the page wrote, KAN-710). Such a form is never a
  // step's, a relay or an upload's: the guard can't be sure what of it the window misses. Its post is judged as it
  // leaves (the navigate check) all the same.
  const heardRoots = new WeakSet(), wsHas = fn(WeakSet.prototype, 'has'), wsAdd = fn(WeakSet.prototype, 'add');
  const hearRoot = (root) => { if (!wsHas(heardRoots, root)) { wsAdd(heardRoots, root); listen(root, 'submit', judgeSubmit, true); } };
  const attachShadowOf = EP.attachShadow;
  EP.attachShadow = function (...args) { const root = apply(attachShadowOf, this, args); try { hearRoot(root); } catch (e) {} return root; };
  const isRoot = (x) => { try { return x !== D && nodeTypeOf(x) === 11 && !!hostOf(x); } catch (e) { return false; } };
  const hostOf = get(ShadowRoot.prototype, 'host'), rootOf = fn(NP, 'getRootNode');
  for (const kind of ['pointerdown', 'mousedown', 'keydown', 'click']) on(kind, (event) => {
    try { const path = composedPath(event); for (let i = 0; i < path.length; i++) if (isRoot(path[i])) hearRoot(path[i]); } catch (e) {}
  });
  const inShadow = (form) => { try { return rootOf(form) !== ownerDoc(form); } catch (e) { return true; } };
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (!isForm(this)) return apply(submit, this, []);
    let go = false;
    try {
      // Under plain code's click, a page script may post a step's form, but never one with a button that sends
      // or one bound for the final URL (a Continue whose handler calls the application form's submit()).
      const step = !inShadow(this) && fromPress(this, null) && !postsFinal(this, null) && (password(this) || !hadSends(this));
      go = lifted() || step || !posts(this, null)
        || (!inShadow(this) && (relay(this, null) || frameLoad(this, null) || uploadPost(this, null)));
    } catch (e) {}  // a form the guard can't read is not posted
    if (!go && readyOf(D) === 'loading' && relayLike(this, null)) {  // judged once the rest of the page is there
      const form = this;
      listen(D, 'DOMContentLoaded', () => {
        if (!relay(form, null)) return note('a form submission');
        posting = {form, by: null, press: false};
        apply(submit, form, []);
      });
      return;
    }
    if (!go) return note('a form submission');
    posting = {form: this, by: null, press: fromPress(this, null)};
    return apply(submit, this, []);
  };

  // The moment of sending (KAN-710): the page's own handlers run after the guard's submit listener, and may set the
  // form's action, rename or take away its Submit, or add to what it sends (its formdata event). The navigation the
  // submission makes carries what is really sent, its URL and entries, and the guard judges it again there, as it
  // leaves: a form post of this page by the same rules, with the URL it goes to; one whose entries the form's own
  // fields don't make, never; another document's post into this frame (a frame's form bound for the top page, a
  // widget's into its own frame) only when it is bound for no final URL and its form has no button that sends.
  const NavP = W.NavigateEvent && NavigateEvent.prototype;
  const navData = NavP && getter(NavigateEvent, 'formData'), navTo = NavP && getter(NavigateEvent, 'destination');
  const navFrom = NavP && getter(NavigateEvent, 'sourceElement'), destURL = W.NavigationDestination && getter(NavigationDestination, 'url');
  const FD = FormData, fdEntries = fn(FD.prototype, 'entries');
  const fdNext = (() => { try { const it = fdEntries(new FD()); return fn(Object.getPrototypeOf(it), 'next'); } catch (e) { return null; } })();
  const fileName = get(File.prototype, 'name');
  const entriesOf = (data) => {
    const out = [], it = fdEntries(data);
    for (let r = fdNext(it); !r.done; r = fdNext(it)) {
      const value = r.value[1];
      push(out, r.value[0] + '=' + (typeof value === 'string' ? value : '\u0000' + fileName(value) + ':' + blobSize(value)));
    }
    return out;
  };
  let reading = false;  // the guard reads a form's entries: no page handler of its formdata event runs meanwhile
  on('formdata', (event) => { if (reading) stopNow(event); });
  const ownEntries = (form, by) => {
    reading = true;
    try {
      try { return entriesOf(new FD(form, by || null)); } catch (e) { return entriesOf(new FD(form)); }
    } finally {
      reading = false;
    }
  };
  const sameEntries = (form, by, data) => {
    const sent = entriesOf(data), own = ownEntries(form, by);
    return sent.length === own.length && every(sent, (e) => any(own, (o) => o === e))
      && every(own, (o) => any(sent, (e) => e === o));
  };
  const leaves = (form, by, href, data) => {  // the form post of this page, as it leaves: may it go?
    if (!sameEntries(form, by, data)) return false;
    if (inShadow(form)) return false;
    if (relay(form, by, href) || frameLoad(form, by, href) || uploadPost(form, by, href)) return true;
    const apply_ = fromPress(form, by) || (!!posting && posting.form === form && posting.press && accountClick());
    if (apply_ && password(form) && !postsFinal(form, by, href)) return true;
    if (profileClick() && profileStep(by || form) && (!postsFinal(form, by, href) || profileOwnPage(form, by, href))) return true;
    const final = isEl(by) ? sends(by) : formSends(form);
    if (held() && !final && (!by || !formSends(form) || (!!press && contains(by, press.target)))) return true;
    return !final && apply_ && !postsFinal(form, by, href) && !hadSends(form);
  };
  const hist = W.history, replaceState = fn(History.prototype, 'replaceState'), histState = get(History.prototype, 'state');
  if (navData && navTo && destURL && W.navigation) listen(W.navigation, 'navigate', judged((event) => {
    const data = navData(event);
    if (data === null || lifted()) return;  // only a form's post is judged here
    const href = destURL(navTo(event)), from = navFrom ? navFrom(event) : null;
    let go;
    if (isEl(from) && ownerDoc(from) === D) {
      // A script's form.submit() in a link's click names the link: the form is the one the guard last let post.
      const own = isForm(from) ? from : formOf(from);
      const form = own || (posting && posting.form), by = own ? (own === from ? null : from) : posting && posting.by;
      go = !!form && leaves(form, by, href, data);
    } else if (isEl(from)) {
      const form = isForm(from) ? from : formOf(from);
      go = !isFinal('POST', href) && !!form && !formSends(form) && sameEntries(form, form === from ? null : from, data);
    } else {
      go = !isFinal('POST', href);
    }
    if (go) return;
    prevent(event);
    // A navigation cancelled here is one Playwright waits on: a same-page one tells it this one is done.
    try { replaceState(hist, histState(hist), '', pageURL()); } catch (e) {}
    note(named('POST', href) + ' as it left');
  }), true);

  // The final application request.
  const fetch = W.fetch, Prom = Promise, then = fn(Prom.prototype, 'then'), reject = (x) => apply(Prom.reject, Prom, [x]);
  const ReqP = Request.prototype, reqUrl = get(ReqP, 'url'), reqMethod = get(ReqP, 'method');
  const reqClone = fn(ReqP, 'clone'), reqText = fn(ReqP, 'text');
  const isRequest = (x) => { try { reqUrl(x); return true; } catch (e) { return false; } };
  const blobSize = get(Blob.prototype, 'size'), blobText = fn(Blob.prototype, 'text');
  const isBlob = (x) => { try { blobSize(x); return true; } catch (e) { return false; } };
  const paramsText = fn(URLSearchParams.prototype, 'toString');
  const paramsOf = (x) => { try { return paramsText(x); } catch (e) { return null; } };
  const refused = (method, url) => (note(named(method, url)), reject(new TypeErr('Blocked by the @NAME@')));
  W.fetch = function (input, init) {
    const request = isRequest(input) ? input : null;
    const url = request ? reqUrl(request) : Str(input);
    const method = text((init && init.method) || (request ? reqMethod(request) : 'GET'));
    const body = init && init.body !== undefined && init.body !== null ? init.body : null;
    if (isFinal(method, url, typeof body === 'string' ? body : paramsOf(body))) return refused(method, url);
    // A body that isn't text yet (a Request's, a Blob) is read first: Ashby's submit is named only there.
    if (!test(READS, method) && (body ? isBlob(body) : request)) {
      const args = arguments, self = this;
      return then(then(body ? blobText(body) : reqText(reqClone(request)), undefined, () => ''),
        (said) => isFinal(method, url, said) ? refused(method, url) : apply(fetch, self, args));
    }
    return apply(fetch, this, arguments);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__applyRequest = [method, url];
    return apply(open, this, arguments);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const sent = this.__applyRequest || [];
    const method = text(Str(sent[0])), url = Str(sent[1]);
    if (isFinal(method, url, typeof body === 'string' ? body : paramsOf(body))) {
      note(named(method, url));
      throw new DOMExc('Blocked by the @NAME@', 'NetworkError');
    }
    return apply(send, this, arguments);
  };
  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon, nav = navigator;
    navigator.sendBeacon = (url, data) => isFinal('POST', Str(url), typeof data === 'string' ? data : paramsOf(data))
      ? (note(named('POST', Str(url))), false) : apply(beacon, nav, [url, data]);
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
  const optIn = (words) => any(OPT_INS, (r) => test(r, words));
  const BOX = 'input[type=checkbox], [role=checkbox], [role=switch]';
  const PRESSES = BOX + ', button, input[type=submit], input[type=button], [role=button], a';
  const labelsGet = getter(HTMLInputElement, 'labels'), checkedGet = getter(HTMLInputElement, 'checked');
  const boxWords = (el) => {
    let words = '';
    const labels = read([labelsGet], el, null);
    if (labels) { const ls = nodes(labels); for (let i = 0; i < ls.length; i++) words += (i ? ' ' : '') + innerText(ls[i]); }
    const around = up(el, 'label') || parentEl(el);
    return trim(words) || text(attr(el, 'aria-label')) || (around ? innerText(around) : '');
  };
  // A checkbox's click has ticked it already; a role=checkbox's has yet to.
  const ticks = (el) => typeOf(el) === 'checkbox' ? read([checkedGet], el, false) === true : attr(el, 'aria-checked') !== 'true';
  on('click', judged((event) => {
    const el = up(targetGet(event), PRESSES);
    if (!el || lifted()) return;
    if (!accountClick() && !matches(el, BOX) && !matches(el, 'a:not([role=button])') && carriesCaptcha() && accountStep(el)) {
      prevent(event);
      stopNow(event);
      return note('the "' + slice(trim(wordsOf(el)), 0, 40) + '" click ' + SIGN_IN_CLICK);
    }
    const box = matches(el, BOX);
    const words = box ? boxWords(el) : wordsOf(el);
    if (box ? !(ticks(el) && optIn(words)) : !(test(CONTROLS, words) || (signsIn(el) && !accountClick()))) return;
    prevent(event);
    stopNow(event);
    note('the "' + slice(trim(words), 0, 40) + '" click');
  }));
  // A page that carries a captcha, its invisible kind too (apply.captcha.CARRIED), in this frame or a same-origin
  // one around it: an account step's button there runs the captcha, so it is Lisul's to press, never Claude's, and
  // plain code's account click never comes (apply.account_pages hands off first). AMD's iCIMS email step, KAN-703.
  const CAPTCHA_CARRIED = @CAPTCHA_CARRIED@, SIGN_IN_CLICK = @SIGN_IN_CLICK@;
  const winGet = (name) => { const d = gopd(W, name) || gopd(Window.prototype, name); return (self) => apply(d.get, self, []); };
  const parentGet = winGet('parent'), docGet = winGet('document');
  const carriesCaptcha = () => {
    for (let w = W; ; ) {
      try { if (docQs(docGet(w), CAPTCHA_CARRIED)) return true; } catch (e) { return false; }
      let above = w;
      try { above = parentGet(w); } catch (e) { return false; }
      if (above === w) return false;
      w = above;
    }
  };
  // An account step: a form with a password box, or one with an email or username box and few fields else (an
  // email step's Next): at most one more, or three on a page whose path signs in or makes an account.
  const ACCOUNT_PATH = /(?:^|[\/_.-])(?:log-?in|sign-?in|sign-?up|log-?on|register|registration|account)(?:$|[\/_.-])/i;
  const accountStep = (el) => {
    const scope = formOf(el) || D;
    if (one(scope, 'input[type=password]')) return true;
    const shown = [], ns = all(scope, 'input, select, textarea');
    for (let i = 0; i < ns.length; i++) {
      if (!test(/^(hidden|submit|button|reset|image|checkbox|radio)$/, typeOf(ns[i])) && seen(ns[i])) push(shown, ns[i]);
    }
    return shown.length <= (test(ACCOUNT_PATH, location.pathname) ? 4 : 2) && any(shown, (n) => typeOf(n) === 'email'
      || test(/e-?mail|user|login/i, text(attr(n, 'name')) + ' ' + text(attr(n, 'id')) + ' ' + text(attr(n, 'autocomplete'))));
  };
  // A sign-in or new account's own button, or its form sent another way (Enter): plain code's alone.
  const signsIn = (el) => { const form = formOf(el); return !!form && !matches(el, 'a') && password(form); };
  on('submit', judged((event) => {
    if (lifted() || accountClick()) return;
    const form = targetGet(event);
    if (!isForm(form)) return;
    if (carriesCaptcha() && accountStep(submitterGet(event) || form)) {
      prevent(event);
      stopNow(event);
      return note('a sign-in ' + SIGN_IN_CLICK);
    }
    if (!password(form)) return;
    prevent(event);
    stopNow(event);
    note('a sign-in');
  }));
  // Ask Claude's drive (DriveGuard.asking): each trusted act judged on the real element, its text and attributes,
  // by send_click's words. The hook sees a snapshot's role and name only; this sees type=password and the rest.
  const askFacts = @ASK_ELEMENT@;
  const SECRET = new RegExp(@ASK_SECRET@, 'i'), ATTESTS = new RegExp(@ASK_ATTEST@, 'i'), RESEND = new RegExp(@ASK_RESEND@, 'i');
  const DASHES = /[-_]+/g;
  const undashed = (s) => {
    let out = '', last = 0;
    DASHES.lastIndex = 0;
    for (let m = match(DASHES, s); m !== null; m = match(DASHES, s)) { out += slice(s, last, m.index) + ' '; last = m.index + m[0].length; }
    return out + slice(s, last);
  };
  const asking = (event) => S.asking && event.isTrusted && !lifted();
  const refuse = (event, what) => {
    prevent(event);
    stopNow(event);
    note(what);
  };
  on('beforeinput', judged((event) => {
    if (!asking(event)) return;
    const facts = askFacts(targetGet(event)), said = text(facts.text);
    if (facts.type === 'password' || test(SECRET, undashed(said + ' ' + text(facts.attrs)))) refuse(event, 'typing in a password or code field');
    else if (test(ATTESTS, said) && !S.askTick) refuse(event, 'typing in "' + slice(said, 0, 40) + '"');
  }));
  on('click', judged((event) => {
    if (!asking(event)) return;
    const el = up(targetGet(event), PRESSES);
    if (!el) return;
    const words = text(askFacts(el).text);
    if (matches(el, BOX)) {
      if (ticks(el) && test(ATTESTS, words) && !S.askTick) refuse(event, 'the "' + slice(words, 0, 40) + '" tick');
    } else if (test(RESEND, words)) refuse(event, 'the "' + slice(words, 0, 40) + '" click');
  }));
"""


# The drive guard in a captcha's own frame: while Claude drives (DriveGuard.arm), every click, tap and key
# there is refused before the captcha's own code hears it, so Claude never ticks, types in or solves one.
# Lisul's own clicks go through once Claude stops (DriveGuard.rest), for the captcha wait.
CAPTCHA_TRY = "a click or key in a captcha"
_IN_CAPTCHA = r"""
    const eventType = get(EvP, 'type');
    const refuse = (event) => {
      if (S.lifted || !S.driving || !event.isTrusted) return;
      prevent(event);
      stopNow(event);
      if (eventType(event) === 'pointerdown' || eventType(event) === 'keydown') warn('Apply drive guard blocked @TRY@');
    };
    for (const kind of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick',
                        'touchstart', 'touchend', 'keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'paste']) {
      on(kind, refuse);
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
TELL_CDP = "\n    apply(debugFn, con, ['@TELL_PREFIX@' + said]);"
TELL_PORT = "\n    dispatch(D, new Custom('@TELL_TYPE@', {detail: said}));"
TELLS = ("__applyLisulPressed", "__applyFillAgain", "__applyDismissHold", "__applyDismissApplied")

# A plain Worker's additions (port=True): the worker extension sends its touch (the token's) on the page before each
# press it makes (Apply's own, and Lisul's from the tile), and hears `__apply_said`.
PORT_TOUCH = "\n  on('@TOUCH@', (event) => { stopNow(event); touched = true; S.touchUntil = now() + 1000; });"
PORT_SAID = "\n      dispatch(D, new Custom('__apply_said', {detail: '@NAME@ blocked ' + what}));"

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

    def may_press(self, element) -> bool:
        """Whether plain code may press `element`: False when it holds a frame (KAN-710), where the press could land
        on another form (a sandboxed frame runs no guard at all)."""
        return control(self._page, {}, (), element=element) != "frame"

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
