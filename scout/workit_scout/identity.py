"""
Identity-data removal: the one function that strips a student's identity data
from text before any model sees it. See ../CLAUDE.md, "Identity data never
reaches a model".
"""

import re

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
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
) -> str:
    """Return `text` with the student's identity data replaced by placeholders."""
    text = _literal(text, email, "[email]")
    text = _EMAIL.sub("[email]", text)
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
