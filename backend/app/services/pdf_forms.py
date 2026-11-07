"""Read the text a page draws inside Form XObjects once, where it shows.

A page can draw text inside a form, a Form XObject it shows with `Do`, and a
form shows only what falls inside its box (/BBox, placed by its /Matrix).
pypdf's plain mode reads every form whole, and its layout mode, like the gap
walk in `pdf_spaces`, never looks inside one. A Google Docs resume on the
shared test account had been through an editor built on MuPDF (its forms are
named "fzFrm"), which deleted a band across the page by drawing the whole
page twice: one form boxed to the part above the band, one boxed to the part
below and moved up over it. Plain mode read the resume twice, so every entry
imported twice and the name line landed in Projects as an entry; layout
mode read nothing.

`inline_forms` writes each form's operators into the page's own content
stream, between `q` and `Q` with its matrix, and keeps a text-showing
operator only when the line it is on starts inside the box of every form
around it. Both modes and the gap walk then read the page's text once, where
it shows. A page whose forms show no text is returned as it is.
"""
from pypdf.generic import (
    ContentStream,
    DictionaryObject,
    FloatObject,
    NameObject,
    StreamObject,
)

SHOWS = (b"Tj", b"TJ", b"'", b'"')
# What a text object with nothing to show loses: its text and its moves. The
# font, spacing and leading it sets stay, since they outlast its ET.
TEXT_ONLY = (b"BT", b"ET", b"Td", b"TD", b"Tm", b"T*", *SHOWS)
IDENTITY = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
# Forms nested deeper are not read: a form that draws itself never ends
MAX_DEPTH = 8
# How far, in points, a line can start outside its box and still show: a
# box's edge and a line set on it are both rounded
EDGE = 0.5


def inline_forms(page):
    """The page with its forms written into its own content stream, keeping
    only the text each one shows. Changes the page in place; a page it can't
    read stays as it is."""
    try:
        resources = page["/Resources"].get_object()
        if "/Contents" not in page or all(_form(resources, name) is None
                                          for name in _entries(resources, "/XObject")):
            return page  # most pages: no form to read, and no stream parsed again
        fonts = DictionaryObject(_entries(resources, "/Font"))
        out: list = []
        if not _inline(page["/Contents"], page.pdf, resources, IDENTITY, None, out, fonts, ""):
            return page
    except Exception:  # an odd form must never fail the upload
        return page
    content = ContentStream(None, page.pdf)
    content.operations = out
    page[NameObject("/Contents")] = content
    page[NameObject("/Resources")] = DictionaryObject({**resources, NameObject("/Font"): fonts})
    return page


def _inline(stream, pdf, resources, ctm, box, out, fonts, path) -> int:
    """Append the stream's operators to `out` with each form it draws written
    in, the forms' fonts named apart in `fonts`. `path` names the form being
    written ("" for the page), and `box` is the part of the page the forms
    around it show (None for all of it). Returns how many text-showing
    operators the forms held, shown or not."""
    held = 0
    saved: list = []
    line, leading = IDENTITY, 0.0  # the text line matrix and leading
    # A form's text object waits for its ET: one that shows nothing visible
    # goes without its text and moves. Layout mode resets its text position
    # at an ET only after shown text, so a BT ... ET left with moves alone
    # shifted every line after it.
    block, visible = None, False
    for i, (operands, op) in enumerate(ContentStream(stream, pdf, "bytes").operations):
        if op == b"q":
            saved.append(ctm)
        elif op == b"Q" and saved:
            ctm = saved.pop()
        elif op == b"cm":
            ctm = _mult([float(n) for n in operands], ctm)
        elif op == b"Do" and path.count("~") < MAX_DEPTH and (form := _form(resources, operands[0])) is not None:
            matrix = [float(n) for n in form.get("/Matrix", IDENTITY)]
            placed = _mult(matrix, ctm)
            out.append(([], b"q"))
            out.append(([FloatObject(n) for n in matrix], b"cm"))
            held += _inline(form, pdf, (form.get("/Resources") or resources).get_object(), placed,
                            _within(box, _bounds(form.get("/BBox"), placed)), out, fonts, f"{path}~{i}")
            out.append(([], b"Q"))
            continue
        elif op == b"Do" and path:
            # an image in a form, or a form too deep: no text pypdf could
            # find (it looks in the page's resources), and plain mode would
            # break the line at it
            continue
        elif op == b"Tf" and path and (font := _entries(resources, "/Font").get(operands[0])) is not None:
            name = NameObject(f"{operands[0]}{path}")
            fonts[name] = font
            operands = [name, *operands[1:]]
        elif op == b"BT":
            line = IDENTITY
            if path:
                block, visible = [], False
        elif op == b"Tm":
            line = [float(n) for n in operands]
        elif op in (b"Td", b"TD"):
            line = _mult([1, 0, 0, 1, float(operands[0]), float(operands[1])], line)
            leading = -float(operands[1]) if op == b"TD" else leading
        elif op == b"TL":
            leading = float(operands[0])
        elif op in (b"T*", b"'", b'"'):
            line = _mult([1, 0, 0, 1, 0, -leading], line)
        into = out if block is None else block
        if op in SHOWS and path:
            held += 1
            if box is not None and not _inside(_mult(line, ctm)[4:], box):
                # hidden; ' and " still move to the next line
                if op == b'"':
                    into.extend([(operands[:1], b"Tw"), (operands[1:2], b"Tc"), ([], b"T*")])
                elif op == b"'":
                    into.append(([], b"T*"))
                continue
            visible = True
        into.append((operands, op))
        if op == b"ET" and block is not None:
            out.extend(block if visible else [kept for kept in block if kept[1] not in TEXT_ONLY])
            block = None
    out.extend(block or [])  # a text object the form never closed
    return held


def _entries(resources, kind: str):
    """One kind of resource (/Font, /XObject) by name."""
    entries = resources.get(kind)
    return entries.get_object() if entries is not None else DictionaryObject()


def _form(resources, name):
    xobject = _entries(resources, "/XObject").get(name)
    xobject = xobject.get_object() if xobject is not None else None
    return xobject if isinstance(xobject, StreamObject) and xobject.get("/Subtype") == "/Form" else None


def _mult(m: list, n: list) -> list:
    """The matrix product m x n, in the PDF's [a b c d e f] form."""
    return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
            m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
            m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]]


def _bounds(bbox, matrix: list) -> tuple | None:
    """The part of the page a form's box covers once placed: x0, y0, x1, y1."""
    if bbox is None:
        return None
    x0, y0, x1, y1 = (float(n) for n in bbox)
    corners = [_mult([1, 0, 0, 1, x, y], matrix)[4:] for x in (x0, x1) for y in (y0, y1)]
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)


def _within(outer: tuple | None, inner: tuple | None) -> tuple | None:
    """The part of the page both boxes show; None is all of it."""
    if outer is None or inner is None:
        return inner if outer is None else outer
    return max(outer[0], inner[0]), max(outer[1], inner[1]), min(outer[2], inner[2]), min(outer[3], inner[3])


def _inside(point: list, box: tuple) -> bool:
    x, y = point
    return box[0] - EDGE <= x <= box[2] + EDGE and box[1] - EDGE <= y <= box[3] + EDGE
