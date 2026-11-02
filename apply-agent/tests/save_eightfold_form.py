"""Save a live Eightfold Posting's form for offline tests. Never submits.

    uv run python tests/save_eightfold_form.py <posting-url> ../autofiller_extension/fill-engine/test/fixtures/forms/eightfold-<name> [<country>]

Writes <out-dir>/page.har (the form page, the assets it loads, its questions
and, with <country>, the States Eightfold loads for it) and
<out-dir>/questions.json (the questions API's answer). It attaches a dummy
résumé (a made-up name, no one's real details), so the HAR holds Eightfold's
answer to an upload; it accepts the privacy terms the upload opens. Every
other request that isn't a GET is aborted, so nothing is submitted. Re-save a
form and rerun its engine test to see whether Eightfold changed it.
"""

import json
import re
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import Route, sync_playwright

from apply.eightfold import form_url

QUESTIONS = "/api/application/v2/questions"
UPLOAD = "/api/application/v2/resume_upload"
# What the page needs to render and run; fonts and images are left out.
KEEP = re.compile(r"\.(js|css)(\?|$)|/api/|/careers/apply")
NAME = "Alex Example"
# Where Eightfold placed the browser by its IP address, written into the page: left out.
WHERE = re.compile(r'(ipGeolocation\w*(?:&#34;|\\?"): (?:&#34;|\\?"))[^&"\\]*')


def _dummy_resume(path: Path) -> None:
    """A one-page PDF of made-up details."""
    lines = [NAME, "alex.example@example.com", "Example State University, B.S. Computer Science"]
    text = "BT /F1 12 Tf 72 720 Td 14 TL " + " ".join(f"({line}) Tj T*" for line in lines) + " ET"
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
               " /Resources << /Font << /F1 5 0 R >> >> >>",
               f"<< /Length {len(text)} >>\nstream\n{text}\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    pdf, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf += f"{i} 0 obj\n{body}\nendobj\n".encode()
    xref = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(pdf)


def _allowed(route: Route) -> None:
    request = route.request
    if request.method == "GET" or (request.method == "POST" and (QUESTIONS in request.url or UPLOAD in request.url)):
        return route.continue_()
    route.abort()


def save(url: str, out: Path, country: str = "") -> None:
    out.mkdir(parents=True, exist_ok=True)
    host = form_url(url).split("/")[2]
    with tempfile.TemporaryDirectory() as tmp:
        raw, resume = Path(tmp) / "raw.har", Path(tmp) / "resume.pdf"
        _dummy_resume(resume)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(service_workers="block", record_har_path=raw, record_har_content="embed")
            ctx.route("**/*", _allowed)
            page = ctx.new_page()
            with page.expect_response(lambda r: QUESTIONS in r.url) as asked:
                page.goto(form_url(url))
            questions = asked.value.json()
            page.locator("[role=region] h2").first.wait_for(timeout=60_000)
            page.wait_for_load_state("networkidle")
            with page.expect_response(lambda r: UPLOAD in r.url, timeout=60_000) as uploaded:
                page.locator("input[type=file]").first.set_input_files(resume)
                page.locator("[role=dialog]").get_by_role("button", name=re.compile(r"^\s*I (acknowledge|agree)\s*$", re.IGNORECASE)).evaluate("b => b.click()")  # a notice may lie over it
            parsed = uploaded.value.text()  # the HAR can miss this body
            page.wait_for_load_state("networkidle")
            if country:
                with page.expect_response(lambda r: "/location/options" in r.url):
                    box = page.locator('[id="Contact_Information_country"] [role=combobox]')
                    box.click()
                    box.fill(country)
                    page.locator(f'[role=listbox] [role=option][title="{country}"]').first.click()
                page.wait_for_load_state("networkidle")
            ctx.close()
            browser.close()
        har = json.loads(raw.read_text())

    entries, seen = [], set()
    for e in har["log"]["entries"]:
        req, res = e["request"], e["response"]
        key = (req["method"], req["url"])
        if res["status"] <= 0 or key in seen or not KEEP.search(req["url"]) or not req["url"].split("/")[2] in (host, "static.vscdn.net"):
            continue
        seen.add(key)
        content = {k: v for k, v in res["content"].items() if k in ("mimeType", "text", "encoding", "size")}
        if UPLOAD in req["url"]:
            content["text"] = parsed
        if "text" in content and content.get("encoding") != "base64":
            content["text"] = WHERE.sub(r"\1", content["text"])
        entries.append({"request": {"method": req["method"], "url": req["url"]}, "response": {"status": res["status"], "content": content}})
    (out / "page.har").write_text(json.dumps({"log": {"version": "1.2", "entries": entries}}, indent=1) + "\n")
    (out / "questions.json").write_text(json.dumps(questions, indent=1) + "\n")
    print(f"saved {len(entries)} responses to {out}")


if __name__ == "__main__":
    save(sys.argv[1], Path(sys.argv[2]), *sys.argv[3:4])
