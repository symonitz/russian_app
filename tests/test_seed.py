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
