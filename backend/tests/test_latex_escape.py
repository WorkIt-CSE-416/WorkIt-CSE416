'''
The one LaTeX escape (KAN-204). Every piece of applicant text reaches the
template through it, so it alone stands between a resume and TeX that runs.
'''

import pytest

from app.services.resume_render import escape


def test_input_command_becomes_plain_text() -> None:
    assert escape(r"\input{/etc/passwd}") == r"\textbackslash{}input\{/etc/passwd\}"


def test_newlines_become_spaces() -> None:
    # A blank line is \par in TeX, and a stray one breaks a command's argument
    assert escape("one\ntwo\r\nthree\rfour") == "one two three four"
    assert escape("a\n\nb") == "a  b"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("R&D", r"R\&D"),
        ("100%", r"100\%"),
        ("$5", r"\$5"),
        ("#1", r"\#1"),
        ("snake_case", r"snake\_case"),
        ("{x}", r"\{x\}"),
        ("~", r"\textasciitilde{}"),
        ("^", r"\textasciicircum{}"),
        ("C:\\", r"C:\textbackslash{}"),
        # The template's default font puts other glyphs in these slots
        ("a<b>c", r"a\textless{}b\textgreater{}c"),
        ("x|y", r"x\textbar{}y"),
    ],
)
def test_special_characters_print_as_themselves(text: str, expected: str) -> None:
    assert escape(text) == expected


def test_plain_and_accented_text_is_unchanged() -> None:
    assert escape("José Ryan, Texas A–M") == "José Ryan, Texas A–M"
