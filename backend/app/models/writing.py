'''
a student's own writing (KAN-384): up to three samples they gave, and the
style card their Claude built from them through the connector. The card
tells their Claude how they write; the samples stay WorkIt's, for the
check that an answer copies none of them (KAN-380).
ex: Sam gave an essay and a cover letter; Sam's Claude read both and saved
a card that says Sam writes short sentences and opens with the result
'''
import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Writing_Sample(BaseModel):
    '''
    one piece of the student's own writing, word for word. Changing any of
    a student's samples deletes their style card (queries/writing.py), so a
    card is always built from the samples they have now. `imported`: the
    Apply import brought it (scripts/import_apply_writing.py), which replaces
    only these; one the student adds or edits in WorkIt is false.
    '''
    __tablename__ = "writing_samples"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text)
    imported: Mapped[bool] = mapped_column(server_default=false())

    __table_args__ = (CheckConstraint("length(btrim(text)) > 0", name="writing_samples_text_not_blank"),)


class Style_Card(BaseModel):
    '''
    how the student writes, as their Claude described it from their samples:
    one per student, gone when a sample changes
    '''
    __tablename__ = "style_cards"
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), primary_key=True)
    card: Mapped[str] = mapped_column(Text)
