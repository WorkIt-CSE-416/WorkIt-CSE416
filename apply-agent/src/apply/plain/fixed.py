"""Fixed page functions (KAN-611): page code Apply's own modules run with `evaluate`, which a plain
Worker runs as code its extension ships, not through eval.

On a plain Worker, `evaluate(code)` needs eval or user scripts: a page whose CSP forbids eval
refuses it in Chrome for Testing, where Allow User Scripts can't be turned on. So the page
functions the held page runs on every turn (Needs you's FIELD, Resume's FIELD_ERROR, the emailed
code's WORDS and guard switches) are written into the extension as `vendor/fixed.js` by
`apply plain prepare`, from the very strings their modules hold. PortPage's `evaluate` and
`Locator.evaluate` see one of these strings and run its fixed copy (the `fixed.call` op) instead,
so the modules stay as they are, and one source serves both kinds of Worker.

Each entry: the string a module evaluates → (its name, the world it runs in, the function).
ISOLATED is the extension's own world: it reads and moves the page's DOM, as these do.
MAIN is the page's: for code that sets the page's own variables.
"""

import json
from functools import cache


@cache
def functions() -> dict[str, tuple[str, str, str]]:
    # Imported here: these modules import much of Apply, and PortPage imports this one.
    from apply import email_code, on_page, stuck
    from apply.plain import page

    statements = lambda code: "() => { " + code + "; }"
    return {
        on_page.FIELD: ("onPageField", "ISOLATED", on_page.FIELD),
        stuck.FIELD_ERROR: ("fieldError", "ISOLATED", stuck.FIELD_ERROR),
        email_code.WORDS: ("codeBoxWords", "ISOLATED", email_code.WORDS),
        email_code.ARM: ("codeGuardOn", "MAIN", statements(email_code.ARM)),
        email_code.DISARM: ("codeGuardOff", "MAIN", statements(email_code.DISARM)),
        page.VIEWPORT: ("viewportSize", "ISOLATED", page.VIEWPORT),
    }


def lookup(expression: str) -> tuple[str, str] | None:
    """(name, world) of the fixed function `expression` is, or None for page code of any other kind."""
    found = functions().get(expression)
    return (found[0], found[1]) if found else None


def script() -> str:
    """vendor/fixed.js: every fixed function on `globalThis.__applyFixed`, in whichever world it is loaded."""
    lines = ["// Written by `apply plain prepare` from Apply's own page functions (apply/plain/fixed.py). Do not edit.",
             "(() => {", "const F = (globalThis.__applyFixed = globalThis.__applyFixed || {});"]
    for name, _world, source in functions().values():
        lines.append(f"F[{json.dumps(name)}] = (\n{source.strip().rstrip(';')}\n);")
    lines.append("})();")
    return "\n".join(lines) + "\n"
