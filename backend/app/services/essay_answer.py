"""Generating a grounded answer to one open-ended application question
(the autofiller extension's essay-question feature). Like services/tailor.py
and services/assistant.py: the prompt asks the model to only use the facts
given, and code enforces that independently afterward — neither is trusted
alone.

Unlike Tailor, which rewords one existing bullet and checks it against that
bullet's own original text, this writes new prose from scratch, so there is
no single "original" to check it against. `bank_context` joins the whole
bank's bullets and entry titles/organizations into one grounding text
instead, and `generate`'s truth-rule check runs the generated answer against
all of it at once. That is coarser than Tailor's per-bullet check — a
student's whole bank is small enough that this is still a meaningful check,
but it is a known, accepted limitation, not a design the way Tailor's is:
tighten it if it proves too strict or too loose once this is live-tested.
"""

from workit_scout.identity import Identity, placeholders_in
from workit_scout.llm import LLM, Message

from app.schemas.essay_answer import EssayAnswerReading, EssayAnswerRequest
from app.services.bank import Bank
from app.services.truth_rule import invented

# One frozen string, like Tailor's and the assistant's own prompts — stating
# the no-invention rule to the model, which generate() below enforces again
# regardless of whether the model actually followed it.
PROMPT = """\
You draft a short answer to one open-ended question on a student's job \
application, grounded only in the facts about them given below. Never \
invent a number, tool, company, project, or result the facts do not \
already hold — paraphrasing and connecting the facts is fine, adding to \
them is not. Write 3-5 sentences of plain prose, first person, no headers \
or bullet points, in a professional but natural voice suited to a text box \
on a job application. Answer with JSON only: {"answer": "..."}.
"""


def bank_context(bank: Bank) -> tuple[str, list[str]]:
    """(grounding text, skill names): the truth-rule inputs, and the facts
    the prompt itself is built from. The whole bank, not a ranked subset —
    unlike Tailor's bullets-against-a-posting ranking, there is no posting
    text here to rank against, and a student's bank is small enough to use
    whole."""
    lines = []
    for entry in bank.entries:
        row = entry.row
        heading = ", ".join(p for p in (row.title, row.organization) if p)
        if heading:
            lines.append(heading)
        for bullet in entry.bullets:
            lines.append(f"- {bullet.text}")
    return "\n".join(lines), [s.name for s in bank.skills]


def prompt(request: EssayAnswerRequest, bank: Bank) -> list[Message]:
    """The posting's question and the bank, with no links: same redaction
    Tailor's own prompt() applies to entry text."""
    grounding, skills = bank_context(bank)
    where = ""
    if request.company_name or request.job_title:
        role = request.job_title or "this role"
        company = f" at {request.company_name}" if request.company_name else ""
        where = f"The question is from an application for {role}{company}.\n\n"
    length = f"\n\nKeep it under {request.max_length} characters." if request.max_length else ""
    user = (
        f"{where}Question: {request.question}{length}\n\n"
        f"The student's skills: {', '.join(skills) or '(none)'}\n\n"
        f"The student's experience:\n{grounding or '(none yet)'}"
    )
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": user}]


async def generate(llm: LLM, identity: Identity, request: EssayAnswerRequest, bank: Bank) -> str | None:
    """The answer, or None when the model's reply invents a fact the bank
    doesn't hold or echoes back an identity placeholder — callers turn
    `None` into an honest failure, never a guess."""
    reading: EssayAnswerReading = await llm.complete_json(
        prompt(request, bank), EssayAnswerReading, identity=identity
    )
    text = " ".join(reading.answer.split())
    if not text:
        return None
    grounding, skills = bank_context(bank)
    # The question, company and role are the request's own words, not facts the model added.
    given = "\n".join(p for p in (grounding, request.question, request.company_name, request.job_title) if p)
    if invented(text, given, skills) or placeholders_in(text):
        return None
    return text
