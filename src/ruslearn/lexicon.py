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
