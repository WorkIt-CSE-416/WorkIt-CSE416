'''
company briefs (KAN-382): what a company builds and has shipped lately, one
row per company, shared by every student who applies there. A student's
Claude researches it through the connector; WorkIt keeps only the facts
whose quote it found on the page (app/auto_apply/briefs.py, the one writer).
ex: Acme: [{category: products, fact, url, quote, published: 2026-09}, ...]
'''
import datetime

from sqlalchemy import DateTime, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Company_Brief(Base):
    '''
    `company_key` is the company's name folded (case, punctuation and
    "Inc."-like endings dropped), so "Acme, Inc." and "ACME" share a brief.
    `facts` is the brief, checked; `saved_at` is NULL until a brief is kept.
    `attempted_at` is the last research that was not kept (too few facts,
    or a lower score), so the company is not handed out again at once.
    '''
    __tablename__ = "company_briefs"
    company_key: Mapped[str] = mapped_column(Text, primary_key=True)
    company: Mapped[str] = mapped_column(Text)
    facts: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    saved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    attempted_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
