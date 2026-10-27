"""POST /job-system-requests (KAN-369): a host name and nothing else. Any
other key, or a host with a scheme, port, path or no dot, is refused (422),
never stored."""

from pydantic import BaseModel, ConfigDict, Field


class JobSystemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # A DNS host name, lower case: labels of letters, digits and -, at least one dot.
    host: str = Field(min_length=4, max_length=253, pattern=r"^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$")


class JobSystemRequestStored(BaseModel):
    id: str
