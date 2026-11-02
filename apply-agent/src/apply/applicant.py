"""Who Claude writes as: the applicant the Applicant profile names.

Prompts, the answering guides and the cover letter's slots say NAME where the
applicant's first name goes and SCHOOL where their school goes. as_applicant
wraps a Claude so every call it is sent says the profile's own name and school
instead, wherever the prompt was built.
"""

import json

from apply.profile import ApplicantProfile

NAME, SCHOOL = "@NAME@", "@SCHOOL@"


def first_name(profile: ApplicantProfile) -> str:
    """The name they go by, else their legal first name."""
    return profile.get("identity.preferred_first_name") or profile.get("identity.legal_first_name") or "the applicant"


def named(text: str, profile: ApplicantProfile) -> str:
    """`text` with NAME and SCHOOL said as the profile gives them."""
    return (text.replace(NAME, first_name(profile))
            .replace(SCHOOL, profile.get("education.school") or "their school"))


class as_applicant:
    """`claude`, with every ask said as `profile`'s applicant (named)."""

    def __init__(self, claude, profile: ApplicantProfile):
        self._claude, self._profile = claude, profile

    def ask(self, *, model: str, system: str, prompt: str, schema: dict) -> dict:
        say = lambda text: named(text, self._profile)
        return self._claude.ask(model=model, system=say(system), prompt=say(prompt),
                                schema=json.loads(say(json.dumps(schema))))

    def __getattr__(self, name: str):
        return getattr(self._claude, name)
