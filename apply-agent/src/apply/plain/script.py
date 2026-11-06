"""Page code for the `eval` op: Playwright's evaluate(expression, arg), as one expression.

The wrapped code evaluates `expression`; a function is called with `arg`; a promise is
awaited. It answers {ok: value}, {undef: true}, or {err: {name, message}}, so a page error
comes back as data rather than as the extension's own failure.
"""

import json

from apply.plain.bridge import PortError

USER_SCRIPTS_OFF = ("the page's CSP blocks eval and this Worker's user scripts are off: turn on Allow User Scripts "
                    "for the Apply Worker extension in the seed profile (`uv run apply plain seed`)")


def wrap(expression: str, arg=None) -> str:
    body = expression.strip().rstrip(";")
    return ("(async () => { try { let __v = (\n" + body + "\n); "
            "if (typeof __v === 'function') __v = __v(" + json.dumps(arg) + "); __v = await __v; "
            "return __v === undefined ? {undef: true} : {ok: __v}; } "
            "catch (e) { return {err: {name: (e && e.name) || 'Error', message: String((e && e.message) || e)}}; } })()")


def unwrap(answer):
    """The value a wrapped expression answered, or its error raised as PortError."""
    if not isinstance(answer, dict):
        raise PortError("EvalError", f"page code gave no answer ({answer!r})")
    if "err" in answer:
        error = answer["err"] or {}
        if error.get("name") == "UserScriptsOff":
            raise PortError("UserScriptsOff", f"{USER_SCRIPTS_OFF} ({error.get('message')})")
        raise PortError("EvalError", f"{error.get('name', 'Error')}: {error.get('message', '')}")
    return None if answer.get("undef") else answer.get("ok")


def evaluate(connection, tab: int, expression: str, arg=None, frame: int = 0):
    """Playwright's page.evaluate(expression, arg), in the MAIN world of `frame` of `tab`."""
    return unwrap(connection.call("eval", tab=tab, frame=frame, code=wrap(expression, arg)))
