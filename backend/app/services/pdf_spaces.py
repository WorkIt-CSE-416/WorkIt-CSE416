"""Put back the spaces pypdf drops between words (KAN-303).

A PDF shows a space as a character or as a gap: a kern in a TJ array, or the
next word placed further along. pypdf turns some gaps into nothing:

- layout mode rounds a gap to a whole number of spaces, so under half a
  space is none;
- plain mode adds a space for a TJ kern of half a space or more only;
- neither moves past a run shown before a font change or a kern in a new TJ
  array, so the gap after it is measured from the wrong place, often the
  line's start ("(scanning) Tj /F2 10 Tf [-333 (2,000+)] TJ").

`glued_pairs` walks a page's text runs itself, moving past each one as the
PDF spec says, and lists every pair of words a visible gap separates.
`restore_spaces` then puts a space between each pair wherever the text has
them glued. It only ever adds a space where the page shows a gap, so the
order and line breaks pypdf chose stay as they are.

It reuses pypdf's layout-mode text state (matrices, fonts, glyph widths), a
private API: `tests/test_pdf_spaces.py` fails if an upgrade changes it.
"""
import re

# A gap of this share of an em or more is a space. A shrunk TeX space is
# about 0.22 em and a thin space 0.17; glyph positioning rounds by a few
# hundredths, and kerns between letters tighten (a positive TJ number).
GAP_EM = 0.08
# Runs whose baselines differ by more than this share of an em are not one
# line: a superscript ("1st") sits higher and joins its word.
BASELINE_EM = 0.1


def glued_pairs(page) -> list[tuple[str, str]]:
    """Each (word, next word's start) a gap separates on this page, in order.
    Empty when the page can't be walked: the fix is best-effort."""
    try:
        runs = _runs(page)
    except Exception:  # an odd content stream must never fail the upload
        return []
    pairs: list[tuple[str, str]] = []
    word = ""  # the word ending at the last run, across runs with no gap
    for prev, run in zip([None, *runs], runs):
        text = run.text
        if not text:
            continue
        gap, em = (run.tx - prev.displaced_tx, prev.font_height) if prev else (0.0, 0.0)
        if not prev or abs(run.ty - prev.ty) > BASELINE_EM * em or gap <= -GAP_EM * em:
            word = ""  # another line, or a jump back: a column or a new block
        elif gap >= GAP_EM * em:
            if word and not text[0].isspace():
                start = text.split(maxsplit=1)[0]
                if (word, start) not in pairs:
                    pairs.append((word, start))
            word = ""
        word = "" if text[-1].isspace() else _last_word(word + text)
    return pairs


def restore_spaces(text: str, pairs: list[tuple[str, str]]) -> str:
    """Put a space between each pair the text has glued. The word must start
    a word in the text, so "a" + "dashboard" never splits "adashboard" in the
    middle of a longer word. In order, so a fix makes room for the next."""
    for word, start in pairs:
        text = re.sub(rf"(?<!\S){re.escape(word)}(?={re.escape(start)})", lambda m: m.group() + " ", text)
    return text


def _last_word(text: str) -> str:
    return text.split()[-1] if text.strip() else ""


def _runs(page) -> list:
    """Every text run on the page with its position, from pypdf's text state.

    pypdf's own walk (`_fixed_width_page.recurse_to_target_op`) adds a run's
    width to the position only when a TJ kern follows it, which is the bug
    this module works around; this one moves past every run."""
    from pypdf._text_extraction._layout_mode._fixed_width_page import resolve_font
    from pypdf._text_extraction._layout_mode._text_state_manager import TextStateManager
    from pypdf.generic import ContentStream

    fonts = page._layout_mode_fonts()
    state = TextStateManager()
    runs = []

    def show(value) -> None:
        run = state.text_state_params(value)
        runs.append(run)
        state.add_trm(run.displacement_matrix())

    if "/Contents" not in page:
        return runs
    for operands, op in ContentStream(page["/Contents"].get_object(), page.pdf, "bytes").operations:
        if op == b"q":
            state.add_q()
        elif op == b"Q":
            state.remove_q()
        elif op == b"cm":
            state.add_cm(*operands)
        elif op in (b"BT", b"ET"):
            state.reset_tm()
        elif op == b"Tf":
            state.set_font(resolve_font(fonts, operands[0]), operands[1])
        elif op in (b"Td", b"TD", b"Tm", b"T*"):
            state.reset_trm()
            if op == b"Tm":
                state.reset_tm()
            elif op == b"TD":
                state.set_state_param(b"TL", -operands[1])
            elif op == b"T*":
                operands = [0, -state.TL]
            state.add_tm(operands)
        elif op == b"Tj":
            show(operands[0])
        elif op == b"TJ":
            for item in operands[0]:
                if isinstance(item, (bytes, str)):
                    show(item)
                else:  # a kern, in thousandths of an em; negative moves right
                    state.add_trm(state.text_state_params("").displacement_matrix(td_offset=item))
        elif op in (b"'", b'"'):
            if op == b'"':
                state.set_state_param(b"Tw", operands[0])
                state.set_state_param(b"Tc", operands[1])
            state.reset_trm()
            state.add_tm([0, -state.TL])
            show(operands[-1])
        else:  # Tc, Tw, Tz, TL and Ts; every other operator is ignored
            state.set_state_param(op, operands)
    return runs
