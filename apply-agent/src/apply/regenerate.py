"""Regenerate one answer Claude wrote, with context Lisul adds (KAN-599).

While he reviews a rehearsal's form, each answer Claude wrote for that
Application (an essay, a short answer, a one-off answer) has a small "Add
context and regenerate" button: on the form itself, beside the field, and in
the Apply window's card. He types what Claude should know or change, and
Claude writes that one answer again:

- His context joins the Story bank first, under ADDED, as one line that
  names the question it was for (and, for a bare label, where it sits on the
  form): never a bare label alone. So the plan can quote it, the code gates
  trace its names and numbers, and every later essay can use it.
- The answer is written by the essay path itself (essays.answer), with a
  <redo> block holding the earlier answer and his context: the same sources
  (profile, Story bank, Stock answers, links, the resume's gate, the Company
  material with its brief, the Posting description), the same plan, editor
  and code gates, and the form's stated caps. A form whose essays read no
  Company material yet gets it now, by the same research (company.gather,
  brief.brief), for an essay or a question about the company.
- An answer over the form's cap, or with a name or number no source holds,
  never goes on the form: the old one stays, and he is told why. Any other
  gate or verifier flag (verify.essay) goes on the note beside it.
- A one-off answer in the Answer bank is replaced there by the new draft
  (still Claude's, unreviewed), unless its label is bare: a bare label is
  never banked out of context.

Plain code puts the answer in the field it found (the field showing Claude's
text, else the one with the question's id or name), with the page's own
input events, and reads it back. On a plain Worker's page (KAN-615) the
button, the lock and the read-back are fixed functions (apply.plain.fixed),
never eval, and the Fill engine puts the answer in, as it filled the form. Apply never clicks or submits anything for
it: the page stays Lisul's, and he can edit the new answer."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import date
from typing import get_args

from apply import asking, brief, captcha, company, essays, fill_engine, gates, verify
from apply import home as data_folder
from apply.adapters import Claude, JobSite
from apply.answer_bank import AnswerBank
from apply.fill_engine import company_specific
from apply.model import Posting, Question, Site, one_line
from apply.profile import ApplicantProfile

ESSAY, DRAFT, ONE_OFF = "essay", "draft", "one-off"  # an essay; a one-off in the Answer bank; one about this company only
TEXT_KINDS = ("text", "textarea")  # the fields a written answer goes in: never a pick from a list, never a file
ADDED = "## Added while reviewing answers"  # the Story bank's section of Lisul's added context
CONTEXT_CHARS = 2_000  # the most of his context kept
# A gate failure that keeps a new answer off the form: a fact no source holds.
INVENTED = (gates.UNTRACED_NUMBER, gates.UNTRACED_NAME)


@dataclass
class Written:
    """One answer Claude wrote for the form, as it went on the page."""

    question: Question
    text: str
    kind: str  # ESSAY, DRAFT or ONE_OFF
    state: str = ""  # "working" while Claude writes it again, "failed" when that went wrong, else ""
    why: str = ""  # what the last regenerate said: why it is not on the form, or its checks
    essay: "essays.Essay | None" = None  # the Essay, for the Essay cell

    def shown(self) -> dict:
        """As the window and the page list it."""
        return {"name": self.question.name, "label": one_line(self.question.label), "text": self.text,
                "kind": self.kind, "state": self.state, "why": self.why}


@dataclass
class Form:
    """What one Application's answers were written from, kept so one of them can be written again."""

    posting: Posting
    questions: list[Question]
    answers: dict  # the planned answers, by Question name
    material: str  # the <company> block with the Company brief (worker._Planned.known)
    posting_text: str
    written: list[Written] = field(default_factory=list)
    read: bool = True  # the Company material was read (a form with essays)

    def get(self, name: str) -> Written | None:
        return next((w for w in self.written if w.question.name == name), None)

    def shown(self) -> list[dict]:
        return [w.shown() for w in self.written]

    def essay_cell(self) -> str:
        return essays.as_cell([w.essay for w in self.written if w.essay is not None])


def form_of(planned) -> Form | None:
    """The Form of a filled Application (worker._Planned): each answer Claude
    wrote that went in a text field, in form order. None when Claude wrote none."""
    answers = planned.answers
    on_form = lambda q, text: q.kind in TEXT_KINDS and isinstance(text, str) and text and answers.get(q.name) == text
    written = [Written(e.question, e.text, ESSAY, essay=e) for e in planned.written if on_form(e.question, e.text)]
    written += [Written(d.question, d.answer, kind) for kind, drafts in ((DRAFT, planned.drafted), (ONE_OFF, planned.unbanked))
                for d in drafts if on_form(d.question, d.answer)]
    if not written:
        return None
    order = {q.name: i for i, q in enumerate(planned.questions)}
    written.sort(key=lambda w: order.get(w.question.name, len(order)))
    return Form(planned.posting, list(planned.questions), dict(answers), planned.known(), planned.text, written,
                read=planned.material is not None)


@dataclass(frozen=True)
class Redone:
    """How one regenerate went."""

    question: Question
    text: str = ""  # the new answer; "" when none goes on the form
    why: str = ""  # why it is not on the form
    checks: tuple[str, ...] = ()  # gate and verifier flags it still has, for the note beside it
    kept: str = ""  # the Story bank line his context became
    banked: bool = False  # the Answer bank has the new draft


def regenerate(claude: Claude, form: Form, name: str, context: str, profile: ApplicantProfile, bank: AnswerBank,
               today: date, site: JobSite | None = None) -> Redone:
    """Write the answer to the form's question `name` again with Lisul's
    `context`, and update `form` with it. Nothing is clicked or sent."""
    written = form.get(name)
    if written is None:
        raise KeyError(f"Claude wrote no answer to {name!r} on this form")
    q, context = written.question, context.strip()[:CONTEXT_CHARS]
    if not context:
        return Redone(q, why="Type what Claude should know or change first")
    kept = keep_context(q, form.questions, context, form.posting.company, today)
    material = _material(claude, form, written, site, today)
    answered = {other: form.answers[other.name] for other in form.questions
                if other.name in form.answers and other.name != name}
    redo = {q: (written.text, context)}
    if written.kind == ESSAY:
        [essay], _ = essays.answer(claude, form.posting, [q], [], profile, material, form.posting_text,
                                   answered=answered, redo=redo)
        text, failed = essay.text, list(essay.failed)
        if essay.plan and essay.plan.asks:
            return Redone(q, why="Claude needs more from you: " + "; ".join(essay.plan.asks), kept=kept)
    else:
        _, [draft] = essays.answer(claude, form.posting, [], [q], profile, material, form.posting_text,
                                   answered=answered, redo=redo)
        text, failed = ("" if draft.needs_lisul else draft.shown), []
    if not text:
        return Redone(q, why="Claude couldn't write it from your facts and this context: add the fact it lacks", kept=kept)
    if over := gates.over_cap(text, q):
        return Redone(q, why=f"the new answer is over the form's limit ({over[0]}), so the old one stays", kept=kept)
    if invented := [f for f in failed if f.startswith(INVENTED)]:
        return Redone(q, why="the new answer states " + "; ".join(invented) + ", so the old one stays", kept=kept)
    allowed = essays.sources(profile, material, facts=True)
    checks = tuple(failed) + tuple(f.why for f in verify.essay(one_line(q.label), text, profile, form.posting, allowed))
    banked = written.kind == DRAFT and _bank(bank, q, text, form.posting.company, today)
    written.text, written.why = text, "; ".join(checks)
    if written.kind == ESSAY:
        written.essay = replace(essay, failed=tuple(failed))
    form.answers[name] = text
    return Redone(q, text, checks=checks, kept=kept, banked=banked)


def keep_context(q: Question, questions: list[Question], context: str, company_name: str, today: date) -> str:
    """Lisul's context as one Story bank line under ADDED, naming the question
    it was for and where it sits, so it is never kept as a bare label. A line
    already there is not added again. Returns the line."""
    where = asking.where(q, questions)
    line = (f'- For "{one_line(q.label)}"' + (f" ({where})" if where else "") + f" at {company_name or 'one company'}: "
            f"{one_line(context)}")
    story = data_folder.STORY_BANK.read_text() if data_folder.STORY_BANK.is_file() else ""
    if line in story:
        return line
    if ADDED not in story:
        story = (f"{story.rstrip()}\n\n{ADDED}\nWhat the applicant added, in their own words, when they asked Claude to "
                 "write one answer again.\n")
    data_folder.STORY_BANK.write_text(f"{story.rstrip()}\n{line} ({today.isoformat()})\n")
    return line


def _material(claude: Claude, form: Form, written: Written, site: JobSite | None, today: date) -> str:
    """The Company material: as the form read it, or read now, as an essay's is, for an essay or a question about
    the company on a form that read none."""
    wants = written.kind == ESSAY or company_specific(written.question, form.posting)
    if form.read or site is None or not wants:
        return form.material
    read = company.gather(form.posting, [written.question], site)
    found = brief.brief(form.posting, site, claude, today, form.posting_text, form.questions)
    form.material, form.read = company.with_source(read, brief.SOURCE, found), True
    return form.material


def _bank(bank: AnswerBank, q: Question, text: str, company_name: str, today: date) -> bool:
    """The new draft in the Answer bank, in place of the old; never under a bare label."""
    if len(re.sub(r"\([^)]*\)", "", q.label).split()) <= asking.BARE:
        return False
    return bank.redraft(q, text, company_name, today)


# On a page held for Lisul: a small button beside each field that shows an answer Claude wrote. It is drawn over
# the page (fixed, on the page's body), never inside the form, so the page's own code never sees a new node in its
# form. Each scan finds the fields again: a step loaded later, or a field that moved, gets its button too.
# OFFER is a function of the answers ({name, text} each): a CDP page runs it as an init script (`script`), and a
# plain Worker's page as a fixed function (apply.plain.fixed: no eval, so page CSP never stops it), in the page's
# own world, where the __applyRegenerate binding is.
OFFER = r"""
(written) => {
  window.__applyWritten = written;
  if (window.__applyRegenOn) return;
  window.__applyRegenOn = true;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const css = 'font:12px -apple-system,BlinkMacSystemFont,sans-serif;';
  const layer = () => {
    let box = document.getElementById('apply-regenerate');
    if (!box) {
      box = document.createElement('div');
      box.id = 'apply-regenerate';
      box.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:1999999998';
      (document.body || document.documentElement).appendChild(box);
    }
    return box;
  };
  const fieldFor = (w) => {
    const marked = document.querySelector('[data-apply-written="' + CSS.escape(w.name) + '"]');
    if (marked && marked.isConnected) return marked;
    const boxes = [...document.querySelectorAll('textarea, input')].filter((b) => b.type !== 'hidden'
      && (b.tagName === 'TEXTAREA' || ['text', 'search', 'url', ''].includes(b.type)));
    const found = boxes.find((b) => norm(b.value) && norm(b.value) === norm(w.text))
      || boxes.find((b) => b.id === w.name || b.name === w.name);
    if (found) found.setAttribute('data-apply-written', w.name);
    return found;
  };
  const setValue = (el, text) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    el.dispatchEvent(new Event('blur'));
  };
  const controls = {};
  const control = (w) => {
    if (controls[w.name]) return controls[w.name];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;display:none;' + css;
    wrap.dataset.for = w.name;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '↻ Add context and regenerate';
    button.title = 'Tell Claude more, and it writes this answer again. Nothing is sent.';
    button.style.cssText = css + 'padding:2px 8px;border:1px solid #6750a4;border-radius:12px;background:#fff;'
      + 'color:#4a3880;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.15)';
    const panel = document.createElement('div');
    panel.style.cssText = 'display:none;margin-top:4px;width:340px;padding:8px;background:#fff;border:1px solid #6750a4;'
      + 'border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.2);color:#222';
    const label = document.createElement('div');
    label.textContent = 'What should Claude know or change? It rewrites only this answer from your facts and this.';
    const box = document.createElement('textarea');
    box.rows = 3;
    box.placeholder = 'e.g. Lead with the club project; I led a team of 5 there.';
    box.style.cssText = css + 'width:100%;box-sizing:border-box;margin:6px 0';
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = 'Regenerate';
    go.style.cssText = css + 'padding:3px 10px;background:#6750a4;color:#fff;border:none;border-radius:4px;cursor:pointer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.cssText = css + 'margin-left:6px;padding:3px 10px;background:none;border:1px solid #999;border-radius:4px;cursor:pointer';
    const said = document.createElement('div');
    said.style.cssText = 'margin-top:6px;white-space:pre-wrap';
    panel.append(label, box, go, cancel, said);
    wrap.append(button, panel);
    for (const el of [button, go, cancel, box]) {  // the page's own handlers never hear these
      for (const kind of ['click', 'mousedown', 'keydown', 'keyup', 'input']) el.addEventListener(kind, (e) => e.stopPropagation());
    }
    // An open panel sits above the next field's button.
    const show = (open) => { panel.style.display = open ? 'block' : 'none'; wrap.style.zIndex = open ? '2' : '1'; };
    button.addEventListener('click', () => { show(panel.style.display === 'none'); box.focus(); });
    cancel.addEventListener('click', () => show(false));
    go.addEventListener('click', () => {
      if (!norm(box.value)) { said.textContent = 'Type what Claude should know or change first.'; return; }
      if (window.__applyRegenerate) window.__applyRegenerate(w.name, box.value);
      window.__applyRegenWorking(w.name);
    });
    layer().appendChild(wrap);
    return controls[w.name] = {wrap, button, panel, box, go, said};
  };
  const place = () => {
    for (const w of window.__applyWritten || []) {
      const el = fieldFor(w), c = control(w), r = el && el.getBoundingClientRect();
      if (!r || !r.width || r.bottom < 0 || r.top > innerHeight) { c.wrap.style.display = 'none'; continue; }
      c.wrap.style.display = 'block';
      c.wrap.style.top = Math.max(0, r.top - 24) + 'px';
      c.wrap.style.left = Math.max(0, Math.min(r.right - 220, innerWidth - 350)) + 'px';
    }
  };
  window.__applyRegenWorking = (name) => {
    const w = (window.__applyWritten || []).find((x) => x.name === name), el = w && fieldFor(w), c = w && control(w);
    if (!c) return false;
    if (el) { el.readOnly = true; el.style.opacity = '0.55'; }
    c.go.disabled = c.box.disabled = c.button.disabled = true;
    c.button.textContent = '⏳ Claude is rewriting this answer…';
    c.said.style.color = '#222';
    c.said.textContent = 'Working: Claude reads your facts, the posting and the company, then writes it again. Nothing is sent.';
    c.panel.style.display = 'block';
    c.wrap.style.zIndex = '2';
    return !!el;
  };
  window.__applyRegenDone = (name, text, note, ok) => {
    const w = (window.__applyWritten || []).find((x) => x.name === name), el = w && fieldFor(w), c = w && control(w);
    if (!c) return null;
    if (el) { el.readOnly = false; el.style.opacity = ''; }
    c.go.disabled = c.box.disabled = c.button.disabled = false;
    c.button.textContent = '↻ Add context and regenerate';
    c.said.style.color = ok ? '#1b5e20' : '#b00020';
    c.said.textContent = note;
    if (!ok || !el) return el ? el.value : null;
    c.box.value = '';
    if (text === null) return el.value;  // unlocked only: the Fill engine puts the answer in (a plain Worker's page)
    setValue(el, text);
    w.text = text;
    return el.value;
  };
  window.__applyRegenShown = (name) => {
    const w = (window.__applyWritten || []).find((x) => x.name === name), el = w && fieldFor(w);
    return el ? el.value : null;
  };
  setInterval(place, 500);
  addEventListener('scroll', place, true);
  addEventListener('resize', place);
  if (document.body) place(); else document.addEventListener('DOMContentLoaded', place);
}
"""
# The page functions offer's controls answer to, run in each frame: the same strings on both kinds of Worker.
WORKING = "(name) => window.__applyRegenWorking ? window.__applyRegenWorking(name) : false"
DONE = "([name, text, note, ok]) => window.__applyRegenDone ? window.__applyRegenDone(name, text, note, ok) : null"
SHOWN = "(name) => window.__applyRegenShown ? window.__applyRegenShown(name) : null"


def _shown(written: list[dict]) -> list[dict]:
    return [{"name": w["name"], "text": w["text"]} for w in written]


def script(written: list[dict]) -> str:
    """OFFER on `written`, as an init script."""
    return f"({OFFER.strip()})({json.dumps(_shown(written))});"


def offer(page, written: list[dict], asked: Callable[[str, str], None] | None) -> None:
    """Put the button beside each of `written` on `page` and every page it loads
    later; `asked(name, context)` hears each press. Bind once per page: pass
    None for `asked` on a page bound before. A plain Worker's page has no init
    script for it: the hold loop calls `keep` on each turn instead."""
    if asked:
        page.expose_binding("__applyRegenerate", lambda source, name, context: asked(str(name), str(context)))
    if _plain(page):
        _in_frames(page, OFFER, _shown(written))
        return
    text = script(written)
    page.context.add_init_script(text)
    _in_frames(page, text)


def keep(page, written: list[dict]) -> None:
    """On each turn of a held page: a plain Worker's frames loaded since (a step, a reload) get the button
    too, with the answers as they are now. A CDP page's init script does this by itself."""
    if _plain(page):
        _in_frames(page, OFFER, _shown(written))


def working(page, name: str) -> bool:
    """Show the field `name` as being written again: read-only and dimmed. False when no frame shows it."""
    return any(_in_frames(page, WORKING, name))


def done(page, name: str, text: str, note: str, ok: bool, question: Question | None = None, site: str = "") -> str | None:
    """Put `text` in the field `name` (when `ok`), say `note` beside it, make it editable again, and return
    what the field shows now (its read-back); None when no frame shows the field.

    On a plain Worker's page, with the field's `question` and the form's job `site` (one the engine knows), the
    Fill engine puts the answer in, in the frame that shows the field, as it filled the form; where it can't (the field
    moved to a step it doesn't know), the page's own input events do, as on a CDP page."""
    if not (ok and _plain(page) and question is not None and site in get_args(Site)):
        shown = _in_frames(page, DONE, [name, text, note, ok])
        return next((s for s in shown if s is not None), None)
    frame = next((f for f, s in _each_frame(page, DONE, [name, None, note, True]) if s is not None), None)
    if frame is None:
        return None
    try:
        fill_engine.fill(frame, site, [question], {question.name: text})
    except Exception:
        frame.evaluate(DONE, [name, text, note, True])
    return frame.evaluate(SHOWN, name)


def _plain(page) -> bool:
    return getattr(page, "plain", False) is True  # a plain Worker's page (apply.plain.page); a Mock's attribute is not


def _in_frames(page, script: str, arg=None) -> list:
    return [shown for _, shown in _each_frame(page, script, arg)]


def _each_frame(page, script: str, arg=None) -> list:
    """(frame, what `script` gave) for each frame that ran it. A plain page skips captcha frames: Apply never
    puts its code in them."""
    shown = []
    for frame in page.frames:
        if _plain(page) and frame is not page and captcha.in_frame(frame.url):
            continue
        try:
            shown.append((frame, frame.evaluate(script, arg) if arg is not None else frame.evaluate(script)))
        except Exception:
            continue  # a frame gone or going: one loaded later gets the init script
    return shown
