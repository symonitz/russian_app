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
