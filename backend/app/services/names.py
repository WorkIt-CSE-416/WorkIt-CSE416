"""
A person's name as parts and as one line (KAN-326). The account tables keep
both: `first_name`, `middle_name` and `last_name`, which signup and Settings
ask for, and `full_name`, the line every other reader prints (the bar,
resume headers, the Chrome autofiller). `full_name` is always the parts
joined, so the two never disagree; a writer that has only a line (an OAuth
sign-in, the resume editor's header) splits it.
"""


def join_name(first: str, middle: str | None, last: str | None) -> str:
    '''the parts as one line, single-spaced, missing parts left out'''
    return " ".join(part.strip() for part in (first, middle, last) if part and part.strip())


def split_name(full: str) -> tuple[str, str | None, str | None]:
    '''
    a line as (first, middle, last): the first word, the words between, and
    the last word. A one-word name is a first name alone. A guess for a line
    nobody split (a provider's name, a name typed before the split), which
    the student corrects in Settings.
    '''
    words = full.split()
    if not words:
        return "", None, None
    if len(words) == 1:
        return words[0], None, None
    middle = " ".join(words[1:-1]) or None
    return words[0], middle, words[-1]


def name_columns(
    full: str, first: str | None = None, middle: str | None = None, last: str | None = None
) -> dict[str, str | None]:
    '''
    the four name columns for an account row: from the parts when a first
    name is given (signup's form), else from the line split (an OAuth name)
    '''
    if not first or not first.strip():
        first, middle, last = split_name(full)
    return {
        "full_name": join_name(first, middle, last),
        "first_name": first.strip(),
        "middle_name": (middle or "").strip() or None,
        "last_name": (last or "").strip() or None,
    }
