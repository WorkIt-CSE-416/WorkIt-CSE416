'''
Jake's Resume body from a built resume view: the LaTeX after
\\begin{document}, written with the template's own commands. Every string
from the view or the identity goes through escape(), and a link target
through escape_url().

With `marks` (the default) each bullet, entry field and skill is wrapped in
position markers (`MARKS` in __init__), which give the editor its click
targets and leave the page itself unchanged.
'''

from app.services.resume_render import MARKS, HeaderIdentity, escape, escape_url, mark
from app.services.resume_render.fields import (
    SECTION_LABELS,
    SKILLS_LABEL,
    TWO_ROW,
    details,
    heading,
    heading_fields,
    link_text,
    skill_lines,
)
from app.services.resume_view import ResumeView, ViewEntry


def _header(identity: HeaderIdentity) -> list[str]:
    # The identity comes from the profile and is edited there: no markers
    contact = []
    if identity.phone:
        contact.append(escape(identity.phone))
    if identity.email:
        contact.append(rf"\href{{mailto:{escape_url(identity.email)}}}{{\underline{{{escape(identity.email)}}}}}")
    contact += [rf"\href{{{escape_url(u)}}}{{\underline{{{escape(link_text(u))}}}}}" for u in identity.links]
    lines = [r"\begin{center}", rf"\textbf{{\Huge \scshape {escape(identity.name)}}} \\ \vspace{{1pt}}"]
    if contact:
        lines.append(r"\small " + " $|$ ".join(contact))
    lines.append(r"\end{center}")
    return lines


def _entry(entry: ViewEntry, marks: bool) -> list[str]:
    h = heading(entry)
    kinds = heading_fields(entry.section)

    def slot(name: str) -> str:
        text = escape(getattr(h, name))
        return mark(entry.id, kinds[name], text) if marks else text

    if entry.section in TWO_ROW:
        line = rf"\resumeSubheading{{{slot('title')}}}{{{slot('right')}}}{{{slot('subtitle')}}}{{{slot('subright')}}}"
    else:
        left = rf"\textbf{{{slot('title')}}}" + (rf" $|$ \emph{{{slot('tag')}}}" if h.tag else "")
        line = rf"\resumeProjectHeading{{{left}}}{{{slot('right')}}}"
    items = [(entry.id, kind, text) for kind, text in details(entry)]
    items += [(b.id, "bullet", b.text) for b in entry.bullets]
    if not items:
        # An empty itemize is a LaTeX error, so a list opens only around items
        return [line]
    rows = []
    for item_id, kind, text in items:
        body = mark(item_id, kind, escape(text)) if marks else escape(text)
        rows.append(rf"\resumeItem{{{body}}}")
    return [line, r"\resumeItemListStart", *rows, r"\resumeItemListEnd"]


def _skills(view: ResumeView, marks: bool) -> str:
    rows = []
    for label, skills in skill_lines(view.skills):
        # Each skill's comma stays inside its markers: a marker between two
        # characters drops the kerning between them ("NumPy," moved 0.08 pt)
        names = " ".join(
            mark(s.id, "skill", text) if marks else text
            for i, s in enumerate(skills)
            for text in [escape(s.name) + ("," if i < len(skills) - 1 else "")]
        )
        rows.append(rf"\textbf{{{escape(label)}}}{{: {names}}}" if label else names)
    return r" \\ ".join(rows)


def body(view: ResumeView, identity: HeaderIdentity, *, marks: bool = True) -> str:
    lines = [MARKS] if marks else []
    lines += _header(identity)
    for section in view.sections:
        lines += [rf"\section{{{escape(SECTION_LABELS[section.section])}}}", r"\resumeSubHeadingListStart"]
        for entry in section.entries:
            lines += _entry(entry, marks)
        lines.append(r"\resumeSubHeadingListEnd")
    if view.skills:
        lines += [
            rf"\section{{{SKILLS_LABEL}}}",
            r"\begin{itemize}[leftmargin=0.15in, label={}]",
            rf"\small{{\item{{{_skills(view, marks)}}}}}",
            r"\end{itemize}",
        ]
    return "\n".join(lines)
