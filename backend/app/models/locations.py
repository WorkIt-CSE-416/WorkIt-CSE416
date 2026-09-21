from app.db import Base
from sqlalchemy import ForeignKey, String, text, Text, CHAR, UniqueConstraint, desc
from sqlalchemy.orm import Mapped,mapped_column

class Country(Base):
    '''
    stores all the country locations 
    '''
    __tablename__="countries"
    code: Mapped[str]= mapped_column(CHAR(2), primary_key=True)
    name: Mapped[str] = mapped_column(Text)

class State(Base): 
    '''
    all the state codes
    if it's outside of US, it's the unit similar with state, like provinces
    '''
    __tablename__ = "states"
    code: Mapped[str] = mapped_column(String(6), primary_key=True)   # 'US-CA'
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    name: Mapped[str] = mapped_column(Text)                           # 'California'
    __table_args__ = (UniqueConstraint("code", "country_code"),)