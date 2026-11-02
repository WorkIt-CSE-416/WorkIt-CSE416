"""Cover letters: the one-page letter a form offers to take, built from one
fixed template (research/cover-letter.md, from Google's and Amazon's own
career pages and MIT, CMU, Harvard, Berkeley, UMD and Colgate career guides).

Apply sets the parts no letter should vary: the salutation, the sign-off and
their name. Claude writes only the template's four paragraphs (SLOTS), each to
its own rules, in the Application's one essay call (apply.essays). The letter
is then an essay like any other: checked for numbers no source holds and for
words that give away how it was written, and held for Lisul when it is.

A cover letter upload is a one-page PDF with the resume's own header and font
(fonts/), dated, addressed to the company and naming the role; a text box
gets the letter alone.
"""

import html
import re
import subprocess
import tempfile
from datetime import date
from pathlib import Path

from apply.model import Posting, Question
from apply.profile import ApplicantProfile

CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
FONTS = Path(__file__).parent / "fonts"
FILE_NAME = "{first}_{last}_Cover_Letter.pdf"  # beside Test_Person_Resume.pdf

# The template's paragraphs, in order, each with what Claude must write in it.
SLOTS = {
    "opening": (
        "3 short sentences, at most 65 words. First: who they are (a computer science student at @SCHOOL@,"
        " and when they graduate, as the sources say) and the role as a person would name it (the "
        "posting's title without codes, degree levels, seasons or locations). Second: what they built most recently "
        "that fits this role, said as what it did for the people who used it. Third: one specific thing this "
        "company or team builds, from <posting> or <company>, and why it draws them, tied to what they built. Never "
        "open on the company's mission, and never talk about the letter itself."
    ),
    "proof": (
        "3 sentences, at most 85 words: the work this role most needs (shown by doing it, never by naming the posting), answered with their one strongest "
        "experience for it, told as they tell a project, naming where they did it (the employer or project): the problem in plain words, what they themselves did step by "
        "step, and what it showed them or why they built it that way."
    ),
    "second_proof": (
        "2 sentences, at most 50 words: a second thing the role needs, answered with a different experience, "
        "told the same plain way. Empty only when no other experience of their answers anything else the role needs."
    ),
    "closing": (
        "1-2 sentences: when they are available (the internship term, as the sources say), that their resume has the "
        "rest, that they would welcome a conversation about the role, and thanks. Restate nothing."
    ),
}
TEMPLATE = "Dear {company} Recruiting Team:\n\n{paragraphs}\n\nSincerely,\n{name}"

RULES = """A cover letter question is the one answer written as a formal letter to the company's recruiters. Its answer fills the slots opening, proof, second_proof and closing, each to its own description; Apply adds the salutation, the sign-off and their name. Every rule above holds.
Recruiters read it in under a minute, if at all, and often stop after the first sentence: it is 180-260 words in all, the strongest evidence first, and every sentence specific to them and to this company. Cut any sentence any applicant could send, or that the letter reads as well without.
The resume says what they did; the letter says why it matters here. Make two points, each showing they can do work the role needs (never say what the posting asks for or stresses): the strongest in depth, the second briefly. Say what they offer, and never mention a gap or a weakness.
It is a letter to recruiters, so it leaves out the habits <style_card> lists under "Leave out in a formal letter"; it holds no salutation, sign-off, date or address of its own."""


def is_cover_letter(q: Question) -> bool:
    """A cover letter field: an upload that names one, or a text box asking for one."""
    label = q.label.lower()
    return "cover" in label if q.kind == "file" else q.kind in ("text", "textarea") and "cover letter" in label


def schema(q: Question, ask: str) -> dict:
    """What Claude returns for cover letter `q`: each slot, needs_lisul, and its Named fact's name."""
    return {
        "type": "object",
        "description": ask,
        "properties": {**{slot: {"type": "string", "description": rule} for slot, rule in SLOTS.items()},
                       "needs_lisul": {"type": "boolean"}, "named": {"type": "string"}},
        "required": [*SLOTS, "needs_lisul"],
    }


def letter(given: dict, posting: Posting, profile: ApplicantProfile) -> str:
    """The letter Claude's slots make, from salutation to their name; "" when
    Claude wrote none of them."""
    paragraphs = [text for slot in SLOTS if (text := " ".join(str(given.get(slot) or "").split()))]
    if not paragraphs:
        return ""
    return TEMPLATE.format(company=posting.company.strip(), paragraphs="\n\n".join(paragraphs), name=name(profile))


def name(profile: ApplicantProfile) -> str:
    """Their name as the resume gives it: the name they go by, then their last name."""
    first = profile.get("identity.preferred_first_name") or profile.get("identity.legal_first_name") or ""
    last = profile.get("identity.preferred_last_name") or profile.get("identity.legal_last_name") or ""
    return f"{first} {last}".strip()


# The resume's look: Latin Modern, a small-caps name over a 10 pt contact line.
PAGE = """<!doctype html><meta charset="utf-8"><style>
@font-face {{ font-family: LM; src: url("{fonts}/lmroman10-regular.otf"); }}
@font-face {{ font-family: LM; font-weight: bold; src: url("{fonts}/lmroman10-bold.otf"); }}
@font-face {{ font-family: LMCaps; src: url("{fonts}/lmromancaps10-regular.otf"); }}
@page {{ size: letter; margin: 0.9in 1in; }}
body {{ margin: 0; font: 11pt/1.38 LM, "Times New Roman", serif; color: #000; }}
header {{ text-align: center; margin-bottom: 26pt; }}
h1 {{ margin: 0 0 3pt; font: 25pt LMCaps, LM, serif; }}
.contact {{ font-size: 10pt; }}
p {{ margin: 0 0 11pt; }}
</style>
<header><h1>{name}</h1><div class="contact">{contact}</div></header>
<p>{today}</p>
<p>{company}<br>Re: {role}</p>
{body}"""


def file_name(profile: ApplicantProfile) -> str:
    first, _, last = name(profile).partition(" ")
    return FILE_NAME.format(first=first, last=last.replace(" ", "_"))


def pdf(text: str, posting: Posting, profile: ApplicantProfile, path: Path, today: date | None = None) -> None:
    """Letter `text` (salutation to name, perhaps as Lisul edited it) as a
    one-page PDF at `path`, printed by headless Chrome. Raises when Chrome
    can't print it."""
    contact = [_phone(profile.get("identity.phone")), profile.get("identity.email"),
               _bare(profile.get("links.linkedin_url")), _bare(profile.get("links.github_url"))]
    blocks = [block.strip() for block in text.replace("\r\n", "\n").split("\n\n") if block.strip()]
    page = PAGE.format(
        fonts=FONTS.as_uri(), name=html.escape(name(profile)),
        contact=" | ".join(html.escape(str(c)) for c in contact if c),
        today=(today or date.today()).strftime("%B %-d, %Y"),
        company=html.escape(posting.company.strip()), role=html.escape(posting.title.strip()),
        body="\n".join(f"<p>{_lines(b)}</p>" for b in blocks),
    )
    with tempfile.TemporaryDirectory(prefix="apply-letter-") as scratch:
        source = Path(scratch) / "letter.html"
        source.write_text(page)
        subprocess.run([str(CHROME), "--headless", "--disable-gpu", "--no-pdf-header-footer", "--no-first-run",
                        f"--user-data-dir={scratch}/chrome", f"--print-to-pdf={path}", source.as_uri()],
                       capture_output=True, timeout=60, check=False)
    if not path.is_file() or not path.read_bytes().startswith(b"%PDF"):
        raise RuntimeError(f"Chrome printed no cover letter PDF to {path}")


def _lines(block: str) -> str:
    return "<br>".join(html.escape(line.strip()) for line in block.split("\n"))


def _phone(phone) -> str:
    """+15550100199 as the resume writes it: (555) 010-0199."""
    digits = re.sub(r"\D", "", str(phone or ""))[-10:]
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}" if len(digits) == 10 else str(phone or "")


def _bare(url) -> str:
    """A link as the resume writes it: linkedin.com/in/test-person."""
    return re.sub(r"^https?://(www\.)?", "", str(url or "")).rstrip("/")
