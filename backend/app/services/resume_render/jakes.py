'''
Jake's Resume body from a built resume view: the LaTeX after
\\begin{document}, written with the template's own commands. Every string
from the view or the identity goes through escape(), and a link target
through escape_url().

With `marks` (the default) each bullet, entry field and skill is wrapped in
position markers (`MARKS` in __init__), which give the editor its click
targets and leave the page itself unchanged. With `printed`, each marked
line's plain text goes in it under the marker's name ("<id>.<kind>"), so a
box carries the words it covers (`Box.text`).
'''

from app.services.resume_render import (
    DEFAULT_PAGE,
    HEADER,
    MARKS,
    HeaderIdentity,
    PageSettings,
    escape,
    escape_url,
    mark,
    type_size,
)
from app.services.resume_render.fields import (
    SECTION_LABELS,
    SKILLS_LABEL,
    TWO_ROW,
    US_CITIZEN,
    details,
    heading,
    heading_fields,
    link_text,
    skill_lines,
)
from app.services.resume_view import ResumeView, ViewEntry, runs

Printed = dict[str, str] | None


def _rich(text: str) -> str:
    '''A marked wording's LaTeX, each run escaped and set in its weight.'''
    pieces = []
    for words, bold, italic in runs(text):
        latex = escape(words)
        if italic:
            latex = rf"\textit{{{latex}}}"
        pieces.append(rf"\textbf{{{latex}}}" if bold else latex)
    return "".join(pieces)


def _marked(item_id, kind: str, latex: str, text: str, marks: bool, printed: Printed) -> str:
    '''`latex` between markers, and `text`, the same words unescaped, noted
    for its box.'''
    if printed is not None and text:
        printed[f"{item_id}.{kind}"] = text
    return mark(item_id, kind, latex) if marks else latex


def _header(identity: HeaderIdentity, marks: bool, printed: Printed, page: PageSettings) -> list[str]:
    # The identity comes from the profile; its markers use HEADER as the id,
    # and each field's profile column as the kind
    def slot(kind: str, latex: str, text: str) -> str:
        return _marked(HEADER, kind, latex, text, marks, printed)

    # "U.S. Citizen" leads the line. No box: the editor types only the
    # fields it can save, and this one is Application Questions' answer
    contact = [US_CITIZEN] if identity.us_citizen else []
    if identity.phone:
        contact.append(slot("phone_number", escape(identity.phone), identity.phone))
    if identity.email:
        email = escape(identity.email)
        contact.append(slot(
            "email", rf"\href{{mailto:{escape_url(identity.email)}}}{{\underline{{{email}}}}}", identity.email
        ))
    contact += [
        slot(field, rf"\href{{{escape_url(u)}}}{{\underline{{{escape(link_text(u))}}}}}", link_text(u))
        for field, u in identity.links
    ]
    # The page's settings, each only when it differs, so Jake's own page
    # writes his own header
    size = type_size(page.name_size) if page.name_size else r"\Huge"
    shape = rf"\textbf{{{size} \scshape {escape(identity.name)}}}"
    if page.accent != DEFAULT_PAGE.accent:
        shape = rf"\textcolor{{wiaccent}}{{{shape}}}"
    name = slot("full_name", shape, identity.name)
    box = {"left": "flushleft", "center": "center", "right": "flushright"}[page.header_alignment]
    lines = [rf"\begin{{{box}}}", rf"{name} \\ \vspace{{1pt}}"]
    if contact:
        lines.append(r"\small " + " $|$ ".join(contact))
    lines.append(rf"\end{{{box}}}")
    return lines


def _entry(entry: ViewEntry, marks: bool, printed: Printed) -> list[str]:
    h = heading(entry)
    kinds = heading_fields(entry.section)

    def slot(name: str) -> str:
        text = getattr(h, name)
        return _marked(entry.id, kinds[name], escape(text), text, marks, printed)

    if entry.section in TWO_ROW:
        line = rf"\resumeSubheading{{{slot('title')}}}{{{slot('right')}}}{{{slot('subtitle')}}}{{{slot('subright')}}}"
    else:
        left = rf"\textbf{{{slot('title')}}}" + (rf" $|$ \emph{{{slot('tag')}}}" if h.tag else "")
        line = rf"\resumeProjectHeading{{{left}}}{{{slot('right')}}}"
    items = [(entry.id, kind, escape(text), text) for kind, text in details(entry)]
    # A marked bullet's box carries its markers: the editor opens the line on
    # them, and saves it only when they change
    items += [(b.id, "bullet", _rich(b.marked) if b.marked else escape(b.text), b.marked or b.text)
              for b in entry.bullets]
    if not items:
        # An empty itemize is a LaTeX error, so a list opens only around items
        return [line]
    rows = []
    for item_id, kind, latex, text in items:
        body = _marked(item_id, kind, latex, text, marks, printed)
        # \ignorespaces swallows the space Jake's \resumeItem puts after its
        # argument ("{#1 \vspace{-2pt}}"): when a bullet's last line is
        # full, TeX broke at that space and printed an empty line after it
        rows.append(rf"\resumeItem{{{body}\ignorespaces}}")
    return [line, r"\resumeItemListStart", *rows, r"\resumeItemListEnd"]


def _skills(view: ResumeView, marks: bool, printed: Printed) -> str:
    rows = []
    # Each line's start, before its label: Fit to One Page reads the left
    # edge from it to tell how many skills a wrapped line must lose
    start = r"\wipoint{skillrow}" if marks else ""
    for label, skills in skill_lines(view.skills):
        # Each skill's comma stays inside its markers: a marker between two
        # characters drops the kerning between them ("NumPy," moved 0.08 pt)
        names = " ".join(
            _marked(s.id, "skill", escape(s.name) + comma, s.name + comma, marks, printed)
            for i, s in enumerate(skills)
            for comma in ["," if i < len(skills) - 1 else ""]
        )
        rows.append(start + (rf"\textbf{{{escape(label)}}}{{: {names}}}" if label else names))
    return r" \\ ".join(rows)


def body(
    view: ResumeView, identity: HeaderIdentity, *, marks: bool = True, printed: Printed = None,
    page: PageSettings = DEFAULT_PAGE,
) -> str:
    lines = [MARKS] if marks else []
    lines += _header(identity, marks, printed, page)
    blocks: dict[str, list[str]] = {}
    for section in view.sections:
        block = [rf"\section{{{escape(SECTION_LABELS[section.section])}}}", r"\resumeSubHeadingListStart"]
        for entry in section.entries:
            block += _entry(entry, marks, printed)
        blocks[section.section] = [*block, r"\resumeSubHeadingListEnd"]
    if view.skills:
        blocks["skills"] = [
            rf"\section{{{SKILLS_LABEL}}}",
            r"\begin{itemize}[leftmargin=0.15in, label={}]",
            rf"\small{{\item{{{_skills(view, marks, printed)}}}}}",
            r"\end{itemize}",
        ]
    for name in page.section_order:
        lines += blocks.get(name, [])
    return "\n".join(lines)
