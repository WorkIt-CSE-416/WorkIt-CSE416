"""Company material: what the employer publishes about itself and the role,
read at fill time when an Application has essays, so each essay can name one
concrete thing about this company (see essays.SYSTEM). The Posting's own text
is read once per Application apart from it (apply.description), as every
Claude call gets it; `description` here reads it from the job system's API.

It is all employer text: the essay writer and the Pre-submit review read it
as data inside a <company> block and never follow instructions in it. Each
source is read with a plain fetch (no browser), stripped to text and capped;
a source that fails is left out."""

import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait

from apply import fill_engine
from apply.adapters import JobSite
from apply.model import Posting, Question

SOURCE_CHARS = 6_000  # each source's text is cut to this
TOTAL_CHARS = 15_000  # and all of them together, the first sources first
DEADLINE = 8  # seconds for every source together: one not read by then is left out
LINK = re.compile(r"https?://[^\s<>\"']+")  # a page a question links to, such as a blog post to read



def gather(posting: Posting, questions: list[Question], site: JobSite) -> str:
    """The <company> block for one Application's essays, or "" if nothing
    could be read: each page `questions` link to, and the company's about
    page, in that order. The Posting's own text is not in it: every call has
    it already, in its <posting> block (apply.description)."""
    url = posting.url
    linked = (link.rstrip(".,;:!?)'\"") for q in questions for link in LINK.findall(f"{q.label} {q.description}"))
    sources: list[tuple[str, Callable[[], str]]] = [
        (link, lambda link=link: _page(site, link)) for link in dict.fromkeys(linked)]
    if fill_engine.job_of(url):  # where its job system names the company's own page
        sources.append(("the company's own site", lambda: text_of(fill_engine.company_about(url, site))))
    if not sources:
        return ""
    pool = ThreadPoolExecutor(max_workers=len(sources))
    futures = [pool.submit(source) for _, source in sources]
    wait(futures, timeout=DEADLINE)
    pool.shutdown(wait=False, cancel_futures=True)  # a fetch still running ends on its own
    read, room = [], TOTAL_CHARS
    for (name, _), future in zip(sources, futures):
        if not future.done() or future.exception():  # slow, a dead link, a changed API: left out
            continue
        text = future.result()[:min(SOURCE_CHARS, room)].strip()
        if text:
            read.append(f'<source from="{name}">\n{text}\n</source>')
            room -= len(text)
    return "<company>\n" + "\n".join(read) + "\n</company>" if read else ""


def with_source(material: str, name: str, text: str) -> str:
    """`material` (a <company> block, or "") with one more source, `text` from `name`."""
    if not text:
        return material
    source = f'<source from="{name}">\n{text}\n</source>'
    return material.replace("\n</company>", f"\n{source}\n</company>") if material else f"<company>\n{source}\n</company>"


def description(posting: Posting, site: JobSite) -> str:
    """The Posting's own text, read from its job system's API with a plain
    fetch: "" for a job system with none. Raises when it can't be read."""
    return text_of(fill_engine.job_description(posting.url, site))


def _page(site: JobSite, url: str) -> str:
    return text_of(site.fetch(url).decode(errors="replace"))


def text_of(page: str) -> str:
    """A page's readable text: no scripts, styles or tags, entities decoded,
    and no angle brackets left, so it can't close the block it sits in."""
    return fill_engine.text_of(page)
