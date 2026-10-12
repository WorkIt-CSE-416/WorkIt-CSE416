'''
Shapes for an applicant's own LaTeX resume (KAN-176,
routers/latex_resumes.py). Every request carries the whole source it was
made against: field ids are positions in that source (services/latex_source),
so the server holds no editing state between calls.
'''
import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.services.latex_source.safety import MAX_SOURCE_CHARS
from app.services.latex_source.splice import MAX_FIELD_CHARS, Delete, Edit, Insert, Op

MAX_OPS = 200


class LatexOp(BaseModel):
    '''One of: {"edit": id, "text"}, {"after": id, "text"} (a new bullet),
    {"delete": id}.'''
    edit: str | None = Field(None, max_length=10)
    after: str | None = Field(None, max_length=10)
    delete: str | None = Field(None, max_length=10)
    text: str = Field("", max_length=MAX_FIELD_CHARS)

    @model_validator(mode="after")
    def _exactly_one(self) -> "LatexOp":
        if sum(x is not None for x in (self.edit, self.after, self.delete)) != 1:
            raise ValueError("an op names exactly one of edit, after, delete")
        return self

    def op(self) -> Op:
        if self.edit is not None:
            return Edit(self.edit, self.text)
        if self.after is not None:
            return Insert(self.after, self.text)
        return Delete(self.delete or "")


class LatexSource(BaseModel):
    source: str = Field(min_length=1, max_length=MAX_SOURCE_CHARS)
    # Applied to `source` first; empty for the source as it is
    ops: list[LatexOp] = Field([], max_length=MAX_OPS)


class LatexImport(LatexSource):
    name: str = Field("Resume", min_length=1, max_length=80)
    # Set when this is a copy tailored to a job posting
    target_job_id: uuid.UUID | None = None


class LatexField(BaseModel):
    id: str
    kind: Literal["heading", "bullet", "text"]
    # Plain text (**bold**, *italic*) when editable, else the raw LaTeX
    text: str
    editable: bool
    # Which \section it falls under; -1 before the first
    section: int
    line: int


class LatexDoc(BaseModel):
    source: str
    fields: list[LatexField]


class LatexSaved(LatexDoc):
    pages: int


class LatexTailorRequest(BaseModel):
    job_id: uuid.UUID


class LatexSuggestion(BaseModel):
    field_id: str
    original: str
    suggested: str


class LatexTailorResponse(BaseModel):
    # The source the suggestions' field ids point into: saving sends it back
    # with the accepted ones as edit ops
    source: str
    suggestions: list[LatexSuggestion]
    # Why there are none, when there are none for a reason worth saying
    notice: str | None = None
