"""
Identity-data removal: the one function that strips a student's identity data
from text before any model sees it. See ../CLAUDE.md, "Identity data never
reaches a model".
"""

import re
from collections.abc import Iterable

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# A path after a host, ending before any trailing punctuation.
_TAIL = r"""(?:\S*[^\s.,;:!?)\]'"])?"""
_PATH = rf"(?:/{_TAIL})?"
_HOST = r"[\w-]+(?:\.[\w-]+)+"
# A scheme or "www." marks a link; a bare host counts only with a path
# ("github.com/jd"), so tool names such as Node.js and ASP.NET survive.
_URL = re.compile(
    rf"""https?://\S*[^\s.,;:!?)\]'"]|(?<![\w@.])www\.{_HOST}{_PATH}"""
    rf"|(?<![\w@./-]){_HOST}/{_TAIL}"
)
# Digit groups joined by at most one space, dot or dash, with an optional
# country code; only a run of 10 to 15 digits counts, so dates, years,
# percentages and counts in a bullet survive.
_GROUP = r"(?:\(\d{1,4}\)|\d{1,4})"
_PHONE = re.compile(
    rf"(?<![\w+])(?:\+\d{{1,3}}[\s.-]?)?{_GROUP}(?:[\s.-]?{_GROUP}){{1,5}}(?!\w)"
)


def _literal(text: str, value: str | None, placeholder: str) -> str:
    if not value or not value.strip():
        return text
    return re.sub(re.escape(value.strip()), placeholder, text, flags=re.IGNORECASE)


def _profile_link(text: str, link: str) -> str:
    core = re.sub(r"^(?:https?://)?(?:www\.)?", "", link.strip(), flags=re.IGNORECASE)
    core = core.rstrip("/")
    if not core:
        return text
    found = rf"(?:https?://)?(?:www\.)?{re.escape(core)}{_PATH}(?![\w-])"
    return re.sub(found, "[link]", text, flags=re.IGNORECASE)


def _phone(match: re.Match[str]) -> str:
    digits = sum(c.isdigit() for c in match[0])
    return "[phone]" if 10 <= digits <= 15 else match[0]


def _profile_phone(text: str, phone: str | None) -> str:
    # The profile's number in any formatting: its last ten digits with any
    # separators between them, plus whatever country code precedes them.
    digits = re.sub(r"\D", "", phone or "")[-10:]
    if len(digits) < 7:
        return text
    between = r"[\s().-]*"
    found = rf"(?:\+\d{{1,3}}{between})?\(?" + between.join(digits)
    return re.sub(rf"(?<![\w+]){found}(?!\d)", "[phone]", text)


def remove_identity(
    text: str,
    *,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    links: Iterable[str | None] = (),
) -> str:
    """
    Return `text` with identity data replaced by `[name]`, `[email]`, `[phone]`
    and `[link]`. The profile's own fields are matched first, then any email,
    URL or phone by pattern, the name last so a name inside an email or a link
    cannot break that match. Each part of the name is replaced on its own, in
    any case, even where it is also a common word: privacy wins over wording.
    Nothing maps a placeholder back to its value, by design.
    """
    text = _literal(text, email, "[email]")
    text = _EMAIL.sub("[email]", text)
    for link in links:
        text = _profile_link(text, link or "")
    text = _URL.sub("[link]", text)
    text = _profile_phone(text, phone)
    text = _PHONE.sub(_phone, text)
    if name:
        parts = sorted({name.strip(), *name.split()}, key=len, reverse=True)
        words = "|".join(re.escape(p) for p in parts if len(p) > 1)
        if words:
            text = re.sub(
                rf"(?<!\w)(?:{words})(?!\w)", "[name]", text, flags=re.IGNORECASE
            )
    return text
