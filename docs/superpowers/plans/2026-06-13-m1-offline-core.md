# M1 — Offline Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fully-offline core of the Russian learning app — a Cyrillic alphabet trainer and a spaced-repetition vocabulary review system, seeded with starter data, served through a FastAPI backend and a dark "Midnight" single-page UI. No LLM, no network.

**Architecture:** Python/FastAPI backend over SQLite (SQLAlchemy 2.0 ORM). A thin `SRSService` wraps the `fsrs` (FSRS-6) library; `LexiconStore` and `AlphabetModule` own vocabulary and letter knowledge respectively; `SeedImporter` loads starter words and the 33-letter curriculum. A vanilla-JS SPA renders Home / Reviews / Alphabet. Reading mode is stubbed ("coming in M2").

**Tech Stack:** Python 3.11+, FastAPI + uvicorn, SQLAlchemy 2.0, `fsrs==6.3.1`, pytest + httpx. Frontend: plain HTML/CSS/JS, no build step.

**Design spec:** [docs/superpowers/specs/2026-06-13-russian-learning-platform-design.md](../specs/2026-06-13-russian-learning-platform-design.md)

---

## File Structure

```
russian-learn/
├── pyproject.toml                 # project metadata, deps, pytest config
├── data/
│   ├── alphabet.json              # 33 Cyrillic letters in 4 learning buckets
│   └── seed_words.csv             # ~45 starter lemmas (essentials + cognates)
├── src/ruslearn/
│   ├── __init__.py
│   ├── __main__.py                # `python -m ruslearn` -> runs uvicorn
│   ├── db.py                      # engine, session factory, Base, init_db
│   ├── models.py                  # ORM: Lemma, Knowledge, ReviewLogEntry, Letter, LetterKnowledge, Setting
│   ├── srs.py                     # SRSService (fsrs wrapper) + ReviewOutcome
│   ├── lexicon.py                 # LexiconStore (vocabulary + knowledge + reviews)
│   ├── alphabet.py                # AlphabetModule (letters + letter knowledge)
│   ├── seed.py                    # SeedImporter (csv words + json letters)
│   ├── api.py                     # create_app() + routes + module-level app
│   └── web/
│       ├── index.html             # Midnight SPA shell
│       ├── style.css              # Midnight theme
│       └── app.js                 # views: home / reviews / alphabet
└── tests/
    ├── conftest.py
    ├── test_srs.py
    ├── test_lexicon.py
    ├── test_alphabet.py
    ├── test_seed.py
    └── test_api.py
```

**Responsibility boundaries**
- `db.py` knows about SQLAlchemy wiring only. `models.py` knows about table shapes only.
- `srs.py` is the *only* file that imports `fsrs`. Everything else passes plain `dict` cards + integer ratings.
- `lexicon.py` / `alphabet.py` are the *only* files that mutate knowledge state. They depend on `srs.py` and `models.py`.
- `api.py` wires services to HTTP; it holds no learning logic.
- Time is always passed in explicitly as a timezone-aware UTC `datetime` (parameter named `now`) so logic is deterministic and testable.

---

## Task 1: Project scaffold

**Files:**
- Create: `pyproject.toml`
- Create: `src/ruslearn/__init__.py` (empty)
- Create: `tests/__init__.py` (empty)
- Modify: `.gitignore`

- [ ] **Step 1: Update `.gitignore`** (append if lines absent)

```
.venv/
__pycache__/
*.pyc
data/russian.db
data/tts/
.pytest_cache/
*.egg-info/
```

- [ ] **Step 2: Create `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "ruslearn"
version = "0.1.0"
description = "Personal Russian learning app — offline core"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.29",
    "sqlalchemy>=2.0",
    "fsrs==6.3.1",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.27"]

[project.scripts]
ruslearn = "ruslearn.__main__:main"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 3: Create empty package files**

Create `src/ruslearn/__init__.py` and `tests/__init__.py`, both empty.

- [ ] **Step 4: Install into the venv**

Run:
```bash
cd /Users/orsymonitz/PycharmProjects/russian-learn
source .venv/bin/activate
pip install -e ".[dev]"
```
Expected: installs fastapi, uvicorn, sqlalchemy, fsrs, pytest, httpx and `ruslearn` (editable).

- [ ] **Step 5: Verify pytest runs (no tests yet)**

Run: `pytest -q`
Expected: `no tests ran` (exit code 5) — confirms config is valid.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml src/ruslearn/__init__.py tests/__init__.py .gitignore
git commit -m "chore: project scaffold (pyproject, package layout, deps)"
```

---

## Task 2: Database layer + ORM models

**Files:**
- Create: `src/ruslearn/db.py`
- Create: `src/ruslearn/models.py`
- Test: `tests/conftest.py`, `tests/test_lexicon.py` (first test only)

- [ ] **Step 1: Create `src/ruslearn/db.py`**

```python
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
```

- [ ] **Step 2: Create `src/ruslearn/models.py`**

```python
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
```

- [ ] **Step 3: Create `tests/conftest.py`**

```python
from datetime import datetime, timezone

import pytest

from ruslearn.db import init_db, make_engine, make_session_factory
from ruslearn.srs import SRSService


@pytest.fixture
def session(tmp_path):
    engine = make_engine(tmp_path / "test.db")
    init_db(engine)
    factory = make_session_factory(engine)
    s = factory()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def srs():
    return SRSService()


@pytest.fixture
def now():
    return datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
```

- [ ] **Step 4: Write the failing schema test** in `tests/test_lexicon.py`

```python
from ruslearn.models import Lemma, Knowledge


def test_can_persist_lemma_with_knowledge(session):
    lemma = Lemma(cyrillic="дом", stressed="дом", gloss_en="house", freq_rank=1)
    lemma.knowledge = Knowledge(state="new")
    session.add(lemma)
    session.commit()

    fetched = session.query(Lemma).filter_by(cyrillic="дом").one()
    assert fetched.gloss_en == "house"
    assert fetched.knowledge.state == "new"
```

- [ ] **Step 5: Run it — expect a collection/import failure first**

Run: `pytest tests/test_lexicon.py -q`
Expected: FAIL — `conftest.py` imports `ruslearn.srs` which doesn't exist yet (`ModuleNotFoundError: ruslearn.srs`).

- [ ] **Step 6: Create a minimal `src/ruslearn/srs.py` so imports resolve**

```python
"""Spaced-repetition service. Placeholder until Task 3 fills it in."""


class SRSService:
    def __init__(self, desired_retention: float = 0.9) -> None:
        self.desired_retention = desired_retention
```

- [ ] **Step 7: Run the test — expect PASS**

Run: `pytest tests/test_lexicon.py -q`
Expected: PASS (1 passed).

- [ ] **Step 8: Commit**

```bash
git add src/ruslearn/db.py src/ruslearn/models.py src/ruslearn/srs.py tests/conftest.py tests/test_lexicon.py
git commit -m "feat: database layer and ORM models"
```

---

## Task 3: SRSService (fsrs wrapper)

**Files:**
- Modify: `src/ruslearn/srs.py`
- Test: `tests/test_srs.py`

- [ ] **Step 1: Write the failing tests** in `tests/test_srs.py`

```python
from datetime import datetime, timezone

from ruslearn.srs import SRSService


def _now():
    return datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def test_new_card_is_json_dict_in_learning_state():
    card = SRSService().new_card()
    assert isinstance(card, dict)
    assert card["state"] == 1  # fsrs State.Learning


def test_review_good_keeps_learning_and_advances_due():
    srs = SRSService()
    out = srs.review(None, rating=3, now=_now())  # Good
    assert out.card["state"] == 1                 # still Learning
    assert out.due > _now()                       # rescheduled into the future
    assert out.log["rating"] == 3


def test_review_easy_graduates_to_known_state():
    srs = SRSService()
    out = srs.review(None, rating=4, now=_now())  # Easy
    assert out.card["state"] == 2                 # fsrs State.Review
    assert SRSService.is_graduated(out.card) is True


def test_review_roundtrips_existing_card():
    srs = SRSService()
    first = srs.review(None, rating=3, now=_now())
    second = srs.review(first.card, rating=3, now=out_later())
    assert second.due > first.due


def out_later():
    return datetime(2026, 1, 2, 12, 0, tzinfo=timezone.utc)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_srs.py -q`
Expected: FAIL — `SRSService` has no `new_card` / `review` / `is_graduated`.

- [ ] **Step 3: Implement `src/ruslearn/srs.py`**

```python
"""Spaced-repetition service. The ONLY module that imports `fsrs`.

Callers pass and receive plain JSON-serializable card dicts and integer
ratings (1=Again, 2=Hard, 3=Good, 4=Easy), so no other module depends on
the fsrs API surface.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from fsrs import Card, Rating, Scheduler

GRADUATED_STATE = 2  # fsrs State.Review


@dataclass
class ReviewOutcome:
    card: dict          # fsrs Card.to_dict() — JSON-serializable
    log: dict           # fsrs ReviewLog.to_dict()
    due: datetime       # timezone-aware UTC


class SRSService:
    def __init__(self, desired_retention: float = 0.9) -> None:
        self.desired_retention = desired_retention
        self.scheduler = Scheduler(desired_retention=desired_retention)

    def new_card(self) -> dict:
        """A fresh, just-introduced card (Learning state, due ~immediately)."""
        return Card().to_dict()

    def review(self, card: dict | None, rating: int, now: datetime | None = None) -> ReviewOutcome:
        """Apply a rating. `card` is None for a never-reviewed word."""
        fsrs_card = Card.from_dict(card) if card else Card()
        new_card, log = self.scheduler.review_card(
            fsrs_card, Rating(rating), review_datetime=now
        )
        return ReviewOutcome(card=new_card.to_dict(), log=log.to_dict(), due=new_card.due)

    @staticmethod
    def is_graduated(card: dict) -> bool:
        """True once the card has left the learning steps (counts as 'known')."""
        return card.get("state") == GRADUATED_STATE
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_srs.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/ruslearn/srs.py tests/test_srs.py
git commit -m "feat: SRSService wrapping fsrs (FSRS-6)"
```

---

## Task 4: LexiconStore

**Files:**
- Create: `src/ruslearn/lexicon.py`
- Modify: `tests/test_lexicon.py` (append tests)

- [ ] **Step 1: Append failing tests** to `tests/test_lexicon.py`

```python
from datetime import timedelta

from ruslearn.lexicon import LexiconStore


def _store(session, srs):
    return LexiconStore(session, srs)


def _seed_three(store):
    store.add_lemma(cyrillic="я", stressed="я", gloss_en="I", freq_rank=1)
    store.add_lemma(cyrillic="дом", stressed="дом", gloss_en="house", freq_rank=2)
    store.add_lemma(cyrillic="кот", stressed="кот", gloss_en="cat", freq_rank=3)


def test_add_lemma_creates_new_knowledge(session, srs):
    store = _store(session, srs)
    store.add_lemma(cyrillic="дом", stressed="дом", gloss_en="house", freq_rank=2)
    counts = store.counts(now=_now())
    assert counts["new"] == 1
    assert counts["learning"] == 0
    assert counts["due"] == 0


def test_introduce_next_picks_lowest_freq_rank_and_makes_due(session, srs, now):
    store = _store(session, srs)
    _seed_three(store)
    introduced = store.introduce_next(now=now, count=2)
    assert [l.cyrillic for l in introduced] == ["я", "дом"]  # by freq_rank
    due = store.get_due(now=now, limit=10)
    assert {k.lemma.cyrillic for k in due} == {"я", "дом"}


def test_record_review_good_keeps_learning(session, srs, now):
    store = _store(session, srs)
    _seed_three(store)
    (lemma,) = store.introduce_next(now=now, count=1)
    k = store.record_review(lemma.id, rating=3, now=now)
    assert k.state == "learning"
    # no longer due at `now` (rescheduled into the future)
    assert store.get_due(now=now, limit=10) == []


def test_record_review_easy_marks_known_and_logs(session, srs, now):
    store = _store(session, srs)
    _seed_three(store)
    (lemma,) = store.introduce_next(now=now, count=1)
    k = store.record_review(lemma.id, rating=4, now=now)
    assert k.state == "known"
    assert store.counts(now=now)["known"] == 1
    from ruslearn.models import ReviewLogEntry
    assert session.query(ReviewLogEntry).count() == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_lexicon.py -q`
Expected: FAIL — `ModuleNotFoundError: ruslearn.lexicon`.

- [ ] **Step 3: Implement `src/ruslearn/lexicon.py`**

```python
"""Vocabulary knowledge: add words, introduce them into SRS, surface due
cards, and record reviews. Owns all transitions of `Knowledge.state`."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ruslearn.models import Knowledge, Lemma, ReviewLogEntry
from ruslearn.srs import SRSService


def _ts(dt: datetime) -> float:
    return dt.timestamp()


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _day_start_naive(dt: datetime) -> datetime:
    u = dt.astimezone(timezone.utc)
    return u.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)


class LexiconStore:
    def __init__(self, session: Session, srs: SRSService) -> None:
        self.session = session
        self.srs = srs

    def add_lemma(
        self,
        *,
        cyrillic: str,
        stressed: str,
        gloss_en: str,
        translit: str = "",
        pos: str | None = None,
        is_cognate: bool = False,
        freq_rank: int = 999_999,
    ) -> Lemma:
        lemma = Lemma(
            cyrillic=cyrillic,
            stressed=stressed,
            gloss_en=gloss_en,
            translit=translit,
            pos=pos,
            is_cognate=is_cognate,
            freq_rank=freq_rank,
        )
        lemma.knowledge = Knowledge(state="new")
        self.session.add(lemma)
        self.session.flush()
        return lemma

    def introduce_next(self, now: datetime, count: int = 1) -> list[Lemma]:
        stmt = (
            select(Lemma)
            .join(Knowledge)
            .where(Knowledge.state == "new")
            .order_by(Lemma.freq_rank)
            .limit(count)
        )
        lemmas = list(self.session.scalars(stmt))
        for lemma in lemmas:
            k = lemma.knowledge
            k.card = self.srs.new_card()
            k.state = "learning"
            k.due_ts = _ts(now)          # due immediately
            k.introduced_at = _naive_utc(now)
        self.session.flush()
        return lemmas

    def get_due(self, now: datetime, limit: int = 20) -> list[Knowledge]:
        stmt = (
            select(Knowledge)
            .where(Knowledge.due_ts.is_not(None), Knowledge.due_ts <= _ts(now))
            .order_by(Knowledge.due_ts)
            .limit(limit)
        )
        return list(self.session.scalars(stmt))

    def record_review(self, lemma_id: int, rating: int, now: datetime) -> Knowledge:
        k = self.session.scalars(
            select(Knowledge).where(Knowledge.lemma_id == lemma_id)
        ).one()
        outcome = self.srs.review(k.card, rating, now)
        k.card = outcome.card
        k.due_ts = outcome.due.timestamp()
        k.state = "known" if SRSService.is_graduated(outcome.card) else "learning"
        self.session.add(
            ReviewLogEntry(
                lemma_id=lemma_id,
                rating=rating,
                reviewed_at=_naive_utc(now),
                log=outcome.log,
            )
        )
        self.session.flush()
        return k

    def counts(self, now: datetime) -> dict[str, int]:
        def n(*conds) -> int:
            stmt = select(func.count()).select_from(Knowledge)
            for c in conds:
                stmt = stmt.where(c)
            return int(self.session.scalar(stmt) or 0)

        return {
            "new": n(Knowledge.state == "new"),
            "learning": n(Knowledge.state == "learning"),
            "known": n(Knowledge.state == "known"),
            "due": n(Knowledge.due_ts.is_not(None), Knowledge.due_ts <= _ts(now)),
            "new_today": n(
                Knowledge.introduced_at.is_not(None),
                Knowledge.introduced_at >= _day_start_naive(now),
            ),
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_lexicon.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/ruslearn/lexicon.py tests/test_lexicon.py
git commit -m "feat: LexiconStore — vocab knowledge, introduction, reviews"
```

---

## Task 5: Alphabet data + AlphabetModule

**Files:**
- Create: `data/alphabet.json`
- Create: `src/ruslearn/alphabet.py`
- Test: `tests/test_alphabet.py`

- [ ] **Step 1: Create `data/alphabet.json`** (all 33 letters, four buckets)

```json
[
  {"cyrillic": "А", "ipa": "a", "bucket": 1, "friend_type": "true", "latin_lookalike": "A", "example_word": "там", "example_gloss": "there"},
  {"cyrillic": "К", "ipa": "k", "bucket": 1, "friend_type": "true", "latin_lookalike": "K", "example_word": "как", "example_gloss": "how"},
  {"cyrillic": "М", "ipa": "m", "bucket": 1, "friend_type": "true", "latin_lookalike": "M", "example_word": "мама", "example_gloss": "mom"},
  {"cyrillic": "О", "ipa": "o", "bucket": 1, "friend_type": "true", "latin_lookalike": "O", "example_word": "кот", "example_gloss": "cat"},
  {"cyrillic": "Т", "ipa": "t", "bucket": 1, "friend_type": "true", "latin_lookalike": "T", "example_word": "том", "example_gloss": "volume"},
  {"cyrillic": "В", "ipa": "v", "bucket": 2, "friend_type": "false", "latin_lookalike": "B", "example_word": "вот", "example_gloss": "here is"},
  {"cyrillic": "Н", "ipa": "n", "bucket": 2, "friend_type": "false", "latin_lookalike": "H", "example_word": "он", "example_gloss": "he"},
  {"cyrillic": "Р", "ipa": "r", "bucket": 2, "friend_type": "false", "latin_lookalike": "P", "example_word": "рот", "example_gloss": "mouth"},
  {"cyrillic": "С", "ipa": "s", "bucket": 2, "friend_type": "false", "latin_lookalike": "C", "example_word": "сок", "example_gloss": "juice"},
  {"cyrillic": "У", "ipa": "u", "bucket": 2, "friend_type": "false", "latin_lookalike": "Y", "example_word": "ум", "example_gloss": "mind"},
  {"cyrillic": "Х", "ipa": "kh", "bucket": 2, "friend_type": "false", "latin_lookalike": "X", "example_word": "хор", "example_gloss": "choir"},
  {"cyrillic": "Е", "ipa": "ye", "bucket": 2, "friend_type": "false", "latin_lookalike": "E", "example_word": "нет", "example_gloss": "no"},
  {"cyrillic": "Б", "ipa": "b", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "брат", "example_gloss": "brother"},
  {"cyrillic": "Г", "ipa": "g", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "год", "example_gloss": "year"},
  {"cyrillic": "Д", "ipa": "d", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "дом", "example_gloss": "house"},
  {"cyrillic": "З", "ipa": "z", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "зонт", "example_gloss": "umbrella"},
  {"cyrillic": "И", "ipa": "i", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "мир", "example_gloss": "world"},
  {"cyrillic": "Й", "ipa": "y", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "мой", "example_gloss": "my"},
  {"cyrillic": "Л", "ipa": "l", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "лес", "example_gloss": "forest"},
  {"cyrillic": "П", "ipa": "p", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "парк", "example_gloss": "park"},
  {"cyrillic": "Ф", "ipa": "f", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "флаг", "example_gloss": "flag"},
  {"cyrillic": "Э", "ipa": "e", "bucket": 3, "friend_type": "new", "latin_lookalike": null, "example_word": "это", "example_gloss": "this"},
  {"cyrillic": "Ж", "ipa": "zh", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "жук", "example_gloss": "beetle"},
  {"cyrillic": "Ц", "ipa": "ts", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "цирк", "example_gloss": "circus"},
  {"cyrillic": "Ч", "ipa": "ch", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "час", "example_gloss": "hour"},
  {"cyrillic": "Ш", "ipa": "sh", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "шар", "example_gloss": "balloon"},
  {"cyrillic": "Щ", "ipa": "shch", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "щи", "example_gloss": "cabbage soup"},
  {"cyrillic": "Ы", "ipa": "y (hard i)", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "сын", "example_gloss": "son"},
  {"cyrillic": "Ё", "ipa": "yo", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "ёж", "example_gloss": "hedgehog"},
  {"cyrillic": "Ю", "ipa": "yu", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "юг", "example_gloss": "south"},
  {"cyrillic": "Я", "ipa": "ya", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "я", "example_gloss": "I"},
  {"cyrillic": "Ъ", "ipa": "(hard sign — silent)", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "съел", "example_gloss": "ate"},
  {"cyrillic": "Ь", "ipa": "(soft sign — softens)", "bucket": 4, "friend_type": "new", "latin_lookalike": null, "example_word": "соль", "example_gloss": "salt"}
]
```

- [ ] **Step 2: Write failing tests** in `tests/test_alphabet.py`

```python
import json
from pathlib import Path

from ruslearn.alphabet import AlphabetModule

DATA = Path(__file__).resolve().parents[1] / "data" / "alphabet.json"


def _letters():
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_seed_letters_inserts_all_33(session, srs):
    mod = AlphabetModule(session, srs)
    mod.seed_letters(_letters())
    assert mod.overview()["total"] == 33


def test_seed_is_idempotent(session, srs):
    mod = AlphabetModule(session, srs)
    mod.seed_letters(_letters())
    mod.seed_letters(_letters())
    assert mod.overview()["total"] == 33


def test_introduce_next_follows_bucket_order(session, srs, now):
    mod = AlphabetModule(session, srs)
    mod.seed_letters(_letters())
    intro = mod.introduce_next(now=now, count=5)
    assert [l.cyrillic for l in intro] == ["А", "К", "М", "О", "Т"]  # bucket 1


def test_record_answer_updates_state(session, srs, now):
    mod = AlphabetModule(session, srs)
    mod.seed_letters(_letters())
    (letter,) = mod.introduce_next(now=now, count=1)
    lk = mod.record_answer(letter.id, rating=4, now=now)  # Easy
    assert lk.state == "known"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_alphabet.py -q`
Expected: FAIL — `ModuleNotFoundError: ruslearn.alphabet`.

- [ ] **Step 4: Implement `src/ruslearn/alphabet.py`**

```python
"""Cyrillic alphabet trainer: seed the 33-letter curriculum and schedule
letter recognition with the same SRS engine used for vocabulary."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ruslearn.models import Letter, LetterKnowledge
from ruslearn.srs import SRSService


def _ts(dt: datetime) -> float:
    return dt.timestamp()


class AlphabetModule:
    def __init__(self, session: Session, srs: SRSService) -> None:
        self.session = session
        self.srs = srs

    def seed_letters(self, letters: list[dict]) -> int:
        """Insert any letters not already present. Returns number inserted."""
        existing = set(self.session.scalars(select(Letter.cyrillic)))
        added = 0
        for row in letters:
            if row["cyrillic"] in existing:
                continue
            letter = Letter(
                cyrillic=row["cyrillic"],
                ipa=row["ipa"],
                bucket=row["bucket"],
                friend_type=row["friend_type"],
                latin_lookalike=row.get("latin_lookalike"),
                example_word=row["example_word"],
                example_gloss=row["example_gloss"],
            )
            letter.knowledge = LetterKnowledge(state="new")
            self.session.add(letter)
            added += 1
        self.session.flush()
        return added

    def introduce_next(self, now: datetime, count: int = 1) -> list[Letter]:
        stmt = (
            select(Letter)
            .join(LetterKnowledge)
            .where(LetterKnowledge.state == "new")
            .order_by(Letter.bucket, Letter.id)
            .limit(count)
        )
        letters = list(self.session.scalars(stmt))
        for letter in letters:
            k = letter.knowledge
            k.card = self.srs.new_card()
            k.state = "learning"
            k.due_ts = _ts(now)
        self.session.flush()
        return letters

    def get_due(self, now: datetime, limit: int = 20) -> list[LetterKnowledge]:
        stmt = (
            select(LetterKnowledge)
            .where(LetterKnowledge.due_ts.is_not(None), LetterKnowledge.due_ts <= _ts(now))
            .order_by(LetterKnowledge.due_ts)
            .limit(limit)
        )
        return list(self.session.scalars(stmt))

    def record_answer(self, letter_id: int, rating: int, now: datetime) -> LetterKnowledge:
        lk = self.session.scalars(
            select(LetterKnowledge).where(LetterKnowledge.letter_id == letter_id)
        ).one()
        outcome = self.srs.review(lk.card, rating, now)
        lk.card = outcome.card
        lk.due_ts = outcome.due.timestamp()
        lk.state = "known" if SRSService.is_graduated(outcome.card) else "learning"
        self.session.flush()
        return lk

    def overview(self) -> dict[str, int]:
        total = int(self.session.scalar(select(func.count()).select_from(Letter)) or 0)
        known = int(
            self.session.scalar(
                select(func.count())
                .select_from(LetterKnowledge)
                .where(LetterKnowledge.state == "known")
            )
            or 0
        )
        return {"total": total, "known": known}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_alphabet.py -q`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add data/alphabet.json src/ruslearn/alphabet.py tests/test_alphabet.py
git commit -m "feat: Cyrillic alphabet curriculum + AlphabetModule"
```

---

## Task 6: Seed words data + SeedImporter

**Files:**
- Create: `data/seed_words.csv`
- Create: `src/ruslearn/seed.py`
- Test: `tests/test_seed.py`

- [ ] **Step 1: Create `data/seed_words.csv`** (header + 45 rows)

```
cyrillic,stressed,translit,gloss_en,pos,is_cognate,freq_rank
я,я,ya,I,pron,false,1
ты,ты,ty,you,pron,false,2
не,не,ne,not,part,false,3
это,э́то,eto,this / it is,pron,false,4
и,и,i,and,conj,false,5
да,да,da,yes,part,false,6
нет,нет,net,no,part,false,7
он,он,on,he,pron,false,8
она,она́,ona,she,pron,false,9
мы,мы,my,we,pron,false,10
хорошо,хорошо́,khorosho,good / well,adv,false,11
спасибо,спаси́бо,spasibo,thank you,part,false,12
привет,приве́т,privet,hi,interj,false,13
пока,пока́,poka,bye,interj,false,14
дом,дом,dom,house,noun,false,15
друг,друг,drug,friend,noun,false,16
город,го́род,gorod,city,noun,false,17
вода,вода́,voda,water,noun,false,18
книга,кни́га,kniga,book,noun,false,19
мама,ма́ма,mama,mom,noun,false,20
папа,па́па,papa,dad,noun,false,21
кот,кот,kot,cat,noun,false,22
собака,соба́ка,sobaka,dog,noun,false,23
стол,стол,stol,table,noun,false,24
окно,окно́,okno,window,noun,false,25
хлеб,хлеб,khleb,bread,noun,false,26
знать,знать,znat,to know,verb,false,27
хотеть,хоте́ть,khotet,to want,verb,false,28
говорить,говори́ть,govorit,to speak,verb,false,29
кофе,ко́фе,kofe,coffee,noun,true,30
такси,такси́,taksi,taxi,noun,true,31
телефон,телефо́н,telefon,telephone,noun,true,32
ресторан,рестора́н,restoran,restaurant,noun,true,33
компьютер,компью́тер,kompyuter,computer,noun,true,34
интернет,интерне́т,internet,internet,noun,true,35
музыка,му́зыка,muzyka,music,noun,true,36
парк,парк,park,park,noun,true,37
банк,банк,bank,bank,noun,true,38
спорт,спорт,sport,sport,noun,true,39
доктор,до́ктор,doktor,doctor,noun,true,40
студент,студе́нт,student,student,noun,true,41
театр,теа́тр,teatr,theater,noun,true,42
музей,музе́й,muzey,museum,noun,true,43
проблема,пробле́ма,problema,problem,noun,true,44
идея,иде́я,ideya,idea,noun,true,45
```

- [ ] **Step 2: Write failing tests** in `tests/test_seed.py`

```python
from pathlib import Path

from ruslearn.lexicon import LexiconStore
from ruslearn.seed import SeedImporter

CSV = Path(__file__).resolve().parents[1] / "data" / "seed_words.csv"


def _count_new(session, srs, now):
    return LexiconStore(session, srs).counts(now)["new"]


def test_import_words_loads_all_rows(session, srs, now):
    added = SeedImporter(session, srs).import_words(CSV)
    assert added == 45
    assert _count_new(session, srs, now) == 45


def test_import_words_is_idempotent(session, srs, now):
    importer = SeedImporter(session, srs)
    importer.import_words(CSV)
    added_again = importer.import_words(CSV)
    assert added_again == 0
    assert _count_new(session, srs, now) == 45


def test_cognate_flag_is_parsed(session, srs):
    SeedImporter(session, srs).import_words(CSV)
    from ruslearn.models import Lemma
    kofe = session.query(Lemma).filter_by(cyrillic="кофе").one()
    assert kofe.is_cognate is True
    ya = session.query(Lemma).filter_by(cyrillic="я").one()
    assert ya.is_cognate is False
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_seed.py -q`
Expected: FAIL — `ModuleNotFoundError: ruslearn.seed`.

- [ ] **Step 4: Implement `src/ruslearn/seed.py`**

```python
"""Load starter data into the lexicon (words from CSV)."""
from __future__ import annotations

import csv
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ruslearn.lexicon import LexiconStore
from ruslearn.models import Lemma
from ruslearn.srs import SRSService


class SeedImporter:
    def __init__(self, session: Session, srs: SRSService) -> None:
        self.session = session
        self.store = LexiconStore(session, srs)

    def import_words(self, csv_path: Path | str) -> int:
        """Insert lemmas that don't already exist. Returns number added."""
        existing = set(self.session.scalars(select(Lemma.cyrillic)))
        added = 0
        with open(csv_path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                if row["cyrillic"] in existing:
                    continue
                self.store.add_lemma(
                    cyrillic=row["cyrillic"],
                    stressed=row["stressed"],
                    translit=row["translit"],
                    gloss_en=row["gloss_en"],
                    pos=row["pos"] or None,
                    is_cognate=row["is_cognate"].strip().lower() == "true",
                    freq_rank=int(row["freq_rank"]),
                )
                existing.add(row["cyrillic"])
                added += 1
        return added
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_seed.py -q`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add data/seed_words.csv src/ruslearn/seed.py tests/test_seed.py
git commit -m "feat: starter word list + SeedImporter"
```

---

## Task 7: FastAPI application

**Files:**
- Create: `src/ruslearn/api.py`
- Create: `src/ruslearn/__main__.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write failing tests** in `tests/test_api.py`

```python
from fastapi.testclient import TestClient

from ruslearn.api import create_app


def _client(tmp_path):
    app = create_app(db_path=tmp_path / "api.db")
    return TestClient(app)


def test_state_endpoint_reports_seeded_counts(tmp_path):
    client = _client(tmp_path)
    r = client.get("/api/state")
    assert r.status_code == 200
    body = r.json()
    assert body["vocab"]["new"] == 45            # seeded words
    assert body["alphabet"]["total"] == 33       # seeded letters


def test_introduce_then_review_vocab_flow(tmp_path):
    client = _client(tmp_path)
    intro = client.post("/api/vocab/introduce", json={"count": 1}).json()
    assert len(intro["introduced"]) == 1
    lemma_id = intro["introduced"][0]["id"]

    due = client.get("/api/vocab/due").json()
    assert any(card["id"] == lemma_id for card in due["cards"])

    r = client.post(f"/api/vocab/{lemma_id}/review", json={"rating": 4})  # Easy
    assert r.status_code == 200
    assert r.json()["state"] == "known"


def test_alphabet_due_and_answer_flow(tmp_path):
    client = _client(tmp_path)
    client.post("/api/alphabet/introduce", json={"count": 1})
    due = client.get("/api/alphabet/due").json()
    assert len(due["cards"]) >= 1
    letter_id = due["cards"][0]["id"]
    r = client.post(f"/api/alphabet/{letter_id}/answer", json={"rating": 3})
    assert r.status_code == 200
    assert r.json()["state"] in {"learning", "known"}


def test_root_serves_html(tmp_path):
    client = _client(tmp_path)
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api.py -q`
Expected: FAIL — `ModuleNotFoundError: ruslearn.api`.

- [ ] **Step 3: Implement `src/ruslearn/api.py`**

```python
"""FastAPI app: wires SRS / lexicon / alphabet services to HTTP and serves
the static SPA. Contains no learning logic itself."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ruslearn.alphabet import AlphabetModule
from ruslearn.db import init_db, make_engine, make_session_factory
from ruslearn.lexicon import LexiconStore
from ruslearn.seed import SeedImporter
from ruslearn.srs import SRSService

ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = Path(__file__).resolve().parent / "web"
DATA_DIR = ROOT / "data"
DEFAULT_DB = DATA_DIR / "russian.db"


class CountBody(BaseModel):
    count: int = 5


class RatingBody(BaseModel):
    rating: int


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_app(db_path: Path | str = DEFAULT_DB) -> FastAPI:
    engine = make_engine(db_path)
    init_db(engine)
    factory = make_session_factory(engine)
    srs = SRSService()

    # One-time idempotent seeding.
    with factory() as s:
        SeedImporter(s, srs).import_words(DATA_DIR / "seed_words.csv")
        import json

        letters = json.loads((DATA_DIR / "alphabet.json").read_text(encoding="utf-8"))
        AlphabetModule(s, srs).seed_letters(letters)
        s.commit()

    app = FastAPI(title="ruslearn")

    def session() -> Session:
        return factory()

    @app.get("/api/state")
    def state() -> dict:
        with session() as s:
            return {
                "vocab": LexiconStore(s, srs).counts(_now()),
                "alphabet": AlphabetModule(s, srs).overview(),
            }

    @app.post("/api/vocab/introduce")
    def vocab_introduce(body: CountBody) -> dict:
        with session() as s:
            store = LexiconStore(s, srs)
            lemmas = store.introduce_next(_now(), count=body.count)
            s.commit()
            return {
                "introduced": [
                    {"id": l.id, "cyrillic": l.cyrillic, "stressed": l.stressed,
                     "gloss_en": l.gloss_en, "translit": l.translit}
                    for l in lemmas
                ]
            }

    @app.get("/api/vocab/due")
    def vocab_due(limit: int = 20) -> dict:
        with session() as s:
            due = LexiconStore(s, srs).get_due(_now(), limit=limit)
            return {
                "cards": [
                    {"id": k.lemma.id, "cyrillic": k.lemma.cyrillic,
                     "stressed": k.lemma.stressed, "gloss_en": k.lemma.gloss_en,
                     "translit": k.lemma.translit, "is_cognate": k.lemma.is_cognate}
                    for k in due
                ]
            }

    @app.post("/api/vocab/{lemma_id}/review")
    def vocab_review(lemma_id: int, body: RatingBody) -> dict:
        with session() as s:
            k = LexiconStore(s, srs).record_review(lemma_id, body.rating, _now())
            s.commit()
            return {"lemma_id": lemma_id, "state": k.state}

    @app.post("/api/alphabet/introduce")
    def alpha_introduce(body: CountBody) -> dict:
        with session() as s:
            mod = AlphabetModule(s, srs)
            letters = mod.introduce_next(_now(), count=body.count)
            s.commit()
            return {"introduced": [{"id": l.id, "cyrillic": l.cyrillic} for l in letters]}

    @app.get("/api/alphabet/due")
    def alpha_due(limit: int = 20) -> dict:
        with session() as s:
            due = AlphabetModule(s, srs).get_due(_now(), limit=limit)
            return {
                "cards": [
                    {"id": lk.letter.id, "cyrillic": lk.letter.cyrillic,
                     "ipa": lk.letter.ipa, "friend_type": lk.letter.friend_type,
                     "latin_lookalike": lk.letter.latin_lookalike,
                     "example_word": lk.letter.example_word,
                     "example_gloss": lk.letter.example_gloss}
                    for lk in due
                ]
            }

    @app.post("/api/alphabet/{letter_id}/answer")
    def alpha_answer(letter_id: int, body: RatingBody) -> dict:
        with session() as s:
            lk = AlphabetModule(s, srs).record_answer(letter_id, body.rating, _now())
            s.commit()
            return {"letter_id": letter_id, "state": lk.state}

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")
    return app


app = create_app()
```

- [ ] **Step 4: Create `src/ruslearn/__main__.py`**

```python
"""Entry point: `python -m ruslearn` launches the local server."""
from __future__ import annotations

import uvicorn


def main() -> None:
    uvicorn.run("ruslearn.api:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Create a placeholder `src/ruslearn/web/index.html`** so the static mount and `/` route resolve during this task's tests (replaced fully in Task 8)

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ruslearn</title></head>
<body><p>ruslearn — UI loads in Task 8.</p></body></html>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_api.py -q`
Expected: PASS (4 passed).

- [ ] **Step 7: Run the whole suite**

Run: `pytest -q`
Expected: all tests pass (test_srs 4, test_lexicon 5, test_alphabet 4, test_seed 3, test_api 4).

- [ ] **Step 8: Commit**

```bash
git add src/ruslearn/api.py src/ruslearn/__main__.py src/ruslearn/web/index.html tests/test_api.py
git commit -m "feat: FastAPI app — vocab + alphabet endpoints, static serving"
```

---

## Task 8: Midnight SPA (Home / Reviews / Alphabet)

**Files:**
- Modify (replace): `src/ruslearn/web/index.html`
- Create: `src/ruslearn/web/style.css`
- Create: `src/ruslearn/web/app.js`

> The UI is verified by running the app and observing behavior (Step 5), not by unit tests — keep DOM logic thin and lean on the already-tested API.

- [ ] **Step 1: Replace `src/ruslearn/web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ruslearn — Russian</title>
  <link rel="stylesheet" href="/static/style.css" />
</head>
<body>
  <div id="app">
    <header class="topbar">
      <button class="back" id="back" hidden>‹</button>
      <div class="title" id="title">READING&nbsp;·&nbsp;RUSSIAN</div>
      <div class="spacer"></div>
    </header>

    <!-- HOME -->
    <section class="view" id="view-home">
      <h1 class="hello">Привет!</h1>
      <p class="sub" id="day">Russian · offline core</p>
      <div class="stats">
        <div class="stat"><b id="s-known">0</b><span>known</span></div>
        <div class="stat"><b id="s-due">0</b><span>due</span></div>
        <div class="stat"><b id="s-new">0</b><span>new today</span></div>
      </div>
      <button class="mode" data-go="alphabet">
        <span class="ic">Аа</span>
        <span class="m-txt"><b>Alphabet</b><i>Learn to read Cyrillic</i></span>
        <span class="badge" id="b-alpha">0 / 33</span>
      </button>
      <button class="mode primary" data-go="reviews">
        <span class="ic">⟳</span>
        <span class="m-txt"><b>Reviews</b><i>Words due right now</i></span>
        <span class="badge" id="b-rev">0 due</span>
      </button>
      <button class="mode" data-go="reading" disabled>
        <span class="ic">¶</span>
        <span class="m-txt"><b>Reading</b><i>Generated passages</i></span>
        <span class="badge soon">soon</span>
      </button>
    </section>

    <!-- REVIEWS -->
    <section class="view" id="view-reviews" hidden>
      <div class="card-stage" id="rev-stage"></div>
    </section>

    <!-- ALPHABET -->
    <section class="view" id="view-alphabet" hidden>
      <div class="card-stage" id="alpha-stage"></div>
    </section>
  </div>

  <div class="toast" id="toast" hidden></div>
  <script src="/static/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/ruslearn/web/style.css`** (Midnight theme)

```css
:root {
  --bg0:#0c0e14; --bg1:#11141c; --bg2:#1b2030;
  --ink:#e7ebf3; --muted:#7d88a3; --line:rgba(255,255,255,.10);
  --glass:rgba(255,255,255,.05); --indigo:#6e7bf2; --amber:#f5b547;
}
* { box-sizing:border-box; }
body {
  margin:0; min-height:100vh; color:var(--ink);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  background:radial-gradient(130% 120% at 100% 0%, var(--bg2) 0%, var(--bg1) 55%, var(--bg0) 100%);
}
#app { max-width:430px; margin:0 auto; padding:14px 20px 40px; }
.topbar { display:flex; align-items:center; height:48px; }
.topbar .title { font-size:11px; letter-spacing:.22em; color:var(--muted); font-weight:600; }
.topbar .back { background:var(--glass); border:1px solid var(--line); color:var(--ink);
  width:34px; height:34px; border-radius:50%; font-size:20px; cursor:pointer; margin-right:12px; }
.spacer { flex:1; }

.hello { font-size:34px; margin:18px 0 2px; }
.sub { color:var(--muted); margin:0 0 22px; }
.stats { display:flex; gap:12px; margin-bottom:22px; }
.stat { flex:1; background:var(--glass); border:1px solid var(--line); border-radius:16px;
  padding:14px 0; text-align:center; }
.stat b { display:block; font-size:24px; }
.stat span { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }

.mode { display:flex; align-items:center; gap:14px; width:100%; text-align:left;
  background:var(--glass); border:1px solid var(--line); color:var(--ink);
  border-radius:18px; padding:16px; margin:12px 0; cursor:pointer; }
.mode.primary { background:rgba(110,123,242,.16); border-color:rgba(110,123,242,.5); }
.mode[disabled] { opacity:.5; cursor:default; }
.mode .ic { font-size:22px; width:30px; text-align:center; }
.mode .m-txt { display:flex; flex-direction:column; }
.mode .m-txt b { font-size:15px; }
.mode .m-txt i { font-style:normal; font-size:12px; color:var(--muted); }
.mode .badge { margin-left:auto; font-size:12px; font-weight:600; padding:4px 10px;
  border-radius:999px; background:rgba(255,255,255,.10); }
.mode.primary .badge { background:var(--indigo); }
.mode .badge.soon { background:rgba(245,181,71,.18); color:var(--amber); }

.card-stage { padding-top:8px; }
.qcard { background:var(--glass); border:1px solid var(--line); border-radius:24px;
  padding:36px 24px; text-align:center; box-shadow:0 20px 50px -24px #000;
  backdrop-filter:blur(14px); }
.qcard .big { font-size:64px; line-height:1.1; margin:6px 0 14px; }
.qcard .hint { color:var(--muted); font-size:13px; }
.qcard .answer { margin-top:18px; }
.qcard .answer .gloss { font-size:22px; }
.qcard .answer .ipa, .qcard .answer .translit { color:var(--amber); margin-top:6px; }
.qcard .contrast { color:var(--muted); font-size:13px; margin-top:10px; }

.btn-row { display:flex; gap:10px; margin-top:22px; }
.btn { flex:1; padding:13px 0; border-radius:14px; font-size:14px; font-weight:600;
  border:1px solid var(--line); background:var(--glass); color:var(--ink); cursor:pointer; }
.btn.reveal { background:var(--indigo); border-color:transparent; }
.r-again { background:rgba(229,90,90,.18); border-color:rgba(229,90,90,.4); }
.r-hard  { background:rgba(245,181,71,.16); border-color:rgba(245,181,71,.4); }
.r-good  { background:rgba(110,123,242,.20); border-color:rgba(110,123,242,.5); }
.r-easy  { background:rgba(125,211,168,.18); border-color:rgba(125,211,168,.45); }

.empty { text-align:center; color:var(--muted); padding:60px 0; }
.empty .add { margin-top:16px; }

.toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%);
  background:#1b2030; border:1px solid var(--line); color:var(--ink);
  padding:11px 18px; border-radius:12px; font-size:14px; box-shadow:0 10px 30px -10px #000; }
```

- [ ] **Step 3: Create `src/ruslearn/web/app.js`**

```javascript
const $ = (sel) => document.querySelector(sel);

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 1800);
}

const RATINGS = [
  { r: 1, label: "Again", cls: "r-again" },
  { r: 2, label: "Hard", cls: "r-hard" },
  { r: 3, label: "Good", cls: "r-good" },
  { r: 4, label: "Easy", cls: "r-easy" },
];

function show(view) {
  for (const id of ["home", "reviews", "alphabet"]) {
    $(`#view-${id}`).hidden = id !== view;
  }
  $("#back").hidden = view === "home";
  $("#title").textContent =
    view === "home" ? "READING · RUSSIAN" : view.toUpperCase();
  if (view === "home") refreshHome();
  if (view === "reviews") loadReviews();
  if (view === "alphabet") loadAlphabet();
}

async function refreshHome() {
  const s = await api("/api/state");
  $("#s-known").textContent = s.vocab.known;
  $("#s-due").textContent = s.vocab.due;
  $("#s-new").textContent = s.vocab.new_today;
  $("#b-rev").textContent = `${s.vocab.due} due`;
  $("#b-alpha").textContent = `${s.alphabet.known} / ${s.alphabet.total}`;
}

// ---- Reviews ----
async function loadReviews() {
  let due = (await api("/api/vocab/due")).cards;
  if (due.length === 0) {
    const intro = await api("/api/vocab/introduce", {
      method: "POST",
      body: JSON.stringify({ count: 5 }),
    });
    if (intro.introduced.length === 0) {
      $("#rev-stage").innerHTML = `<div class="empty">All caught up — nothing due.</div>`;
      return;
    }
    due = (await api("/api/vocab/due")).cards;
  }
  renderVocabCard(due[0]);
}

function renderVocabCard(card) {
  const stage = $("#rev-stage");
  stage.innerHTML = `
    <div class="qcard">
      <div class="big">${card.stressed}</div>
      <div class="hint">What does it mean?</div>
      <div class="answer" hidden>
        <div class="gloss">${card.gloss_en}</div>
        <div class="translit">${card.translit || ""}</div>
      </div>
    </div>
    <div class="btn-row" id="rev-actions">
      <button class="btn reveal" id="reveal">Show answer</button>
    </div>`;
  $("#reveal").onclick = () => {
    stage.querySelector(".answer").hidden = false;
    const row = $("#rev-actions");
    row.innerHTML = RATINGS.map(
      (x) => `<button class="btn ${x.cls}" data-r="${x.r}">${x.label}</button>`
    ).join("");
    row.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        await api(`/api/vocab/${card.id}/review`, {
          method: "POST",
          body: JSON.stringify({ rating: Number(b.dataset.r) }),
        });
        loadReviews();
      };
    });
  };
}

// ---- Alphabet ----
async function loadAlphabet() {
  let due = (await api("/api/alphabet/due")).cards;
  if (due.length === 0) {
    const intro = await api("/api/alphabet/introduce", {
      method: "POST",
      body: JSON.stringify({ count: 5 }),
    });
    if (intro.introduced.length === 0) {
      $("#alpha-stage").innerHTML = `<div class="empty">Alphabet complete! 🎉</div>`;
      return;
    }
    due = (await api("/api/alphabet/due")).cards;
  }
  renderLetterCard(due[0]);
}

function renderLetterCard(card) {
  const stage = $("#alpha-stage");
  const contrast =
    card.friend_type === "false" && card.latin_lookalike
      ? `<div class="contrast">Looks like Latin "${card.latin_lookalike}" — but it's not.</div>`
      : "";
  stage.innerHTML = `
    <div class="qcard">
      <div class="big">${card.cyrillic}</div>
      <div class="hint">How is it pronounced?</div>
      ${contrast}
      <div class="answer" hidden>
        <div class="ipa">sounds like “${card.ipa}”</div>
        <div class="gloss">${card.example_word} — ${card.example_gloss}</div>
      </div>
    </div>
    <div class="btn-row" id="alpha-actions">
      <button class="btn reveal" id="a-reveal">Show sound</button>
    </div>`;
  $("#a-reveal").onclick = () => {
    stage.querySelector(".answer").hidden = false;
    const row = $("#alpha-actions");
    row.innerHTML = RATINGS.map(
      (x) => `<button class="btn ${x.cls}" data-r="${x.r}">${x.label}</button>`
    ).join("");
    row.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        await api(`/api/alphabet/${card.id}/answer`, {
          method: "POST",
          body: JSON.stringify({ rating: Number(b.dataset.r) }),
        });
        loadAlphabet();
      };
    });
  };
}

// ---- wiring ----
document.querySelectorAll(".mode[data-go]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const go = btn.dataset.go;
    if (go === "reading") return toast("Reading mode arrives in M2 ✨");
    show(go);
  });
});
$("#back").addEventListener("click", () => show("home"));
show("home");
```

- [ ] **Step 4: Run the full test suite (must stay green)**

Run: `pytest -q`
Expected: all pass (the `/` route now serves the real SPA).

- [ ] **Step 5: Manual smoke test — run the app and observe**

Run:
```bash
cd /Users/orsymonitz/PycharmProjects/russian-learn
source .venv/bin/activate
python -m ruslearn
```
Open `http://127.0.0.1:8000`. Verify:
- Home shows known/due/new stats and three mode buttons (Reading disabled, "soon").
- **Alphabet** → shows a Cyrillic letter → "Show sound" reveals the pronunciation + example; the false-friend contrast note appears for letters like В/Н/Р; rating advances to the next letter.
- **Reviews** → shows a stressed word → "Show answer" reveals the English gloss; Again/Hard/Good/Easy advance; returning Home updates counts.
- **Reading** → tapping shows the "arrives in M2" toast.

Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add src/ruslearn/web/index.html src/ruslearn/web/style.css src/ruslearn/web/app.js
git commit -m "feat: Midnight SPA — home, reviews, alphabet trainer"
```

---

## Task 9: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

````markdown
# ruslearn — Personal Russian Learning App

A local, single-user app for learning Russian from zero. **M1 (this milestone):**
an offline Cyrillic alphabet trainer and a spaced-repetition vocabulary
reviewer, seeded with starter words. No network required.

See the design in [docs/superpowers/specs/2026-06-13-russian-learning-platform-design.md](docs/superpowers/specs/2026-06-13-russian-learning-platform-design.md).

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Run

```bash
python -m ruslearn
# open http://127.0.0.1:8000
```

The SQLite database is created at `data/russian.db` on first run and is
seeded automatically from `data/seed_words.csv` and `data/alphabet.json`.

## Test

```bash
pytest -q
```

## Roadmap

- **M2** — LLM-generated reading at ~98% known-word coverage, edge-tts audio.
- **M3** — stats, settings, stress-weaning, grammar notes, FSRS optimizer.
````

- [ ] **Step 2: Final full-suite run**

Run: `pytest -q`
Expected: all tests pass (20 total: 4 + 5 + 4 + 3 + 4).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, run, and roadmap"
```

---

## Self-Review (completed during planning)

**Spec coverage (M1 scope):**
- Local SQLite, no auth → Tasks 2, 7. ✓
- FSRS via `fsrs` library, never hand-rolled → Task 3. ✓
- Lemma-keyed knowledge with new/learning/known states → Tasks 2, 4. ✓
- `review_log` persisted (for the future FSRS optimizer) → Tasks 2, 4. ✓
- Alphabet trainer with the 4 research-backed buckets + false-friend contrast cards → Tasks 5, 8. ✓
- Frequency-ordered new-word introduction, cognates seeded → Tasks 4, 6. ✓
- Stress marks shown on all vocab (stored in `stressed`) → Tasks 6, 8. ✓
- Midnight UI, Reviews + Alphabet modes, Reading stubbed → Task 8. ✓
- **Deferred to M2/M3 (correctly out of M1 scope):** LLM generation, NLP/lemmatization, TTS audio, settings UI, stats dashboard, stress-weaning, full frequency-list import. The seed list is a small curated starter; the full OpenSubtitles import lands in a later milestone.

**Placeholder scan:** No TBD/TODO. The Task 7 placeholder `index.html` is intentional and explicitly replaced in Task 8.

**Type/name consistency:** `SRSService.review/new_card/is_graduated`, `ReviewOutcome.{card,log,due}`, `LexiconStore.{add_lemma,introduce_next,get_due,record_review,counts}`, `AlphabetModule.{seed_letters,introduce_next,get_due,record_answer,overview}`, `SeedImporter.import_words`, and the `Knowledge.due_ts` (float epoch) convention are used identically across all tasks and tests. Ratings are integers 1–4 everywhere. `now` is always tz-aware UTC.
