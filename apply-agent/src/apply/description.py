"""The Posting description: the Posting's own text (its role, company, the job
text and its pay range), read once per Application and given to every Claude
call for it in one <posting> block, so a company-specific question is answered
and checked against the job itself.

The text loses its boilerplate (equal-opportunity, benefits, accommodation,
privacy and fraud-warning paragraphs) and is cut to CAP characters, about a
thousand tokens; its pay range is named apart first, so the cut never loses it.
It is employer text: Claude reads it as data and never follows instructions in it."""

import json
import re

from apply import company
from apply.adapters import JobSite
from apply.company import text_of
from apply.model import Posting, one_line

CAP = 4_000  # characters of the Posting's text in each call, about 1,000 tokens

# A paragraph no answer draws on, wherever it stands.
BOILERPLATE = re.compile(
    r"equal (employment )?opportunity|affirmative action|do(es)? not discriminate|without regard to"
    r"|regardless of (race|age|background|sex|gender)|protected (veteran|characteristic|status)"
    r"|accommodations?\b.{0,80}\b(disabilit|hiring|application|interview)|disabilit\w*.{0,80}\baccommodation"
    r"|e-verify|privacy (notice|policy)|applicant privacy|phishing|fraudulent|scam|#LI-",
    re.IGNORECASE,
)
# A heading whose section is boilerplate: skipped up to the next heading of the job itself.
BOILERPLATE_HEADING = re.compile(
    r"^(our )?(benefits|perks)\b|what we offer|what you can expect from us|accommodations?\b|accessibility"
    r"|(data )?privacy|fraud|recruit\w* scams?|equal (employment )?opportunity|\beeo|\beoe\b|commitment to",
    re.IGNORECASE,
)
JOB_HEADING = re.compile(
    r"about|the role|responsibilit|what you('ll| will)? (do|work on|build)|qualifications|requirements|who you are"
    r"|you('ll| will)? (have|bring|need)|skills|experience|the team|our (values|mission)|location|schedule|duration",
    re.IGNORECASE,
)
HEADING_WORDS = 8
# An amount of money, and words that make a line about this role's pay.
MONEY = re.compile(r"\$\s?\d|\b\d[\d,.]*\s?(USD|usd)\b")
PAY_WORDS = re.compile(r"\b(pay|salary|compensation|wage|stipend|hourly|per hour|an hour|/\s?h(ou)?r|annual|base)\b",
                       re.IGNORECASE)
PAY_CHARS = 200
SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")
SECTION_CHARS = 200  # a shorter "description" element is a caption, not the job's text

# What an open posting page says about its job, read with no Claude call: its
# JobPosting schema (application/ld+json), else its visible job description
# section, else its meta description.
PAGE = """() => {
  const postings = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = [].concat(node['@type'] || []);
    if (type.includes('JobPosting')) postings.push(node);
    if (node['@graph']) visit(node['@graph']);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visit(JSON.parse(script.textContent)); } catch (e) {}
  }
  const posting = postings.find((p) => p.description) || {};
  const sections = [...document.querySelectorAll(
    '[data-automation-id="jobPostingDescription"], [itemprop="description"], [class*="description" i], ' +
    '[id*="description" i], [class*="job-details" i], [id*="job-details" i], article')]
    .filter((el) => el.offsetParent !== null && !el.querySelector('input, select, textarea'))
    .map((el) => el.innerText.trim());
  const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  const org = posting.hiringOrganization;
  return {
    schema: posting.description || '',
    title: typeof posting.title === 'string' ? posting.title : '',
    company: org && typeof org === 'object' ? org.name || '' : typeof org === 'string' ? org : '',
    salary: posting.baseSalary || null,
    section: sections.sort((a, b) => b.length - a.length)[0] || '',
    meta: meta ? meta.content || '' : '',
    page_title: document.title || '',
  };
}"""


def from_api(posting: Posting, site: JobSite) -> str:
    """The Posting's text from its job system's API (company.description), or
    "" for a job system with none or a text that can't be read."""
    try:
        return company.description(posting, site)
    except Exception:
        return ""


def from_link(posting: Posting, site: JobSite) -> str:
    """The Posting's own page, read with a plain fetch (no browser), or "":
    for a job system with no API whose Filler read no page."""
    try:
        return text_of(site.fetch(posting.url).decode(errors="replace"))
    except Exception:
        return ""


def block(posting: Posting, text: str) -> str:
    """The <posting> block for every Claude call of one Application: the
    company, the role, its pay range if the text states one, and the text."""
    text = _safe(text)
    head = {"company": posting.company, "role": posting.title} | ({"pay": pay} if (pay := pay_range(text)) else {})
    body = _cut(_without_boilerplate(text))
    return "\n".join(["<posting>", json.dumps(head, ensure_ascii=False),
                      *([f"<description>\n{body}\n</description>"] if body else []), "</posting>"])


def pay_range(text: str) -> str:
    """The line of the Posting's text that states its pay, with the line that
    leads into it ("The annual base salary range is:"), or ""."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for n, line in enumerate(lines):
        if not MONEY.search(line):
            continue
        if PAY_WORDS.search(line):
            sentence = next(s for s in SENTENCE.split(line) if MONEY.search(s))
            return one_line(sentence if PAY_WORDS.search(sentence) else line)[:PAY_CHARS]
        if n and PAY_WORDS.search(lines[n - 1]) and len(lines[n - 1]) <= PAY_CHARS:
            return one_line(f"{lines[n - 1]} {line}")[:PAY_CHARS]
    return ""


def _without_boilerplate(text: str) -> str:
    kept, skipping = [], False
    for line in (line.strip() for line in text.splitlines()):
        if not line:
            continue
        heading = _is_heading(line)
        if heading and BOILERPLATE_HEADING.search(line):
            skipping = True
            continue
        if skipping and heading and JOB_HEADING.search(line):
            skipping = False
        if skipping or BOILERPLATE.search(line):
            continue
        kept.append(line)
    return "\n".join(kept)


def _is_heading(line: str) -> bool:
    return len(line.split()) <= HEADING_WORDS and not line.endswith((".", ",", ";"))


def _cut(text: str) -> str:
    """`text` cut to CAP characters, at the end of a line where one ends in reach."""
    if len(text) <= CAP:
        return text
    cut = text[:CAP]
    end = cut.rfind("\n")
    return (cut[:end] if end > CAP // 2 else cut).rstrip() + "\n(cut)"


def _safe(text: str) -> str:
    """No angle brackets, so the text can't close the block it sits in."""
    return text.replace("<", "(").replace(">", ")")


def from_page(page) -> str:
    """The Posting's text as its open page shows it: before the Apply click
    the posting itself, after it whatever the form page still says. "" if
    the page says nothing about the job. A JobPosting schema's role and
    company lead it, as a pasted link may name neither."""
    found = page.evaluate(PAGE)
    if found["schema"]:
        pay, role = _salary(found["salary"]), " at ".join(filter(None, [found["title"], found["company"]]))
        return "\n".join(filter(None, [one_line(role), pay and f"Pay: {pay}", text_of(found["schema"])]))
    if len(found["section"]) >= SECTION_CHARS:
        return "\n".join(line.strip() for line in found["section"].splitlines() if line.strip())
    return one_line(found["meta"])


# How a careers page's title names the company and role, when no JobPosting schema does:
# Jobvite's "AArete Careers - Apply for Data Architecture Intern", Paylocity's
# "North Atlantic Industries, Inc - Intern - Full Stack Software Engineer Application".
PAGE_TITLES = [
    re.compile(r"^(?P<company>.+?) careers? - (?:apply for )?(?P<title>.+)$", re.IGNORECASE),
    re.compile(r"^(?P<company>.+?) - (?P<title>.+?) application$", re.IGNORECASE),
    # A form builder's page: "2027 Netflix Internship Application - Airtable"
    re.compile(r"^(?:(?:summer |fall )?\d{4} )?(?P<company>[^-]+?) (?P<title>(?:summer )?internships?(?: program)?) application"
               r"(?: form)?(?: - [^-]+)?$", re.IGNORECASE),
]


def names_on_page(page) -> tuple[str, str]:
    """The company and role the open page names: its JobPosting schema's,
    else its title's; ("", "") if it names neither."""
    found = page.evaluate(PAGE)
    company, title = one_line(found["company"]), one_line(found["title"])
    for shape in PAGE_TITLES:
        if company and title:
            break
        if m := shape.match(one_line(found["page_title"])):
            company, title = company or m["company"].strip(), title or m["title"].strip()
    return company, title


def _salary(salary) -> str:
    """A JobPosting's baseSalary in words: "$28 - $32 USD per hour"."""
    if not isinstance(salary, dict):
        return ""
    value = salary.get("value")
    value = value if isinstance(value, dict) else {"value": value}
    amounts = [value.get(k) for k in ("minValue", "maxValue", "value") if value.get(k) not in (None, "")]
    if not amounts:
        return ""
    unit = str(value.get("unitText") or "").lower()
    currency = str(salary.get("currency") or "")
    shown = " - ".join(f"${a:,}" if isinstance(a, (int, float)) else f"${a}" for a in dict.fromkeys(amounts))
    return " ".join(filter(None, [shown, currency, unit and f"per {unit}"]))
