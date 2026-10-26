'''
The essay answer's truth check (services/essay_answer.py's `generate`): a
first-person answer that names the company and role the request gave keeps
the truth rule; one that adds a tool the bank lacks doesn't. The extension's
Generate sends each written question here (KAN-164); before 2026-10-24 every
live answer was refused, since "I" and the company's name read as invented.
'''

import json

import pytest
from workit_scout.identity import Identity
from workit_scout.testing import ScriptedLLM

from app.models.bank import Bank_Bullet, Bank_Entry, Bank_Skill
from app.models.dto import bank_section
from app.schemas.essay_answer import EssayAnswerRequest
from app.services.bank import Bank, Entry
from app.services.essay_answer import generate

pytestmark = pytest.mark.anyio

BANK = Bank(
    entries=[
        Entry(
            row=Bank_Entry(section=bank_section.experience, title="Software Engineering Intern", organization="Northwind Logistics"),
            bullets=[Bank_Bullet(text="Built a Python service that matched 4,000 daily shipment scans to orders.")],
        )
    ],
    skills=[Bank_Skill(name="Python")],
)
REQUEST = EssayAnswerRequest(
    question="Why are you interested in Cloudflare's Software Engineering Internship?",
    company_name="Cloudflare",
    job_title="Software Engineer Intern (2027)",
)


def reply(answer: str) -> ScriptedLLM:
    return ScriptedLLM([json.dumps({"answer": answer})])


async def test_a_first_person_answer_naming_the_company_and_role_keeps_the_truth_rule() -> None:
    answer = (
        "I want to join Cloudflare's Software Engineering Internship because I enjoy backend work. "
        "At Northwind Logistics I built a Python service that matched 4,000 daily shipment scans to orders."
    )
    assert await generate(reply(answer), Identity(), REQUEST, BANK) == answer


async def test_an_answer_naming_a_tool_the_bank_lacks_is_refused() -> None:
    answer = "I want to join Cloudflare because I built Kubernetes clusters at Northwind Logistics."
    assert await generate(reply(answer), Identity(), REQUEST, BANK) is None
