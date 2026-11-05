"""Put back the spaces pypdf drops between words (KAN-303).

A PDF shows a space as a character or as a gap: a kern in a TJ array, or the
next word placed further along. pypdf turns some gaps into nothing:

- layout mode rounds a gap to a whole number of spaces, so under half a
  space is none;
- plain mode adds a space for a TJ kern of half a space or more only;
- neither moves past a run shown before a font change or a kern in a new TJ
  array, so the gap after it is measured from the wrong place, often the
  line's start ("(scanning) Tj /F2 10 Tf [-333 (2,000+)] TJ").

`gapped_words` walks a page's text runs itself, moving past each one as the
PDF spec says, and finds each chain of whole words that visible gaps (not
space characters) separate. `restore_spaces` then splits a token of the
text only when it is exactly some of those words glued in order. It only
ever adds a space where the page shows a gap, so the order and line breaks
pypdf chose stay as they are.

Whole words matter: pdfTeX breaks a word into runs at its kerns ("over" as
"o" and "ver"), and an earlier version that matched "with" + "o" split
"without" on a real resume into "with out".

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
# Punctuation that sits against the word before it, and brackets that sit
# against the word after: a gap there is spacing, never a space. Word put a
# comma, and pdfTeX a closing bracket, a little apart on team resumes, which
# read "JavaScript ," and "(Protobuf )" until these were left out.
CLOSES = ",.;:!?)]}%”’"
OPENS = "([{“‘"
# The most words one glued token is split into. pdfTeX separates every word
# of a line by a gap, so a whole glued contact line can be one token.
MAX_GLUED = 12


def gapped_words(page) -> dict[str, str]:
    """Each run of words gaps separate on this page, glued -> spaced
    ("scanning2,000+" -> "scanning 2,000+"). Empty when the page can't be
    walked: the fix is best-effort."""
    try:
        runs = _runs(page)
    except Exception:  # an odd content stream must never fail the upload
        return {}
    chains: list[list[str]] = []
    chain: list[str] = []  # whole words, each after the last a gap
    word = ""  # the word being built, across runs with no gap

    def end_word() -> None:
        nonlocal word
        if word:
            chain.append(word)
        word = ""

    def end_chain() -> None:
        nonlocal chain
        end_word()
        if len(chain) > 1:
            chains.append(chain)
        chain = []

    for prev, run in zip([None, *runs], runs):
        text = run.text
        if not text:
            continue
        gap, em = (run.tx - prev.displaced_tx, prev.font_height) if prev else (0.0, 0.0)
        if not prev or abs(run.ty - prev.ty) > BASELINE_EM * em or gap <= -GAP_EM * em:
            end_chain()  # another line, or a jump back: a column or a new block
        elif gap >= GAP_EM * em and not _hugs(word, text):
            end_word()  # a gap: the chain goes on with the next word
        # a space character ends the chain: the text always keeps that space
        for i, piece in enumerate(re.split(r"\s+", text)):
            if i:
                end_chain()
            word += piece
    end_chain()

    glued: dict[str, str] = {}
    for words in chains:
        for i in range(len(words)):
            for j in range(i + 2, min(i + MAX_GLUED, len(words)) + 1):
                glued.setdefault("".join(words[i:j]), " ".join(words[i:j]))
    return glued


def _hugs(word: str, text: str) -> bool:
    """The next run starts with closing punctuation, or the word so far ends
    with an opening bracket: no space between them, whatever the gap."""
    return text[0] in CLOSES or (word[-1:] in OPENS and word != "")


def restore_spaces(text: str, glued: dict[str, str]) -> str:
    """Split each whitespace-separated token that is exactly gapped words
    glued together. A token is matched whole, so a real word that merely
    starts like a pair ("without" against "with" + "over") stays as it is."""
    if not glued:
        return text
    return re.sub(r"\S+", lambda m: glued.get(m.group(), m.group()), text)


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
