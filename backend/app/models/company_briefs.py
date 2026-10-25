'''
company briefs (KAN-382): what a company builds and has shipped lately, one
row per company and one per team a posting names (KAN-369), shared by every
student who applies there. A student's
Claude researches it through the connector; WorkIt keeps only the facts
whose quote it found on the page (app/auto_apply/briefs.py, the one writer).
ex: Acme: [{category: products, fact, url, quote, published: 2026-09}, ...]
posting teams (KAN-369): the team each posting names ('' for none), named once
by the first student's Claude and read by every student applying to it.
'''
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Company_Brief(Base):
    '''
    `company_key` is the company's name folded (case, punctuation and
    "Inc."-like endings dropped), so "Acme, Inc." and "ACME" share a brief.
    `team` is '' for the company's brief, else a team's name folded
    (`briefs.team_key`), so postings naming one team share its brief.
    `facts` is the brief, checked; `saved_at` is NULL until a brief is kept.
    `attempted_at` is the last research that was not kept (too few facts,
    or a lower score), so the company is not handed out again at once.
    '''
    __tablename__ = "company_briefs"
    company_key: Mapped[str] = mapped_column(Text, primary_key=True)
    team: Mapped[str] = mapped_column(Text, primary_key=True, server_default=text("''"))
    company: Mapped[str] = mapped_column(Text)
    facts: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    saved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    attempted_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))


class Posting_Team(Base):
    '''
    The team a job posting names, as the posting writes it, or '' when it
    names none. Written once (the first naming stands), so every student
    applying to the posting reads the same team brief.
    '''
    __tablename__ = "posting_teams"
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_postings.id", ondelete="CASCADE"), primary_key=True)
    team: Mapped[str] = mapped_column(Text)
    named_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
