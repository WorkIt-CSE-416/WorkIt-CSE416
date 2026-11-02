import re

from pydantic import BaseModel


class DisabledJobSystem(BaseModel):
    """A job system turned off: the Fill engine's id ("workday") and its name ("Workday")."""

    job_system: str
    name: str


class ExtensionConfig(BaseModel):
    """GET /extension/config (KAN-467): what the extension reads every 15 minutes."""

    disabled_job_systems: list[DisabledJobSystem]


# The extension's version as manifest.json writes it (KAN-466): up to four dot-separated numbers.
# The one pattern for every reader: fill events' and uninstall answers' schemas, and app/main.py's
# version check (version_key).
EXTENSION_VERSION = r"^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$"


def version_key(text: str) -> tuple[int, ...] | None:
    """"0.3" as (0, 3, 0, 0), as Chrome compares versions; None for text EXTENSION_VERSION refuses."""
    text = text.strip()
    if not re.fullmatch(EXTENSION_VERSION, text):
        return None
    return (*map(int, text.split(".")), 0, 0, 0)[:4]
