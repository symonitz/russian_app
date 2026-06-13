"""ORM table definitions. Card/log blobs are stored as JSON; due times as
Unix-epoch floats (UTC) for unambiguous range queries on SQLite."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Integer, JSON, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ruslearn.db import Base


class Lemma(Base):
    __tablename__ = "lemma"

    id: Mapped[int] = mapped_column(primary_key=True)
    cyrillic: Mapped[str] = mapped_column(String, unique=True, index=True)
    stressed: Mapped[str] = mapped_column(String)
    translit: Mapped[str] = mapped_column(String, default="")
    gloss_en: Mapped[str] = mapped_column(String)
    pos: Mapped[str | None] = mapped_column(String, nullable=True)
    is_cognate: Mapped[bool] = mapped_column(Boolean, default=False)
    freq_rank: Mapped[int] = mapped_column(Integer, default=999_999, index=True)

    knowledge: Mapped["Knowledge"] = relationship(
        back_populates="lemma", uselist=False, cascade="all, delete-orphan"
    )


class Knowledge(Base):
    __tablename__ = "knowledge"

    id: Mapped[int] = mapped_column(primary_key=True)
    lemma_id: Mapped[int] = mapped_column(ForeignKey("lemma.id"), unique=True, index=True)
    state: Mapped[str] = mapped_column(String, default="new")  # new | learning | known
    card: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    due_ts: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    introduced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    times_seen_reading: Mapped[int] = mapped_column(Integer, default=0)

    lemma: Mapped[Lemma] = relationship(back_populates="knowledge")


class ReviewLogEntry(Base):
    __tablename__ = "review_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    lemma_id: Mapped[int] = mapped_column(ForeignKey("lemma.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime)
    log: Mapped[dict] = mapped_column(JSON)


class Letter(Base):
    __tablename__ = "letter"

    id: Mapped[int] = mapped_column(primary_key=True)
    cyrillic: Mapped[str] = mapped_column(String, unique=True)
    ipa: Mapped[str] = mapped_column(String)
    bucket: Mapped[int] = mapped_column(Integer, index=True)
    friend_type: Mapped[str] = mapped_column(String)  # true | false | new
    latin_lookalike: Mapped[str | None] = mapped_column(String, nullable=True)
    example_word: Mapped[str] = mapped_column(String)
    example_gloss: Mapped[str] = mapped_column(String)

    knowledge: Mapped["LetterKnowledge"] = relationship(
        back_populates="letter", uselist=False, cascade="all, delete-orphan"
    )


class LetterKnowledge(Base):
    __tablename__ = "letter_knowledge"

    id: Mapped[int] = mapped_column(primary_key=True)
    letter_id: Mapped[int] = mapped_column(ForeignKey("letter.id"), unique=True, index=True)
    state: Mapped[str] = mapped_column(String, default="new")
    card: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    due_ts: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)

    letter: Mapped[Letter] = relationship(back_populates="knowledge")


class Setting(Base):
    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
