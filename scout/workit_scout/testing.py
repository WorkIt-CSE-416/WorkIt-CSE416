"""
A stand-in for the model, for Scout's own tests and the API's.

Lives in the package rather than in either test folder so both can use the
same one: the API's route tests need a model as much as Scout's do.
"""

from collections.abc import AsyncIterator, Sequence

from workit_scout.llm import LLM, Endpoint, Message

PRIMARY = Endpoint("http://primary.test/v1", "primary-model")
FALLBACK = Endpoint("http://fallback.test/v1", "fallback-model")

Script = list[str | Exception] | Exception


class ScriptedLLM(LLM):
    """
    Each endpoint yields its scripted pieces of reply in order, raising any
    exception it reaches — so a script can fail before a reply or halfway
    through one. No fallback script means no fallback endpoint.
    """

    def __init__(self, primary: Script, fallback: Script | None = None):
        super().__init__(PRIMARY, FALLBACK if fallback is not None else None)
        self._scripts = {PRIMARY: primary, FALLBACK: fallback}
        #: Every prompt sent, in order, as the model would have received it.
        self.prompts: list[list[Message]] = []

    @property
    def system_prompt(self) -> str:
        return self.prompts[0][0]["content"]

    async def _complete(
        self, client, endpoint: Endpoint, messages: Sequence[Message]
    ) -> AsyncIterator[str]:
        self.prompts.append(list(messages))
        script = self._scripts[endpoint]
        for item in script if isinstance(script, list) else [script]:
            if isinstance(item, Exception):
                raise item
            yield item
