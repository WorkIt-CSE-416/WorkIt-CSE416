'''
Student documents (KAN-369): files a form asks for besides the resume, one
per kind for each student. The only kind is `transcript` (an unofficial
transcript). Written only through `app/routers/documents.py`.
'''
import uuid as _uuid

from sqlalchemy import CheckConstraint, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Student_Document(BaseModel):
    '''
    `storage_path` is in the `Resume` bucket under the student's folder
    (`<applicant_id>/documents/<uuid><ext>`), or
    `local:<applicant_id>/<file name>`
    (services/local_files.py, development only). A new file replaces the
    row's file; the old one is removed.
    '''
    __tablename__ = "student_documents"
    __table_args__ = (CheckConstraint("kind IN ('transcript')", name="student_documents_kind_check"),)

    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(Text, primary_key=True)
    original_filename: Mapped[str]
    storage_path: Mapped[str]
