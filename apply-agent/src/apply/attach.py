"""The résumé, attached in plain code before Claude fill drives a form.

Claude attaches a file through the browser's file chooser, which a custom
uploader may never open (live on Jobvite: "the Add Resume button did not open
a file chooser"). Here the résumé's own `input[type=file]` is found in any
frame, hidden or not, and given the file directly:

1. an input labelled for the résumé (its label, aria label, id or name);
2. else the one input in the part of the page that names the résumé;
3. else the résumé's upload button is clicked: it opens a file chooser, or
   reveals the one input behind it (Jobvite's menu, whose input sits at the
   end of the page, far from its "Add Resume" heading). A button that doesn't
   name the résumé counts when it is the one upload button in the part of the
   page that does (Airtable's "Drop files here or click to browse" under
   "Please upload your resume").

It counts only once the page shows the file's name. Until then the guards let
the page's own script post the file it was given (iCIMS posts its résumé to be
parsed by a native form submission, which they block otherwise: KAN-691). Jobvite's country of
residence and privacy consent, when a tenant asks for them first, are passed
here too, so Claude never has to.

So is a pop-up that covers the form and takes every click meant for it
(Paylocity's "Apply with resume", on load): given the résumé if it asks for
one, else closed by its own close button or Escape. One still there is found
before Claude spends a token on a page it can't click.
"""

import re
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import Error, Frame, Page

RESUME = r"r[eé]sum[eé]|\bcv\b"
COVER = r"cover"
UPLOAD = r"\b(upload|browse|attach|choose (a )?file|drop files?)\b"
# An uploader's own dialog that holds a chosen file until its button sends it on (Uppy's).
SEND_ON = re.compile(r"^\s*upload( \d+)? files?\s*$", re.IGNORECASE)
FOUND_WITHIN = 5.0  # seconds for a still-rendering form to show its résumé input
SHOWN_WITHIN = 10.0  # seconds for the page to show an attached file's name

# The résumé's input in one frame: its index among the frame's file inputs, or -1.
FIND = """([resume, cover]) => {
  const named = new RegExp(resume, 'i'), other = new RegExp(cover, 'i');
  const inputs = [...document.querySelectorAll('input[type=file]')];
  const text = id => (document.getElementById(id) || {}).textContent || '';
  const own = el => [el.id, el.name, el.getAttribute('aria-label') || '',
    ...[...(el.labels || [])].map(l => l.textContent),
    ...(el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean).map(text)].join(' ');
  const labelled = inputs.findIndex(el => named.test(own(el)) && !other.test(own(el)));
  if (labelled >= 0) return labelled;
  const scope = el => {  // the widest part of the page holding this input and no other
    let text = '';
    for (let node = el.parentElement, up = 0; node && up < 6; node = node.parentElement, up++) {
      if (node.querySelectorAll('input[type=file]').length > 1) break;
      text = node.textContent;
    }
    return text;
  };
  const near = inputs.map((el, i) => [i, scope(el)]).filter(([, s]) => named.test(s) && !other.test(s));
  return near.length === 1 ? near[0][0] : -1;
}"""
# The file inputs a person could reach now: the input, its label or its box shows.
# A folder's input (Uppy's, beside its files' input) never takes the résumé.
REACHABLE = """() => [...document.querySelectorAll('input[type=file]')].map(el => !el.webkitdirectory &&
  [el, ...(el.labels || []), el.parentElement].some(n => n && n.checkVisibility && n.checkVisibility()))"""

# The pop-up covering the page, marked data-apply-pop-up, and what it says; "" if none.
# Covering: one fixed layer, nearly the whole window, on top at most points of the
# window, holding no more than one of the page's fields while others lie under it.
POP_UP = """() => {
  for (const old of document.querySelectorAll('[data-apply-pop-up]')) old.removeAttribute('data-apply-pop-up');
  const w = innerWidth, h = innerHeight;
  const layer = (x, y) => {
    for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
      const box = el.getBoundingClientRect();
      if (getComputedStyle(el).position === 'fixed' && box.width >= w * 0.9 && box.height >= h * 0.9) return el;
    }
    return null;
  };
  const points = [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]].map(([x, y]) => layer(w * x, h * y));
  const top = points.find(el => el && points.filter(p => p === el).length >= 3);
  if (!top) return '';
  const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')]
    .filter(el => el.checkVisibility());
  if (fields.filter(el => top.contains(el)).length > 1 || !fields.some(el => !top.contains(el))) return '';
  top.setAttribute('data-apply-pop-up', '1');
  const heading = top.querySelector('h1, h2, h3, [role=heading]');
  return ((heading && heading.innerText.trim()) || top.innerText.trim() || 'a pop-up').replace(/\\s+/g, ' ').slice(0, 80);
}"""
CLOSE = re.compile(r"^\s*(×|✕|x|close|dismiss|no,? thanks|not now|skip|maybe later|cancel)\b", re.IGNORECASE)

# The text of the widest part of the page that holds this upload button and no other.
UPLOAD_SCOPE = """(el, upload) => {
  const other = new RegExp(upload, 'i');
  const uploads = node => [...node.querySelectorAll('button, [role=button]')].filter(b => other.test(b.innerText || b.getAttribute('aria-label') || '')).length
    + node.querySelectorAll('input[type=file]').length;
  let text = '';
  for (let node = el.parentElement, up = 0; node && up < 6; node = node.parentElement, up++) {
    if (uploads(node) > 1) break;
    text = node.textContent;
  }
  return text;
}"""

# A plain file input on show displays its file's name in the browser's own control.
NATIVE = """name => [...document.querySelectorAll('input[type=file]')].some(el =>
  el.checkVisibility() && el.getBoundingClientRect().width > 1 && [...el.files].some(f => f.name === name))"""


def attach_resume(page: Page, resume: Path, guard=None) -> bool:
    """Attach `resume` to the open form's résumé field. True once the page
    shows its file name (as it may already); False if no input took it.
    `guard` (a DriveGuard) lets the page post the file meanwhile."""
    if _shows(page, resume.name, wait=0):
        return True
    deadline = time.monotonic() + FOUND_WITHIN
    while True:  # a form still rendering may not have its fields yet
        for frame in page.frames:
            try:
                index = frame.evaluate(FIND, [RESUME, COVER])
                if index >= 0:
                    with _posting(guard):
                        frame.locator("input[type=file]").nth(index).set_input_files(resume)
                        return _shows(page, resume.name)
            except Error:
                continue  # a frame that went away, or one that refuses scripts
        if time.monotonic() >= deadline:
            with _posting(guard):
                return _behind_button(page, resume)
        page.wait_for_timeout(250)


@contextmanager
def _posting(guard):
    """The guards let the page's own script post the file it is given, while plain code attaches it and waits
    for its name to show: iCIMS's résumé parse, which waits on "Parsing resume, please wait..." for good
    otherwise (KAN-691). A button that sends, and the final application URLs, stay blocked."""
    if guard is None:
        yield
        return
    guard.let_upload_post()
    try:
        yield
    finally:
        guard.let_upload_post(False)


def _resume_button(frame: Frame):
    """The résumé's upload button in the frame: one that names it, else the
    one upload button in the part of the page that names it; None if neither."""
    named = frame.get_by_role("button", name=re.compile(RESUME, re.IGNORECASE))
    if named.count() and named.first.is_visible():
        return named.first
    near = [b for b in frame.get_by_role("button", name=re.compile(UPLOAD, re.IGNORECASE)).all()
            if b.is_visible() and (scope := b.evaluate(UPLOAD_SCOPE, UPLOAD))
            and re.search(RESUME, scope, re.IGNORECASE) and not re.search(COVER, scope, re.IGNORECASE)]
    return near[0] if len(near) == 1 else None


def _behind_button(page: Page, resume: Path) -> bool:
    for frame in page.frames:
        try:
            button = _resume_button(frame)
            if button is None:
                continue
            before = frame.evaluate(REACHABLE)
            try:
                with page.expect_file_chooser(timeout=3_000) as chooser:
                    button.click()
                chooser.value.set_files(resume)
                return _shows(page, resume.name)
            except Error:
                pass  # no chooser: look for the input the click revealed
            after = frame.evaluate(REACHABLE)
            revealed = [i for i, now in enumerate(after) if now and not (i < len(before) and before[i])]
            if len(revealed) == 1:
                frame.locator("input[type=file]").nth(revealed[0]).set_input_files(resume)
                _send_on(frame)
                return _shows(page, resume.name)
        except Error:
            continue
    return False


def _send_on(frame: Frame) -> None:
    """Click the uploader dialog's "Upload 1 file", if it has one, and wait
    for the dialog to close: until then the form has no file."""
    page = frame.page
    deadline = time.monotonic() + 2.0
    while not (button := [b for b in frame.get_by_role("button", name=SEND_ON).all() if b.is_visible()]):
        if time.monotonic() >= deadline:
            return
        page.wait_for_timeout(250)
    button[0].click()
    deadline = time.monotonic() + SHOWN_WITHIN
    while any(b.is_visible() for b in frame.get_by_role("button", name=SEND_ON).all()) and time.monotonic() < deadline:
        page.wait_for_timeout(250)


def _shows(page: Page, name: str, wait: float = SHOWN_WITHIN) -> bool:
    deadline = time.monotonic() + wait
    while True:
        for frame in page.frames:
            try:
                if name.casefold() in frame.locator("body").inner_text(timeout=1_000).casefold():
                    return True
                if frame.evaluate(NATIVE, name):
                    return True
            except Error:
                continue
        if time.monotonic() >= deadline:
            return False
        page.wait_for_timeout(250)


def pass_jobvite_gate(page: Page) -> None:
    """Jobvite's country of residence and privacy consent, when the page asks
    for them: a U.S. resident outside California, as the applicant is."""
    country = page.locator("#jv-country-select")
    if not country.count() or not country.is_visible():
        return
    options = [o.strip() for o in country.locator("option").all_inner_texts()]
    us = [o for o in options if re.fullmatch(r"united states( of america)?|usa?|u\.s\.", o, re.IGNORECASE)]
    rest = [o for o in options if re.match(r"all locations except", o, re.IGNORECASE)
            and not re.search(r"united states|\bu\.?s\.?a?\b", o, re.IGNORECASE)]
    choice = (us or rest or [None])[0]
    if choice is None:
        return  # an unknown list: Claude reads it with the form
    country.select_option(label=choice)
    accept = page.get_by_role("button", name=re.compile(r"^\s*i accept\s*$", re.IGNORECASE))
    if accept.count():
        accept.first.click()


def clear_pop_up(page: Page, resume: Path | None) -> str:
    """Clear a pop-up that covers the form: give it the résumé if it asks for
    one, else close it. "" once none covers the form; else what it says."""
    for attempt in range(3):
        said = _pop_up(page)
        if not said:
            return ""
        pop_up = page.locator("[data-apply-pop-up]")
        file = pop_up.locator("input[type=file]")
        wait = 1.0
        try:
            if attempt == 0 and resume and file.count() == 1:
                file.set_input_files(resume)
                wait = SHOWN_WITHIN  # an upload may take a moment
            elif (close := [b for b in pop_up.get_by_role("button", name=CLOSE).all() if b.is_visible()]):
                close[0].click(timeout=3_000)
            else:
                page.keyboard.press("Escape")
        except Error:
            continue
        deadline = time.monotonic() + wait
        while _pop_up(page) and time.monotonic() < deadline:
            page.wait_for_timeout(250)
    return _pop_up(page)


def _pop_up(page: Page) -> str:
    try:
        return page.evaluate(POP_UP)
    except Error:
        return ""  # a page navigating away
