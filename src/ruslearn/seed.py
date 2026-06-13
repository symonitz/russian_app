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
