"""A plain Worker's typing, in a window without focus, reaches a box that holds its value only as
it is left (KAN-709). Workday's text box (FormoText) stores what it shows in Workday's form in
React's onBlur, a focusout, and nothing else does; a plain Worker's window sits behind Lisul's
apps, so focus() and blur() there fire no focus events, and NVIDIA's First Name showed but saved
empty. The worker extension's page scripts (page/dom.js, page/tile.js, after Playwright's injected
script) run here in Playwright's Chromium, with the page's focus emulation off and another page in
front: as unfocused as a plain Worker's."""

from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from apply.plain import extension

PAGE_DIR = Path(extension.__file__).resolve().parents[3] / "worker-extension" / "page"

# Workday's text box, as its apply-flow bundle builds it: an uncontrolled input whose value is held
# only by its onBlur (setValue(target.value)); Save reads what is held, as Workday's Save and Continue does.
FORM = """<!doctype html>
<input id=first data-held=""><input id=last data-held=""><p id=nothing style="height: 200px">Nothing to focus</p>
<button id=save>Save and Continue</button>
<script>
document.addEventListener('focusout', (e) => { if (e.target.matches('input')) e.target.dataset.held = e.target.value; });
save.onclick = () => { document.title = first.dataset.held + '|' + last.dataset.held; };
</script>"""


@pytest.fixture(scope="module")
def page():
    injected = extension.generated()["injected.js"].decode()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium")  # new headless: the shell is always focused
        context = browser.new_context()
        page = context.new_page()
        page.set_content(FORM)
        for script in (injected, (PAGE_DIR / "dom.js").read_text(), (PAGE_DIR / "tile.js").read_text()):
            page.add_script_tag(content=script)
        context.new_cdp_session(page).send("Emulation.setFocusEmulationEnabled", {"enabled": False})
        context.new_page().bring_to_front()
        assert page.evaluate("document.hasFocus()") is False
        yield page
        browser.close()


def dom(page, method, *args):
    answer = page.evaluate("([m, a]) => __applyDom.run(m, a)", [method, list(args)])
    assert "ok" in answer, answer
    return answer["ok"]


def tile(page, event):
    answer = page.evaluate("(e) => __applyTile.run(e)", event)
    assert "ok" in answer, answer
    return answer["ok"]


def press_on(page, selector):
    box = page.locator(selector).bounding_box()
    at = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
    tile(page, {"type": "down", "button": "left", **at})
    tile(page, {"type": "up", "button": "left", **at})


def reset(page):
    page.evaluate("for (const i of document.querySelectorAll('input')) { i.value = ''; i.dataset.held = ''; }"
                  "document.activeElement?.blur(); document.title = ''")


def test_a_box_filled_then_left_for_save_holds_its_value(page):
    # Claude's fill, then its click on Save and Continue: the box hears it is left before the click.
    reset(page)
    dom(page, "fill", "#first", "Test")
    dom(page, "fill", "#last", "Person")
    dom(page, "click", "#save")
    assert page.title() == "Test|Person"


def test_a_tab_and_a_click_on_nothing_leave_the_box(page):
    reset(page)
    dom(page, "type", "#first", "Test")
    dom(page, "keys", "Tab")
    dom(page, "type", "#last", "Person")
    dom(page, "click", "#nothing")
    assert page.evaluate("[first.dataset.held, last.dataset.held]") == ["Test", "Person"]


def test_lisul_typing_from_the_tile_is_held_once_he_clicks_elsewhere(page):
    reset(page)
    press_on(page, "#first")
    for character in "Test":
        tile(page, {"type": "text", "text": character})
    press_on(page, "#last")
    tile(page, {"type": "text", "text": "Person"})
    press_on(page, "#nothing")
    assert page.evaluate("[first.dataset.held, last.dataset.held]") == ["Test", "Person"]


def test_a_box_that_hears_its_own_leaving_is_not_told_twice(page):
    # In a focused window (Lisul's Show) blur() fires focusout itself: no second one by hand.
    reset(page)
    dom(page, "fill", "#first", "Test")
    page.evaluate("window.outs = 0; first.addEventListener('focusout', () => outs++);"
                  "first.blur = function () { this.dispatchEvent(new FocusEvent('focusout', {bubbles: true}));"
                  " HTMLElement.prototype.blur.call(this); }; 0")
    dom(page, "blur", "#first")
    assert page.evaluate("outs") == 1
