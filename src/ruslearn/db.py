"""SQLAlchemy wiring: engine, session factory, base, init."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def make_engine(db_path: Path | str) -> Engine:
    """Create a SQLite engine for the given file path (or ':memory:')."""
    return create_engine(f"sqlite:///{db_path}", future=True)


def init_db(engine: Engine) -> None:
    """Create all tables. Importing models registers them on Base.metadata."""
    from ruslearn import models  # noqa: F401  (side-effect: register tables)

    Base.metadata.create_all(engine)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Return a session factory bound to the engine."""
    return sessionmaker(bind=engine, expire_on_commit=False, class_=Session)
