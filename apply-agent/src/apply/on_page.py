"""Needs you on the page (KAN-600): a Missing fact or an Essay fact that
Lisul answers on the held form itself, not in its Needs you card.

- `go_to(page, q)` is the card's Go to question: it scrolls the form to the
  field, focuses it and outlines it for a moment. A field on another step
  of a Workday form is not on the page: it says which step holds it, and
  moves nothing, so nothing filled is lost.
- `Watch` reads the fields of the questions that wait on Lisul, on each
  turn of the held page's hold loop. A field he changed, then left (blur)
  and let rest for IDLE_S, is his answer: so is one that rests TYPING_S
  with the caret still in it. A choice (a list, a radio button, a box)
  counts once it rests IDLE_S. The answer is the Fill engine's read-back
  of the field where the engine fills that job system; else what the page
  shows in it.
- `bare(label)` says whether a label says nothing without its section (a
  bare From, To or Start date): its answer is that form's alone, never banked.

The field is found in each frame of the page: by its job system's id or
name, else by its label (a Workday name is "<step> / <panel> / <label>").
The note that the submit guard puts on the page is never a field.
"""

import re
import time
from collections.abc import Callable
from dataclasses import dataclass

from apply import fill_engine
from apply.model import Question

IDLE_S = 2.0  # s a field Lisul changed, then left, rests before its value is his answer
TYPING_S = 15.0  # s a field rests with the caret still in it before its value is his answer
CHOICE = ("select", "multi_select", "radio", "checkbox", "boolean", "date")  # kinds answered by a pick, not typing
OUTLINE_S = 2.5  # s the field stays outlined after Go to question
# The Fill engine's job systems whose read-back needs no State, and Workday's, which takes a small one.
READBACK = {"greenhouse", "lever", "ashby", "rippling", "workable", "eightfold", "tiktok", "waymo", "smartrecruiters"}
STEPPED = {"workday"}
# The engine's contextFree (fill-engine KAN-595), for an engine pin that does not have it yet.
BARE_DATE = re.compile(r"^(from|to|start|end|start date|end date|date from|date to|from date|to date)( \([^)]*\))?$")

# In one frame: find the field of (name, label), and do `act` with it. "read": {found, focused, value};
# "go": scroll to it, focus it and outline it. Lever's labels are divs, Workday's names are paths.
FIELD = """([name, label, act, outlineMs]) => {
  const NOTE = '#apply-rehearsal-blocked';
  const CONTROL = 'input:not([type=hidden]), textarea, select, [contenteditable=true], [role=combobox], '
    + '[role=textbox], [role=spinbutton], button[aria-haspopup], [role=radio], [role=checkbox]';
  const norm = (s) => (s || '').replace(/[*\\u00a0]/g, ' ').replace(/\\s+/g, ' ').trim().toLowerCase();
  const ours = (el) => el && !el.closest(NOTE);
  const shown = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const segments = [...name.split(' / '), ...(label || '').split(' / ')].map(norm).filter(Boolean);
  const wanted = norm((label || name).split(' / ').pop());
  const isControl = (el) => el && el.matches && el.matches(CONTROL);
  const controlIn = (el) => isControl(el) ? el : [...el.querySelectorAll(CONTROL)].find((c) => ours(c) && shown(c));
  let control = null;
  const byId = name && document.getElementById(name);
  if (ours(byId)) control = controlIn(byId);
  if (!control && name) control = [...document.getElementsByName(name)].find((el) => ours(el) && el.type !== 'hidden');
  let box = control && (control.closest('[data-automation-id^=formField], .field, .application-question, fieldset, li') || control.parentElement);
  if (!control) {
    const says = (el) => { const t = norm(el.innerText || el.textContent); return t === wanted || (t.startsWith(wanted) && t.length - wanted.length <= 12); };
    const LABELS = 'label, legend, [class*=label], [id*=label], [data-automation-id*=abel]';
    const labels = [...document.querySelectorAll(LABELS)]
      .filter((el) => ours(el) && shown(el) && says(el));
    const found = [];
    // Another field's label between a label and the control found near it: that control is the other field's.
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const between = (l, c) => { const [first, last] = after(l, c) ? [l, c] : [c, l];
      return [...document.querySelectorAll('label, legend')].some((o) => o !== l && ours(o) && shown(o) && !o.contains(l)
        && !l.contains(o) && !o.contains(c) && after(first, o) && after(o, last)); };
    const nextTo = (around, l) => [...around.querySelectorAll(CONTROL)].find((c) => ours(c) && shown(c) && after(l, c));
    // Another field's label: one that names something (not an option's own label, which holds its control).
    const otherLabel = (el, l) => el !== l && !el.contains(l) && !l.contains(el) && !controlIn(el) && norm(el.innerText || el.textContent);
    for (const l of labels) {
      let c = l.htmlFor ? document.getElementById(l.htmlFor) : null;
      let around = l;
      for (let up = 0; !c && around && up < 6; up++) {
        c = isControl(around) ? around : nextTo(around, l) || controlIn(around);
        if (c && between(l, c)) { c = null; break; }
        if (c) break;
        // Never up into a box that labels other fields, whatever its labels are (Microsoft's are divs): its
        // controls are theirs ("Alternate Phone Number" read its contact section's first name, live 2026-11-06).
        const parent = around.parentElement;
        if (parent && [...parent.querySelectorAll(LABELS)].some((o) => ours(o) && otherLabel(o, l))) break;
        around = parent;
      }
      if (c && ours(c)) found.push([l, c, l.htmlFor ? c.closest('.field, fieldset, li') || c.parentElement : around]);
    }
    // A repeating section's field (Workday's "Education 1 / From"): the one whose panel says the name's path.
    // The nearest panel that names one of the path's parts wins (a Workday step's whole page names them all).
    const panels = segments.filter((s) => s !== wanted);
    const near = ([l]) => { let el = l; for (let up = 0; el && up < 12; up++, el = el.parentElement)
      if (panels.some((s) => norm(el.innerText).includes(s))) return up; return 99; };
    found.sort((a, b) => near(a) - near(b));
    if (found.length) [, control, box] = found[0];
  }
  if (!control) return {found: false};
  box = box || control;
  if (act === 'go') {
    control.scrollIntoView({block: 'center', behavior: 'smooth'});
    try { control.focus({preventScroll: true}); } catch (e) {}
    const was = [box.style.outline, box.style.outlineOffset, box.style.borderRadius, box.style.transition];
    Object.assign(box.style, {outline: '3px solid #f59e0b', outlineOffset: '4px', borderRadius: '6px', transition: 'outline-color 0.4s'});
    setTimeout(() => { [box.style.outline, box.style.outlineOffset, box.style.borderRadius, box.style.transition] = was; }, outlineMs);
    return {found: true};
  }
  const text = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  // Only the field's own controls are read: a box that is a whole section (a fieldset, a list item) holds
  // other fields too, and theirs are never this field's answer (KAN-693). A radio or box group is one field.
  const group = (c) => c.matches('input[type=radio], input[type=checkbox]') ? 'boxes:' + (c.name || '')
    : c.matches('[role=radio], [role=checkbox]') ? (c.closest('[role=radiogroup], [role=group]') || 'roles') : c;
  const own = (el) => [...el.querySelectorAll(CONTROL)].filter(ours).every((c) => group(c) === group(control));
  const mixed = !own(box);
  const inBox = [...box.querySelectorAll(CONTROL)].filter((c) => ours(c) && (!mixed || group(c) === group(control)));
  if (mixed) {  // its pills (a picked option shown beside it) are in the smallest wrapper that is its alone
    let mine = control;
    while (mine.parentElement && mine.parentElement !== box && own(mine.parentElement)) mine = mine.parentElement;
    box = mine;
  }
  const values = [];
  for (const c of inBox.length ? inBox : [control]) {
    if (c.matches('input[type=radio], input[type=checkbox]')) {
      if (c.checked) values.push(text(c.closest('label') || document.querySelector(`label[for="${c.id}"]`) || c) || c.value);
    } else if (c.matches('[role=radio], [role=checkbox]')) {
      if (c.getAttribute('aria-checked') === 'true') values.push(text(c));
    } else if (c.tagName === 'SELECT') {
      if (c.value) values.push(text(c.selectedOptions[0] || c));
    } else if (c.matches('input, textarea')) {
      if (c.value.trim()) values.push(c.value.trim());
    } else if (c.matches('button[aria-haspopup]')) {
      const t = text(c); if (t && !/^select one$/i.test(t)) values.push(t);
    } else if (c.isContentEditable) {
      if (text(c)) values.push(text(c));
    }
  }
  for (const pill of box.querySelectorAll('[data-automation-id=selectedItem], [class*=singleValue], [class*=multiValue__label]'))
    if (ours(pill) && text(pill)) values.push(text(pill));
  const active = document.activeElement;
  return {found: true, focused: !!(active && active !== document.body && box.contains(active)), value: [...new Set(values)].join('; ')};
}"""


def bare(label: str) -> bool:
    """Whether `label` says nothing of what it asks without its section: a bare From, To or Start date.
    The engine's contextFree when its pin has it, else the same test."""
    try:
        return bool(fill_engine.call_without_page("contextFree", label))
    except Exception:
        return bool(BARE_DATE.match(re.sub(r"\s+", " ", label.replace("*", " ")).strip().casefold()))


def _in_frames(page, q: Question, act: str) -> dict:
    """What FIELD found for `q` in the first frame of `page` that has its field: {} when none has."""
    for frame in page.frames:
        try:
            found = frame.evaluate(FIELD, [q.name, q.label, act, int(OUTLINE_S * 1000)])
        except Exception:
            continue  # a frame navigating, or one of another site that is gone
        if found and found.get("found"):
            return found
    return {}


def step_of(q: Question) -> str:
    """The form step a Question is on, when its name says (Workday's "<step> / <label>"); else ""."""
    name, label = re.sub(r" \(\d+\)$", "", q.name), q.label.strip()
    if label and name.endswith(label) and len(name) > len(label):
        return name[:-len(label)].rstrip(" /").split(" / ")[0]
    return ""


def go_to(page, q: Question) -> str:
    """Bring the page's tab forward, scroll to `q`'s field, focus it and outline it. "" when it did;
    else why not, in a line for Lisul. A field on another step is never gone to: Apply moves no step."""
    try:
        page.bring_to_front()
    except Exception:
        pass
    if _in_frames(page, q, "go"):
        return ""
    if (step := step_of(q)) and step != q.label.strip().split(" / ")[0]:
        return (f"'{q.label.strip()}' is on the form's '{step}' step, not the one shown. Go there with the form's "
                "Back or Save and Continue (what you filled stays), then press Go to question again.")
    return f"Apply couldn't find '{q.label.strip()}' on the page: look for it on the form, or answer it in Needs you."


@dataclass
class _Seen:
    baseline: str  # what the field showed when the watch began: Apply's, never his answer
    value: str = ""
    since: float = 0.0  # when the value last changed
    left: bool = False  # the caret left the field after he changed it


class Watch:
    """The fields of the questions waiting on Lisul on one held page. `tick(page, questions)` returns
    each question whose field he has finished answering since, with his answer: once each."""

    def __init__(self, job_system: str, url: str = "", now: Callable[[], float] = time.monotonic):
        self._job_system, self._url, self._now = job_system, url, now
        self._seen: dict[str, _Seen] = {}

    def tick(self, page, questions: list[Question]) -> list[tuple[Question, str]]:
        done, now = [], self._now()
        for q in questions:
            found = _in_frames(page, q, "read")
            if not found:
                continue  # not on the page shown (another step): his answer there is read once he is back
            value = str(found.get("value") or "")
            seen = self._seen.get(q.name)
            if seen is None:
                self._seen[q.name] = _Seen(value, value, now)
                continue
            if value != seen.value:
                seen.value, seen.since, seen.left = value, now, False
            if found.get("focused") is False and value != seen.baseline:
                seen.left = True
            rested = now - seen.since
            if not value or value == seen.baseline:
                continue
            if rested >= IDLE_S and (seen.left or q.kind in CHOICE) or rested >= TYPING_S:
                del self._seen[q.name]
                done.append((q, self._read_back(page, q) or value))
        return done

    def forget(self, q: Question) -> None:
        """`q` waits on Lisul no more (answered in its card): its field is not watched now."""
        self._seen.pop(q.name, None)

    def _read_back(self, page, q: Question) -> str:
        """The field's value as the Fill engine reads it back, where it fills this job system; "" else."""
        try:
            if self._job_system in READBACK:
                shown = fill_engine.call(page, "readback", self._job_system, fill_engine.questions_arg([q]), [q.name])
            elif self._job_system in STEPPED and self._url:
                state = {"tenant": fill_engine.job_of(self._url)["tenant"], "trees": {}}
                shown = fill_engine.call(page, "readback", self._job_system, [], [q.name], state)
            else:
                return ""
        except Exception:
            return ""
        value = (shown or {}).get(q.name)
        if isinstance(value, list):
            return "; ".join(map(str, value))
        return str(value or "").strip()
