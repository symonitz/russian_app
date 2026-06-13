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
