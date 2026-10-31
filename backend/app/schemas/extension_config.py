from pydantic import BaseModel


class DisabledJobSystem(BaseModel):
    """A job system turned off: the Fill engine's id ("workday") and its name ("Workday")."""

    job_system: str
    name: str


class ExtensionConfig(BaseModel):
    """GET /extension/config (KAN-467): what the extension reads every 15 minutes."""

    disabled_job_systems: list[DisabledJobSystem]
