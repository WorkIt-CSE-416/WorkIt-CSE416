'''
Edits to an applicant's LaTeX, by field: change a field's words, add a
bullet after one, remove one. Each edit replaces the characters of its own
field or bullet and nothing else, so a source with no edits comes back byte
for byte, and the layout around every field is exactly what was pasted.

Edits name fields by id and are made against one source (fields.py's ids
are positional). They are all applied to that source at once, last first,
so no edit shifts another's span.
'''
from dataclasses import dataclass

from app.services.latex_source.fields import Field, fields
from app.services.latex_source.inline import italic_of, to_latex

MAX_FIELD_CHARS = 1000


@dataclass(frozen=True)
class Edit:
    id: str
    text: str


@dataclass(frozen=True)
class Insert:
    '''A new bullet after bullet `after`, copying its command and indent.'''
    after: str
    text: str


@dataclass(frozen=True)
class Delete:
    id: str


Op = Edit | Insert | Delete


class Unapplicable(ValueError):
    pass


def _line_start(source: str, at: int) -> int:
    return source.rfind("\n", 0, at) + 1


def _indent(source: str, at: int) -> str:
    start = _line_start(source, at)
    before = source[start:at]
    return before if not before.strip() else ""


def _alone_in_list(found: list[Field], index: int) -> bool:
    '''A bullet with no bullet beside it: removing it would leave an empty
    list, which LaTeX refuses to compile.'''
    def bullet(i: int) -> bool:
        return 0 <= i < len(found) and found[i].kind == "bullet" and found[i].section == found[index].section
    return not bullet(index - 1) and not bullet(index + 1)


def apply(source: str, ops: list[Op]) -> str:
    '''The source with every edit made, or Unapplicable naming the first one
    that can't be.'''
    found = fields(source)
    by_id = {f.id: (i, f) for i, f in enumerate(found)}
    deleted = {op.id for op in ops if isinstance(op, Delete)}
    changes: list[tuple[int, int, str]] = []
    for op in ops:
        target = op.after if isinstance(op, Insert) else op.id
        if target not in by_id:
            raise Unapplicable(f"No field {target}: the resume changed since it was loaded. Reload and try again.")
        index, f = by_id[target]
        if isinstance(op, Delete):
            if f.kind != "bullet":
                raise Unapplicable("Only a bullet can be removed here. Remove anything else in the Source tab.")
            if _alone_in_list(found, index):
                raise Unapplicable("This is the only bullet in its list. Remove the list in the Source tab instead.")
            start = _line_start(source, f.unit_start)
            if source[start:f.unit_start].strip():
                start = f.unit_start
            end = f.unit_end
            newline = source.find("\n", end)
            if newline != -1 and not source[end:newline].strip():
                end = newline + 1
            changes.append((start, end, ""))
            continue
        text = op.text.strip()
        if len(text) > MAX_FIELD_CHARS:
            raise Unapplicable(f"A line can be at most {MAX_FIELD_CHARS} characters.")
        if not f.editable:
            raise Unapplicable("That line holds LaTeX the Words view can't edit. Change it in the Source tab.")
        latex = to_latex(text, italic=italic_of(source[f.start:f.end]))
        if isinstance(op, Edit):
            if op.id in deleted:
                continue
            if not text:
                raise Unapplicable("A line can't be empty. Remove the bullet instead, or type something.")
            changes.append((f.start, f.end, latex))
        else:
            if f.kind != "bullet":
                raise Unapplicable("A new bullet goes after another bullet.")
            if op.after in deleted:
                raise Unapplicable("Can't add a bullet after one that is being removed.")
            if not text:
                continue
            copy = source[f.unit_start:f.start] + latex + source[f.end:f.unit_end]
            changes.append((f.unit_end, f.unit_end, "\n" + _indent(source, f.unit_start) + copy))
    # Last first, so each change's offsets still hold; at one offset, inserts
    # land in the order they were asked for
    out = source
    for start, end, text in sorted(changes, key=lambda c: (c[0], c[1]), reverse=True):
        out = out[:start] + text + out[end:]
    return out
