'''
Jake's Resume body from a built resume view: the LaTeX after
\\begin{document}, written with the template's own commands. Every string
from the view or the identity goes through escape().
'''

from app.services.resume_render import Identity, escape
from app.services.resume_render.fields import (
    SECTION_LABELS,
    SKILLS_LABEL,
    TWO_ROW,
    details,
    heading,
    link_text,
    skill_lines,
)
from app.services.resume_view import ResumeView, ViewEntry


def _items(lines: list[str]) -> list[str]:
    # An empty itemize is a LaTeX error, so a list opens only around items
    if not lines:
        return []
    return [r"\resumeItemListStart", *(rf"\resumeItem{{{escape(t)}}}" for t in lines), r"\resumeItemListEnd"]


def _header(identity: Identity) -> list[str]:
    contact = []
    if identity.phone:
        contact.append(escape(identity.phone))
    if identity.email:
        contact.append(rf"\href{{mailto:{escape(identity.email)}}}{{\underline{{{escape(identity.email)}}}}}")
    contact += [rf"\href{{{escape(u)}}}{{\underline{{{escape(link_text(u))}}}}}" for u in identity.links]
    lines = [r"\begin{center}", rf"\textbf{{\Huge \scshape {escape(identity.name)}}} \\ \vspace{{1pt}}"]
    if contact:
        lines.append(r"\small " + " $|$ ".join(contact))
    lines.append(r"\end{center}")
    return lines


def _entry(entry: ViewEntry) -> list[str]:
    h = heading(entry)
    if entry.section in TWO_ROW:
        line = rf"\resumeSubheading{{{escape(h.title)}}}{{{escape(h.right)}}}{{{escape(h.subtitle)}}}{{{escape(h.subright)}}}"
    else:
        left = rf"\textbf{{{escape(h.title)}}}" + (rf" $|$ \emph{{{escape(h.tag)}}}" if h.tag else "")
        line = rf"\resumeProjectHeading{{{left}}}{{{escape(h.right)}}}"
    return [line, *_items(details(entry) + [b.text for b in entry.bullets])]


def body(view: ResumeView, identity: Identity) -> str:
    lines = _header(identity)
    for section in view.sections:
        lines += [rf"\section{{{escape(SECTION_LABELS[section.section])}}}", r"\resumeSubHeadingListStart"]
        for entry in section.entries:
            lines += _entry(entry)
        lines.append(r"\resumeSubHeadingListEnd")
    if view.skills:
        rows = r" \\ ".join(
            (rf"\textbf{{{escape(label)}}}{{: {escape(names)}}}" if label else escape(names))
            for label, names in skill_lines(view.skills)
        )
        lines += [
            rf"\section{{{SKILLS_LABEL}}}",
            r"\begin{itemize}[leftmargin=0.15in, label={}]",
            rf"\small{{\item{{{rows}}}}}",
            r"\end{itemize}",
        ]
    return "\n".join(lines)
