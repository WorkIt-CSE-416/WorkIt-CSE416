'''
The truth-rule check (KAN-217): WorkIt's model may only rephrase facts the
student gave. One pure function, tested directly (tests/test_truth_rule.py):

    invented(variant, original, skills, tools=()) -> the invented facts

A bullet variant passes when the list is empty. It fails when it holds a
**number** or a **tool** that is in neither its original bullet nor the
`skills` the caller passes (Tailor: the skills the resume shows; the editor
assistant and essay answers: the bank's).

- **A number** is a run of digits ("40" in "40%", "1,200" read as "1200").
- **A tool** is a word shaped like a product name: one with a capital after
  its first letter (TypeScript, AWS, iOS), a `+` or `#` (C++, C#), or a
  capital that does not start the sentence (Python, Docker in mid-bullet).
  The pronoun "I" is never one: an essay answer is in the first person.
  The first word is skipped by shape, since a rewording may open with a new
  verb; `tools` (the posting's keywords) names words that count wherever
  they stand, so "Kubernetes clusters..." is still caught.
- A fact is present when it appears, ignoring case, as a whole word in the
  original or a skill name, so "Go" is never found in "Django".

It errs toward dropping: a proper noun the original lacks counts as a tool,
and a number spelled out in the original ("forty") does not cover the digits.
A dropped variant costs a rewording; a kept invented one costs the truth.
'''

import re
from collections.abc import Iterable

_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_WORD = re.compile(r"\.?[A-Za-z][\w.+#]*[\w+#]|[A-Za-z]")
_SENTENCE_END = re.compile(r"[.!?:;]\s*$")


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "") for n in _NUMBER.findall(text)}


def _present(word: str, text: str) -> bool:
    words = r"\s+".join(re.escape(w) for w in word.split())
    return re.search(rf"(?<!\w){words}(?![\w+#])", text, re.IGNORECASE) is not None


def _shaped_like_a_tool(word: str, leads: bool) -> bool:
    if word == "I":  # the pronoun, mid-sentence in a first-person essay answer
        return False
    if "+" in word or "#" in word:
        return True
    if any(c.isupper() for c in word[1:]):
        return True
    return word[0].isupper() and not leads


def invented(variant: str, original: str, skills: Iterable[str], tools: Iterable[str] = ()) -> list[str]:
    '''The numbers and tools in `variant` that are in neither `original` nor
    `skills`, each once, in the order they appear. Empty: the variant keeps
    the truth rule.'''
    given = "\n".join([original, *skills])
    found: list[str] = []
    known = _numbers(given)
    for match in _NUMBER.finditer(variant):
        number = match[0].replace(",", "")
        if number not in known and number not in found:
            found.append(number)
    for match in _WORD.finditer(variant):
        word = match[0]
        leads = not variant[: match.start()].strip() or bool(_SENTENCE_END.search(variant[: match.start()]))
        if _shaped_like_a_tool(word, leads) and not _present(word, given) and word not in found:
            found.append(word)
    for tool in tools:
        if tool.strip() and _present(tool, variant) and not _present(tool, given) and tool not in found:
            found.append(tool)
    return found
