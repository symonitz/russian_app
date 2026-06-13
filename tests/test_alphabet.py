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
