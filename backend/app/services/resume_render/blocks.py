'''
What a template is made of. A template turns a resume into a list of these;
to_pdf.py and to_docx.py each draw the list, so a template is written once and
comes out in both formats.

There is no image, table, column or text-box block, on purpose: those are
what applicant tracking systems misread, and with no block for them no
template can produce one.
'''
from dataclasses import dataclass


@dataclass(frozen=True)
class Name:
    text: str


@dataclass(frozen=True)
class Contact:
    '''One centred line of (text, link) pairs, separated by bars.'''
    items: tuple[tuple[str, str | None], ...]


@dataclass(frozen=True)
class Heading:
    '''A section's title over a rule.'''
    text: str


@dataclass(frozen=True)
class EntryHeader:
    '''An entry's first lines: bold title left, date or place right, and an
    optional italic second row under them. `note` follows the title in
    italics after a bar, as a project's tools do.'''
    left: str
    right: str = ""
    sub_left: str = ""
    sub_right: str = ""
    note: str = ""


@dataclass(frozen=True)
class Bullet:
    text: str


@dataclass(frozen=True)
class SkillLine:
    label: str
    text: str


Block = Name | Contact | Heading | EntryHeader | Bullet | SkillLine
