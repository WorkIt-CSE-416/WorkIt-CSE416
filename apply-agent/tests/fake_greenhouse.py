"""A Greenhouse form's last moments, served to a headless browser: its Submit
button, and the security-code step Greenhouse shows before it takes some
applications (it emails an 8-character code to the applicant). Every other
request is refused, so nothing reaches a live site."""

from contextlib import contextmanager

from playwright.sync_api import sync_playwright

URL = "https://job-boards.greenhouse.io/acme/jobs/4012345"
CODE = "q7XmPa2R"

# The job-boards form's code step: a box per character (security-input-0..7).
BOXES = "".join(f'<input id="security-input-{i}" maxlength="1" aria-label="Security code {i + 1}">' for i in range(8))
# The older boards form's: one box.
ONE_BOX = '<label for="security_code">Security code</label><input id="security_code" name="security_code">'

PAGE = """<!doctype html><title>Acme</title>
<form onsubmit="return false">
  <button type="button" id="submit">Submit application</button>
  <div id="security" hidden>
    <p>A verification code was sent to test.person@example.com. Copy and paste it below to confirm your application.</p>
    {boxes}
    <button type="button" id="resend">Resend code</button>
  </div>
</form>
<script>
  let asked = false;
  document.getElementById("resend").onclick = () => window.resent();
  document.getElementById("submit").onclick = () => {{
    if ({asks} && !asked) {{ asked = true; document.getElementById("security").hidden = false; window.asked(); return; }}
    const code = [...document.querySelectorAll("#security input")].map(i => i.value).join("");
    if (!{asks} || code === "{code}") location.href = location.pathname + "/confirmation";
    else document.body.insertAdjacentHTML("beforeend", "<p class=error>Incorrect security code</p>");
  }};
</script>"""


class FakeGreenhouse:
    """`asks`: whether Greenhouse asks for a security code; `boxes`: its code
    boxes (BOXES or ONE_BOX). `on_asked` runs as the code step shows (Greenhouse
    mails the code then), `on_resend` when Apply asks for another."""

    def __init__(self, asks: bool = True, boxes: str = BOXES, on_asked=lambda: None, on_resend=lambda: None):
        self._page = PAGE.format(boxes=boxes, asks="true" if asks else "false", code=CODE)
        self._on_asked = on_asked
        self._on_resend = on_resend
        self.confirmed = False

    @contextmanager
    def open(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page()
                page.route("**/*", self._handle)
                page.expose_function("asked", self._on_asked)
                page.expose_function("resent", self._on_resend)
                page.goto(URL)
                yield page
            finally:
                browser.close()

    def _handle(self, route) -> None:
        url = route.request.url.split("?")[0]
        if url == URL:
            return route.fulfill(content_type="text/html", body=self._page)
        if url == f"{URL}/confirmation":
            self.confirmed = True
            return route.fulfill(content_type="text/html", body="<h1>Thank you for applying.</h1>")
        return route.abort()
